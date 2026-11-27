import { DraftHistoryArchiver } from '#engine/application/drafts/draftHistoryArchiver';
import { FinalBeatCoverageTracer } from '#engine/application/drafts/finalBeatCoverageTracer';
import { ChapterSummaryRefresher } from '#engine/application/manuscript/chapterSummaryRefresher';
import { DraftInputRecord } from '#engine/persistence/draftInputRecord';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type {
  StoryUri,
  BackgroundCard,
  AiProviderId,
  AiTaskName,
  Draft,
  StyleDirective,
} from '@storyboard/story-model';
import {
  AiProviderError,
  computeDraftBodyHash,
  createDraft,
  joinCardText,
  parseDraft,
  serializeDraft,
  buildStyleDirective,
  type DraftGenerationStepId,
  type SceneCacheRecord,
  type TraceRunStatus,
  sceneBeatText,
  draftGenerationTraceKind,
  parseSceneFileName,
  extractErrorMessage,
} from '@storyboard/story-model';
import { BackgroundFactConflictStore } from '#engine/persistence/backgroundFactConflictStore';
import {
  BackgroundMemoryStore,
  PersonaMemoryStore,
  SceneDialogueStore,
} from '#engine/persistence/cardMemoryStores';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
import {
  promptResourceFingerprint,
  promptTuning,
  promptTuningKeys,
  type PromptConfig,
  type StoryboardAiService,
  type TaskAiConfigResolved,
} from '@storyboard/story-ai';
import { SceneGenerationPipeline } from '#engine/pipeline/scene/sceneGenerationPipeline';
import {
  SceneGenerationPipelineCancelledError,
  type IScenePipelineObserver,
  type RunSceneGenerationPipelineResult,
  type SceneGenerationPipelineTaskProviders,
} from '#engine/pipeline/sceneGenerationTypes';
import {
  draftWarningMessages,
  emptyDraftBodyMessage,
  type GenerateDraftRequest,
  type GenerateDraftResult,
  type BeatLocationSource,
  type DraftRunReuse,
  type DraftRunStop,
} from '#engine/application/drafts/draftGenerationContract';
import {
  SceneGenerationInputsLoader,
  WorkflowFailureReporter,
  type SceneGenerationInputs,
  type SceneGenerationInputsResult,
} from '#engine/application/drafts/sceneGenerationInputs';
import { sceneCacheDirectoryPath } from '#engine/persistence/sceneCacheWorkspace';
import type { IUseCase } from '#engine/application/useCase';
import { StoryStateRecorder } from '#engine/application/drafts/updateStoryState';
import type {
  GenerationTraceRecorder,
  TraceRunSession,
} from '#engine/persistence/generationTraceRecorder';
import { resolveScenePipelinePlan, sceneStageCatalog } from '#engine/pipeline/sceneStageCatalog';
import {
  computeDraftRunFingerprint,
  SceneDraftCheckpoints,
  type DraftRunFingerprint,
  type SceneDraftCheckpointRun,
} from '#engine/application/drafts/sceneDraftCheckpoints';

const scenePipelineTraceName: string = 'scene';

interface ScenePipelineSetup {
  readonly aiService: StoryboardAiService;
  readonly providers: SceneGenerationPipelineTaskProviders;
  readonly styleDirective: StyleDirective | undefined;
  readonly backgroundRecentExcerpt: string | undefined;
  readonly checkpoint: SceneDraftCheckpointRun;
}

interface PromptFingerprint {
  readonly key: string;
  readonly resource: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly reasoningEffort: string | null;
}

function describePromptFingerprints(): readonly PromptFingerprint[] {
  return promptTuningKeys().map((key) => {
    const config: PromptConfig = promptTuning(key);

    return {
      key,
      resource: promptResourceFingerprint(key),
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      reasoningEffort: config.reasoningEffort ?? null,
    };
  });
}

export type { GenerateDraftRequest, GenerateDraftResult } from '#engine/application/drafts/draftGenerationContract';

