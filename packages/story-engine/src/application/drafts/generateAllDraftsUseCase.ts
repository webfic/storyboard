import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type { SceneGenerationPipelineStage } from '#engine/pipeline/sceneGenerationTypes';
import type { GenerateDraftResult, GenerateDraftUseCase } from '#engine/application/drafts/generateDraftUseCase';
import type { ReviseAfterGenerateGate } from '#engine/application/drafts/reviseAfterGenerateGate';
import { describeReviseOutcome, type ReviseDraftWorkflowResult } from '#engine/application/drafts/reviseDraftUseCase';
import type { IUseCase } from '#engine/application/useCase';
import type { BatchSceneList } from '#engine/application/drafts/draftRepositories';
import {
  STORYBOARD_FILE_EXTENSIONS,
  type BeatLocation,
  type DraftGenerationStepId,
  type StoryUri,
} from '@storyboard/story-model';
import {
  draftWarningMessages,
  type DraftWarning,
} from '#engine/application/drafts/draftGenerationContract';
import type { SceneRunReport, SceneRunReporter } from '#engine/application/drafts/sceneRunReport';
import { summarizeUsageByStage, type StageUsage } from '#engine/application/ai/stageUsage';
import type { UsageMeter, UsageMeterSession } from '#engine/application/ai/usageMeter';
import type { BeatRange } from '#engine/pipeline/beatRanges';
import { addBeatSpansToWarnings } from '#engine/pipeline/beatLocations';

export type GenerateAllDraftsProgress = {
  readonly current: number;
  readonly kind: 'pipeline' | 'prepared' | 'revising' | 'saving';
  readonly label: string;
  readonly stage?: SceneGenerationPipelineStage;
  readonly stageCurrent?: number;
  readonly stageTotal?: number;
  readonly total: number;
};

export interface DraftBatchSceneResult {
  readonly stem: string;
  readonly ok: boolean;
  readonly cached: boolean;
  readonly usage: readonly StageUsage[];
  readonly warnings: readonly DraftWarning[];
  readonly message?: string;
  readonly seedHonoured?: boolean;
  readonly beatRanges?: readonly BeatRange[];
  readonly beatLocations?: readonly BeatLocation[];
  readonly traceRunId?: string;
}

export type GenerateAllDraftsSummary = {
  readonly cacheHits: number;
  readonly failureLabels: readonly string[];
  readonly failures: number;
  readonly generated: number;
  readonly sceneCount: number;
  readonly pausedWithRemaining?: number;
  readonly usage: readonly StageUsage[];
  readonly scenes: readonly DraftBatchSceneResult[];
};

export type GenerateAllDraftsResult =
  | { readonly kind: 'no_projects'; readonly ok: false }
  | { readonly kind: 'no_scenes'; readonly ok: false }
  | { readonly kind: 'completed'; readonly ok: true; readonly summary: GenerateAllDraftsSummary };

export type GenerateAllDraftsOptions = {
  readonly onProgress?: (progress: GenerateAllDraftsProgress) => void;
  readonly shouldCancel?: () => boolean;
  readonly shouldPause?: () => boolean;
};

export interface GenerateAllDraftsCollaborators {
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly sceneRunReporter: SceneRunReporter;
  readonly usageMeter: UsageMeter;
}

interface BatchSceneRun {
  readonly draft: GenerateDraftResult;
  readonly reviseWarning?: string;
}

const reviseStage: DraftGenerationStepId = 'reviseLoop';

const maxListedFailureLabels: number = 5;

interface BatchScenePosition {
  readonly current: number;
  readonly label: string;
  readonly remaining: number;
  readonly total: number;
}

type FailedDraftResult = Extract<GenerateDraftResult, { readonly ok: false }>;

function sceneStemOfBundleName(bundleName: string): string {
  const cardSuffix: string = STORYBOARD_FILE_EXTENSIONS.card;
  return bundleName.endsWith(cardSuffix) ? bundleName.slice(0, -cardSuffix.length) : bundleName;
}