export class GenerateDraftUseCase implements IUseCase<GenerateDraftRequest, GenerateDraftResult> {
  private readonly inputsLoader: SceneGenerationInputsLoader;
  private readonly storyStateRecorder: StoryStateRecorder;
  private readonly summaryRefresher: ChapterSummaryRefresher;
  private readonly failureReporter: WorkflowFailureReporter;
  private readonly checkpoints: SceneDraftCheckpoints;

  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {
    this.inputsLoader = new SceneGenerationInputsLoader({ host, ai, repositories });
    this.summaryRefresher = new ChapterSummaryRefresher({ host, ai, repositories });
    this.storyStateRecorder = new StoryStateRecorder({ host, ai });
    this.failureReporter = new WorkflowFailureReporter(host.logger);
    this.checkpoints = new SceneDraftCheckpoints({ caches: host.caches, logger: host.logger });
  }

  public async execute(request: GenerateDraftRequest): Promise<GenerateDraftResult> {
    return await this.traceGeneration(request, () =>
      this.generateDraftForWorkspaceSceneWorkflow(request),
    );
  }

  private toBackgroundSnapshot(
    background: BackgroundCard | undefined,
  ): SceneCacheRecord['backgroundSnapshot'] {
    if (!background) {
      return undefined;
    }

    return {
      id: background.id,
      name: background.name,
      description: joinCardText(background.description),
    };
  }

  private async isCacheHit(inputs: SceneGenerationInputs): Promise<boolean> {
    if (!(await this.host.fileSystem.exists(inputs.draftUri))) {
      return false;
    }

    const recordedHash: string | undefined = await new DraftInputRecord({
      fileSystem: this.host.fileSystem,
      scenes: this.host.scenes,
      sceneCache: this.repositories.sceneCache,
    }).readRecordedHash({
      workspaceRoot: inputs.threadPaths.workspaceRoot,
      stem: inputs.scene.stem,
      cacheUri: inputs.cacheUri,
    });
    return recordedHash === inputs.inputHash;
  }

  private async openCachedDraft(draftUri: StoryUri): Promise<GenerateDraftResult> {
    return { ok: true, kind: 'cache_hit', draftUri };
  }

  private buildSceneCacheRecord(
    inputs: SceneGenerationInputs,
    pipelineResult: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
    providers: SceneCacheRecord['providers'],
    bodyHash: string,
  ): SceneCacheRecord {
    const { scene, context, previousContext, inputHash } = inputs;

    return {
      sceneStem: scene.stem,
      generatedAt: new Date().toISOString(),
      inputHash,
      input: context.scene.body,
      detectedCharacters: pipelineResult.detectedCharacters,
      skeleton: pipelineResult.skeleton,
      ...(pipelineResult.sceneCoordinates.length > 0
        ? { sceneCoordinates: pipelineResult.sceneCoordinates }
        : {}),
      ...(pipelineResult.skeletonFacts.length > 0
        ? { skeletonFacts: pipelineResult.skeletonFacts }
        : {}),
      bodyHash,
      personasUsed: Object.fromEntries(pipelineResult.personasUsed),
      backgroundSnapshot: this.toBackgroundSnapshot(context.background),
      previousContext,
      providers,
    };
  }

  private async isDraftOursToOverwrite(inputs: SceneGenerationInputs): Promise<boolean> {
    if (!(await this.host.fileSystem.exists(inputs.draftUri))) {
      return true;
    }

    try {
      const record: SceneCacheRecord = await this.repositories.sceneCache.read(inputs.cacheUri);
      if (record.bodyHash === undefined) {
        return false;
      }

      const existing: Draft = parseDraft(
        new TextDecoder().decode(await this.host.fileSystem.readFile(inputs.draftUri)),
      );
      return computeDraftBodyHash(existing.body) === record.bodyHash;
    } catch {
      return false;
    }
  }

  private async archiveExistingDraft(inputs: SceneGenerationInputs): Promise<void> {
    try {
      await new DraftHistoryArchiver(this.host).archive(
        inputs.workspaceFolder.uri,
        inputs.scene.stem,
        inputs.draftUri,
      );
    } catch (error) {
      this.host.logger.warn(`이전 초안을 판본으로 보관하지 못했습니다: ${String(error)}`);
    }
  }

  private async persistGeneratedDraft(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
    aiService: StoryboardAiService,
    pipelineResult: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
    cacheProviders: SceneCacheRecord['providers'],
  ): Promise<GenerateDraftResult> {
    const { paths, threadPaths, scene, draftUri, cacheUri } = inputs;

    if (pipelineResult.draftBody.trim().length === 0) {
      return { ok: false, kind: 'failed', message: emptyDraftBodyMessage(scene.stem) };
    }

    this.logDialoguePolish(scene.stem, pipelineResult);
    const draft: Draft = this.createGeneratedDraft(inputs, pipelineResult);

    await this.repositories.sceneCache.ensureDirectory(sceneCacheDirectoryPath(paths, scene));

    request.onSaving?.();

    const bodyHash: string = computeDraftBodyHash(parseDraft(serializeDraft(draft)).body);
    const cacheRecord: SceneCacheRecord = this.buildSceneCacheRecord(
      inputs,
      pipelineResult,
      cacheProviders,
      bodyHash,
    );

    await this.archiveDraftBeforeOverwrite(inputs);

    await this.repositories.drafts.write(draftUri, draft);

    await this.saveDialogueRecord(threadPaths, pipelineResult);

    await this.repositories.sceneCache.write(cacheUri, cacheRecord);

    const stateStep: DraftGenerationStepId = 'updateStoryState';
    await this.ai.traceRecorder.runStage(inputs.paths.workspaceRoot, stateStep, () =>
      this.storyStateRecorder.updateAfterGeneration(
        inputs,
        aiService,
        pipelineResult.draftBody,
        pipelineResult.skeletonFacts,
      ),
    );
    const isReviseAboutToFollow: boolean =
      request.reviseFollows === 'always' ||
      (request.reviseFollows === 'when-enabled' && this.host.configBridge.isReviseAfterGenerateEnabled());
    if (!isReviseAboutToFollow) {
      await new FinalBeatCoverageTracer(this.ai, this.host.logger).trace({
        workspaceRoot: inputs.paths.workspaceRoot,
        sceneStem: inputs.scene.stem,
        beats: (inputs.context.scene.card?.beats ?? []).map(sceneBeatText),
        body: pipelineResult.draftBody,
        aiService,
      });
    }

    return {
      ok: true,
      kind: 'generated',
      draftUri,
      warnings: [...inputs.warnings.map((message) => ({ message })), ...pipelineResult.warnings],
      ...(pipelineResult.beatSegments === undefined
        ? {}
        : { beatSegments: pipelineResult.beatSegments }),
      ...this.describeBeatsToLocate(inputs),
    };
  }

  private describeBeatsToLocate(inputs: SceneGenerationInputs): { beatsToLocate?: BeatLocationSource } {
    const beats: readonly string[] = (inputs.context.scene.card?.beats ?? []).map(sceneBeatText);
    const shouldLocate: boolean = this.host.configBridge.isBeatLocationEnabled() && beats.length > 0;

    return shouldLocate
      ? { beatsToLocate: { workspaceRoot: inputs.paths.workspaceRoot, sceneStem: inputs.scene.stem, beats } }
      : {};
  }

  private logDialoguePolish(
    sceneStem: string,
    pipelineResult: RunSceneGenerationPipelineResult,
  ): void {
    if (pipelineResult.dialoguePolish) {
      const { lineCount, polishedCount, contestedCount } = pipelineResult.dialoguePolish;
      this.host.logger.info(
        `${sceneStem}: 대사 다듬기 ${polishedCount}/${lineCount}개 손봄${contestedCount > 0 ? `, ${contestedCount}개는 화자가 겹쳐 뼈대 유지` : ''}`,
      );
    }
  }

  private createGeneratedDraft(
    inputs: SceneGenerationInputs,
    pipelineResult: RunSceneGenerationPipelineResult,
  ): Draft {
    const sceneDraftConfig: TaskAiConfigResolved = this.ai.gateway.getTaskAiConfig('sceneDraft');

    return createDraft({
      sceneStem: inputs.scene.stem,
      format: inputs.project.format,
      body: pipelineResult.draftBody,
      warnings: draftWarningMessages(pipelineResult.warnings),
      generator: this.host.generator,
      providerId: sceneDraftConfig.providerId,
      model: sceneDraftConfig.model,
    });
  }