function describeSceneResult(
  stem: string,
  run: BatchSceneRun,
  report: SceneRunReport,
): DraftBatchSceneResult {
  const { draft, reviseWarning } = run;
  const draftWarnings: readonly DraftWarning[] = addBeatSpansToWarnings(
    draft.ok && draft.kind === 'generated' ? draft.warnings : [],
    report.beatLocations,
  );
  const traceRunId: string | undefined =
    draft.ok && draft.kind === 'generated' ? draft.traceRunId : undefined;

  return {
    stem,
    ok: draft.ok,
    cached: draft.ok && draft.kind === 'cache_hit',
    usage: report.usage,
    warnings:
      reviseWarning === undefined
        ? draftWarnings
        : [...draftWarnings, { message: reviseWarning, stage: reviseStage }],
    ...(draft.ok ? {} : { message: draft.kind === 'failed' ? draft.message : '취소했습니다.' }),
    ...(report.seedHonoured === undefined ? {} : { seedHonoured: report.seedHonoured }),
    ...(report.beatRanges === undefined ? {} : { beatRanges: report.beatRanges }),
    ...(report.beatLocations === undefined ? {} : { beatLocations: report.beatLocations }),
    ...(traceRunId === undefined ? {} : { traceRunId }),
  };
}

function describeBatchScenePosition(
  sceneUri: StoryUri,
  index: number,
  total: number,
): BatchScenePosition {
  return {
    current: index + 1,
    label: sceneUri.path.split('/').at(-1) ?? sceneUri.fsPath,
    remaining: total - index,
    total,
  };
}

class DraftBatchTally {
  private generated: number = 0;
  private cacheHits: number = 0;
  private failures: number = 0;
  private readonly failureLabels: string[] = [];
  private pausedWithRemaining: number | undefined;
  private readonly sceneResults: DraftBatchSceneResult[] = [];

  public constructor(private readonly sceneCount: number) {}

  public recordSceneResult(sceneResult: DraftBatchSceneResult): void {
    this.sceneResults.push(sceneResult);
  }

  public recordCacheHit(): void {
    this.cacheHits += 1;
  }

  public recordGenerated(): void {
    this.generated += 1;
  }

  public recordFailure(failureLabel: string): void {
    this.failures += 1;
    if (this.failureLabels.length < maxListedFailureLabels) this.failureLabels.push(failureLabel);
  }

  public recordPause(remaining: number): void {
    this.pausedWithRemaining = remaining;
  }

  public toResult(usage: readonly StageUsage[]): GenerateAllDraftsResult {
    const pausedWithRemaining: number | undefined = this.pausedWithRemaining;

    return {
      kind: 'completed',
      ok: true,
      summary: {
        generated: this.generated,
        cacheHits: this.cacheHits,
        failures: this.failures,
        failureLabels: this.failureLabels,
        sceneCount: this.sceneCount,
        ...(pausedWithRemaining === undefined ? {} : { pausedWithRemaining }),
        usage,
        scenes: this.sceneResults,
      },
    };
  }
}