  private async archiveDraftBeforeOverwrite(inputs: SceneGenerationInputs): Promise<void> {
    const isOurs: boolean = await this.isDraftOursToOverwrite(inputs);
    if (!isOurs) {
      this.host.logger.warn(
        `이 초안은 마지막 생성 결과와 다릅니다(다른 도구로 생성 또는 직접 수정). 덮어쓰기 전에 판본으로 보관합니다: ${inputs.scene.stem}`,
      );
    }
    await this.archiveExistingDraft(inputs);
  }

  private async saveDialogueRecord(
    threadPaths: SceneGenerationInputs['threadPaths'],
    pipelineResult: RunSceneGenerationPipelineResult,
  ): Promise<void> {
    if (pipelineResult.dialogueRecord) {
      await new SceneDialogueStore(this.host, threadPaths).save(
        pipelineResult.dialogueRecord,
      );
    }
  }

  private async runAndPersistDraft(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
  ): Promise<GenerateDraftResult> {
    const setup: ScenePipelineSetup = await this.prepareScenePipeline(inputs);
    const cacheProviders: Partial<Record<AiTaskName, AiProviderId>> = setup.providers;

    try {
      const pipelineResult: RunSceneGenerationPipelineResult = await this.createScenePipeline(
        inputs,
        request,
        setup,
      ).run();

      const persisted: GenerateDraftResult = await this.persistGeneratedDraft(
        inputs,
        request,
        setup.aiService,
        pipelineResult,
        cacheProviders,
      );
      setup.checkpoint.discard();
      return withDraftReuse(persisted, setup.checkpoint);
    } catch (error) {
      return this.describeGenerationFailure(error, request, setup.checkpoint.describeStop());
    }
  }

  private async prepareScenePipeline(inputs: SceneGenerationInputs): Promise<ScenePipelineSetup> {
    const providers: SceneGenerationPipelineTaskProviders = this.resolvePipelineProviders();
    const styleDirective: StyleDirective | undefined = this.buildSceneStyleDirective(inputs);
    const backgroundRecentExcerpt: string | undefined = await this.findBackgroundRecentExcerpt(inputs);
    const checkpoint: SceneDraftCheckpointRun = await this.checkpoints.open({
      workspaceRoot: inputs.paths.workspaceRoot,
      sceneStem: inputs.scene.stem,
      fingerprint: this.computeRunFingerprint(inputs, { providers, styleDirective, backgroundRecentExcerpt }),
    });

    return {
      aiService: this.ai.gateway.createService(inputs.workspaceFolder.uri),
      providers,
      styleDirective,
      backgroundRecentExcerpt,
      checkpoint,
    };
  }

  private computeRunFingerprint(
    inputs: SceneGenerationInputs,
    setup: Pick<ScenePipelineSetup, 'providers' | 'styleDirective' | 'backgroundRecentExcerpt'>,
  ): DraftRunFingerprint {
    const { configBridge } = this.host;
    const tasks: readonly AiTaskName[] = Object.keys(setup.providers) as AiTaskName[];

    return computeDraftRunFingerprint({
      program: this.host.generator,
      sceneInput: {
        inputHash: inputs.inputHash,
        styleDirective: setup.styleDirective,
        canonFactLines: inputs.canonFactLines,
      },
      previousScenes: {
        previousContext: inputs.previousContext,
        characterKnowledge: inputs.characterKnowledge,
        characterRelations: inputs.characterRelations,
        backgroundRecentExcerpt: setup.backgroundRecentExcerpt,
      },
      models: tasks.map((task) => [task, this.ai.gateway.getTaskAiConfig(task)]),
      tuning: {
        knobs: configBridge.getSceneGenerationTuning(),
        sectionOutputLimit: configBridge.getSectionOutputLimit(),
        isContextCondensed: configBridge.isAiContextCondenseEnabled(),
        seed: configBridge.getSeed() ?? null,
      },
      stages: resolveScenePipelinePlan(),
      prompts: describePromptFingerprints(),
    });
  }

  private resolvePipelineProviders(): SceneGenerationPipelineTaskProviders {
    return {
      personaGeneration: this.ai.gateway.getTaskProvider('personaGeneration'),
      sceneSkeleton: this.ai.gateway.getTaskProvider('sceneSkeleton'),
      skeletonFacts: this.ai.gateway.getTaskProvider('skeletonFacts'),
      sceneBeatActor: this.ai.gateway.getTaskProvider('sceneBeatActor'),
      sceneBeatArbiter: this.ai.gateway.getTaskProvider('sceneBeatArbiter'),
      sceneBeatJudge: this.ai.gateway.getTaskProvider('sceneBeatJudge'),
      sceneDialoguePolish: this.ai.gateway.getTaskProvider('sceneDialoguePolish'),
      sceneDialogueAttribution: this.ai.gateway.getTaskProvider('sceneDialogueAttribution'),
      sceneSectionExpansion: this.ai.gateway.getTaskProvider('sceneSectionExpansion'),
      beatLocation: this.ai.gateway.getTaskProvider('beatLocation'),
      sceneProofread: this.ai.gateway.getTaskProvider('sceneProofread'),
    };
  }

  private async findBackgroundRecentExcerpt(
    inputs: SceneGenerationInputs,
  ): Promise<string | undefined> {
    const backgroundId: string | undefined = inputs.context.background?.id;

    return backgroundId
      ? await new DraftRepository(this.host.fileSystem).findRecentBackgroundExcerpt(
          inputs.paths,
          inputs.scene,
          (await this.host.scenes.loadRoster(inputs.paths.workspaceRoot)).scenes,
          backgroundId,
        )
      : undefined;
  }

  private createScenePipeline(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
    setup: ScenePipelineSetup,
  ): SceneGenerationPipeline {
    const { paths, threadPaths, scene, project, context, previousContext } = inputs;
    const { aiService, providers, styleDirective, backgroundRecentExcerpt, checkpoint } = setup;

    return new SceneGenerationPipeline({
      sceneStem: scene.stem,
      context,
      aiService,
      format: project.format,
      styleDirective,
      previousContext,
      canonFactLines: inputs.canonFactLines,
      characterKnowledge: inputs.characterKnowledge,
      characterRelations: inputs.characterRelations,
      providers,
      onProgress: (stage, current, total): void => {
        if (request.shouldCancel?.()) {
          return;
        }

        request.onPipelineProgress?.(stage, current, total);
      },
      shouldCancel: request.shouldCancel,
      observer: this.tracePipelineStages(paths.workspaceRoot, checkpoint),
      useContextCondense: this.host.configBridge.isAiContextCondenseEnabled(),
      sectionOutputLimit: this.host.configBridge.getSectionOutputLimit(),
      tuning: this.host.configBridge.getSceneGenerationTuning(),
      personaStore: new PersonaMemoryStore(this.host, threadPaths, scene.stem),
      backgroundStore: new BackgroundMemoryStore(this.host, threadPaths, scene.stem),
      backgroundFactConflictStore: new BackgroundFactConflictStore(
        this.host.caches,
        paths.workspaceRoot,
      ),
      dialogueCorpus: new SceneDialogueStore(this.host, threadPaths),
      backgroundRecentExcerpt,
      ...(checkpoint.resumeFrom === undefined ? {} : { resumeFrom: checkpoint.resumeFrom }),
      onCheckpoint: checkpoint.save,
    });
  }

  private buildSceneStyleDirective(inputs: SceneGenerationInputs): StyleDirective | undefined {
    const { project, scene } = inputs;

    return buildStyleDirective(
      project.setting,
      scene.frontmatter.targetWordCount,
      scene.body,
      inputs.narration,
    );
  }

  private describeGenerationFailure(
    error: unknown,
    request: GenerateDraftRequest,
    stop: DraftRunStop,
  ): GenerateDraftResult {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return { ok: false, kind: 'cancelled', ...stop };
    }

    if (error instanceof AiProviderError && error.code === 'usage-limit') {
      return { ok: false, kind: 'failed', reason: 'usage-limit', message: error.message, ...stop };
    }