export class GenerateAllDraftsUseCase implements IUseCase<
  GenerateAllDraftsOptions,
  GenerateAllDraftsResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
    private readonly collaborators: GenerateAllDraftsCollaborators,
  ) {}

  public async execute(options: GenerateAllDraftsOptions = {}): Promise<GenerateAllDraftsResult> {
    const scenes: BatchSceneList = await this.repositories.sceneBatches.listStoryboardScenes();

    if (scenes.projectCount === 0) {
      return { kind: 'no_projects', ok: false };
    }
    if (scenes.scenes.length === 0) {
      return { kind: 'no_scenes', ok: false };
    }

    const spending: UsageMeterSession = this.collaborators.usageMeter.startSession();

    try {
      const tally: DraftBatchTally = await this.generateScenes(scenes.scenes, options);
      return tally.toResult(summarizeUsageByStage(spending.records()));
    } finally {
      spending.stop();
    }
  }

  private async generateScenes(
    sceneUris: readonly StoryUri[],
    options: GenerateAllDraftsOptions,
  ): Promise<DraftBatchTally> {
    const total: number = sceneUris.length;
    const tally: DraftBatchTally = new DraftBatchTally(total);

    for (const [index, sceneUri] of sceneUris.entries()) {
      if (options.shouldCancel?.()) {
        break;
      }

      if (options.shouldPause?.()) {
        tally.recordPause(total - index);
        break;
      }

      const position: BatchScenePosition = describeBatchScenePosition(sceneUri, index, total);
      const shouldContinue: boolean = await this.generateScene(sceneUri, position, options, tally);
      if (!shouldContinue) break;
    }

    return tally;
  }

  private async generateScene(
    sceneUri: StoryUri,
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
    tally: DraftBatchTally,
  ): Promise<boolean> {
    const { current, label, total } = position;
    options.onProgress?.({ current, kind: 'prepared', label, total });

    const { outcome, report } = await this.collaborators.sceneRunReporter.measure(
      () => this.runScene(sceneUri, position, options),
      (run) => run.draft,
    );
    return this.recordSceneRun(outcome, report, position, tally);
  }

  private async runScene(
    sceneUri: StoryUri,
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
  ): Promise<BatchSceneRun> {
    const draft: GenerateDraftResult = await this.requestDraft(sceneUri, position, options);

    if (!draft.ok || draft.kind === 'cache_hit') {
      return { draft };
    }

    const reviseWarning: string | undefined = await this.reviseGeneratedDraft(
      sceneUri,
      draft.warnings,
      position,
      options,
    );
    return { draft, ...(reviseWarning === undefined ? {} : { reviseWarning }) };
  }

  private recordSceneRun(
    run: BatchSceneRun,
    report: SceneRunReport,
    position: BatchScenePosition,
    tally: DraftBatchTally,
  ): boolean {
    const { draft } = run;
    const isCancelled: boolean = !draft.ok && draft.kind === 'cancelled';

    if (!isCancelled) {
      tally.recordSceneResult(describeSceneResult(sceneStemOfBundleName(position.label), run, report));
    }

    if (!draft.ok) {
      return this.recordFailedDraft(draft, position, tally);
    }

    if (draft.kind === 'cache_hit') tally.recordCacheHit();
    else tally.recordGenerated();
    return true;
  }

  private async requestDraft(
    sceneUri: StoryUri,
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
  ): Promise<GenerateDraftResult> {
    const { current, label, total } = position;

    return await this.collaborators.generateDraftUseCase.execute({
      sceneUri,
      force: false,
      suppressLoggerPanel: true,
      reviseFollows: 'when-enabled',
      onPipelineProgress: (stage, stageCurrent, stageTotal) => {
        if (!options.shouldCancel?.()) {
          options.onProgress?.({
            current,
            kind: 'pipeline',
            label,
            stage,
            stageCurrent,
            stageTotal,
            total,
          });
        }
      },
      onSaving: () => {
        if (!options.shouldCancel?.())
          options.onProgress?.({ current, kind: 'saving', label, total });
      },
      shouldCancel: options.shouldCancel,
    });
  }

  private async reviseGeneratedDraft(
    sceneUri: StoryUri,
    warnings: readonly DraftWarning[],
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
  ): Promise<string | undefined> {
    const { current, label, total } = position;
    if (warnings.length > 0) {
      this.host.logger.warn(`${label}: ${draftWarningMessages(warnings).join(' / ')}`);
    }

    const revised: ReviseDraftWorkflowResult | undefined =
      await this.collaborators.reviseAfterGenerateGate.maybeRunAfterGenerate(sceneUri, {
        onWillRun: () => options.onProgress?.({ current, kind: 'revising', label, total }),
        shouldCancel: options.shouldCancel,
      });
    const reviseWarning: string | undefined = revised && describeReviseOutcome(revised).warning;
    if (reviseWarning) {
      this.host.logger.warn(`${label}: ${reviseWarning}`);
    }
    return reviseWarning || undefined;
  }

  private recordFailedDraft(
    draftResult: FailedDraftResult,
    position: BatchScenePosition,
    tally: DraftBatchTally,
  ): boolean {
    const { label } = position;

    if (draftResult.kind === 'cancelled') return false;
    if (draftResult.reason === 'usage-limit') {
      this.host.logger.warn(`${label}: ${draftResult.message}`);
      tally.recordPause(position.remaining);
      return false;
    }

    tally.recordFailure(`${label}: ${draftResult.message}`);
    this.host.logger.error(`Draft generation failed for ${label}`, new Error(draftResult.message));
    return true;
  }
}