    const message: string = extractErrorMessage(error);
    const reported: GenerateDraftResult = this.failureReporter.report(
      request,
      'Draft generation failed',
      error,
      `초안 생성에 실패했습니다: ${message}`,
    );
    return { ...reported, ...stop };
  }

  private async generateDraftForWorkspaceSceneWorkflow(
    request: GenerateDraftRequest,
  ): Promise<GenerateDraftResult> {
    const loaded: SceneGenerationInputsResult = await this.inputsLoader.load(
      request.sceneUri,
      request,
    );
    if (!loaded.ok) {
      return loaded.result;
    }

    const inputs: SceneGenerationInputs = loaded.inputs;

    if (await this.isCurrentDraftReusable(inputs, request)) {
      return await this.openCachedDraft(inputs.draftUri);
    }

    const refreshed: SceneGenerationInputsResult = await this.refreshChapterSummaries(
      inputs,
      request,
    );
    return refreshed.ok ? await this.runAndPersistDraft(refreshed.inputs, request) : refreshed.result;
  }

  private async isCurrentDraftReusable(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
  ): Promise<boolean> {
    const workspaceRoot: StoryUri = inputs.paths.workspaceRoot;
    if (request.force) {
      await this.checkpoints.discard(workspaceRoot, inputs.scene.stem);
      return false;
    }

    const hasInterruptedRun: boolean = await this.checkpoints.exists(workspaceRoot, inputs.scene.stem);
    return !hasInterruptedRun && (await this.isCacheHit(inputs));
  }

  private tracePipelineStages(
    workspaceRoot: StoryUri,
    checkpoint: SceneDraftCheckpointRun,
  ): IScenePipelineObserver {
    const recorder: GenerationTraceRecorder = this.ai.traceRecorder;

    return {
      onPlan: (stageIds): void => {
        void recorder.recordPlan(workspaceRoot, {
          pipeline: scenePipelineTraceName,
          stageIds,
          catalog: sceneStageCatalog,
        });
      },
      onEvent: (event): void => {
        void recorder.recordEvent(workspaceRoot, event);
      },
      onStageStart: (stageId): void => {
        checkpoint.noteStageStart(stageId);
        recorder.enterStage(workspaceRoot, stageId);
      },
      onStageEnd: (stageId, failure): void => {
        checkpoint.noteStageEnd(stageId, failure);
        void recorder.leaveStage(workspaceRoot, failure);
      },
    };
  }

  private async traceGeneration(
    request: GenerateDraftRequest,
    generate: () => Promise<GenerateDraftResult>,
  ): Promise<GenerateDraftResult> {
    const workspaceRoot: StoryUri | undefined = this.host.workspaceLocator.folderFor(request.sceneUri)?.uri;
    const sceneStem: string | undefined = parseSceneFileName(
      request.sceneUri.path.split('/').at(-1) ?? '',
    )?.stem;
    if (workspaceRoot === undefined || sceneStem === undefined) {
      return await generate();
    }

    const session: TraceRunSession = await this.ai.traceRecorder.startRun(workspaceRoot, {
      kind: draftGenerationTraceKind,
      subject: { sceneStem },
    });

    try {
      const result: GenerateDraftResult = await generate();
      const status: TraceRunStatus = result.ok ? 'completed' : result.kind;
      await session.finish(status, result.ok || result.kind === 'cancelled' ? undefined : result.message);
      return withTraceRunId(result, session.runId);
    } catch (error) {
      await session.finish('failed', extractErrorMessage(error));
      throw error;
    }
  }

  private async refreshChapterSummaries(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
  ): Promise<SceneGenerationInputsResult> {
    const refreshStep: DraftGenerationStepId = 'refreshChapterSummaries';
    const summarizedCount: number = await this.ai.traceRecorder.runStage(
      inputs.paths.workspaceRoot,
      refreshStep,
      () => this.summaryRefresher.refreshBefore(inputs.paths.workspaceRoot, inputs.scene.order),
    );

    return summarizedCount === 0
      ? { ok: true, inputs }
      : await this.inputsLoader.load(request.sceneUri, request);
  }
}

function withTraceRunId(result: GenerateDraftResult, traceRunId: string | undefined): GenerateDraftResult {
  if (result.kind !== 'generated' || traceRunId === undefined) {
    return result;
  }

  return { ...result, traceRunId };
}

function withDraftReuse(result: GenerateDraftResult, checkpoint: SceneDraftCheckpointRun): GenerateDraftResult {
  const reused: DraftRunReuse | undefined = checkpoint.describeReuse();
  if (result.kind !== 'generated' || reused === undefined) {
    return result;
  }

  return { ...result, reused };
}
