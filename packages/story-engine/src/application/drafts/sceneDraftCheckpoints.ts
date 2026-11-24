import { createHash } from 'node:crypto';

import type { StoryUri } from '@storyboard/story-model';
import { z } from 'zod';

import { RunStore } from '#engine/persistence/cache/runStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type { SceneRunCheckpoint } from '#engine/pipeline/sceneGenerationTypes';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { DraftRunReuse, DraftRunStop } from '#engine/application/drafts/draftGenerationContract';
import type { IStoryboardLogger } from '#engine/ports/logger';

export type DraftRunFingerprintPart =
  | 'program'
  | 'sceneInput'
  | 'previousScenes'
  | 'models'
  | 'tuning'
  | 'stages'
  | 'prompts';

export type DraftRunFingerprintSource = Readonly<Record<DraftRunFingerprintPart, unknown>>;

export type DraftRunFingerprint = Readonly<Record<DraftRunFingerprintPart, string>>;

const draftRunFingerprintLabels: Readonly<Record<DraftRunFingerprintPart, string>> = {
  program: '프로그램 버전',
  sceneInput: '씬 입력',
  previousScenes: '직전 씬 맥락',
  models: '작업별 모델',
  tuning: '조정값',
  stages: '단계 구성',
  prompts: '프롬프트 리소스',
};

const draftRunFingerprintParts: readonly DraftRunFingerprintPart[] = [
  'program',
  'sceneInput',
  'previousScenes',
  'models',
  'tuning',
  'stages',
  'prompts',
];

function serializeMapsAsEntries(_key: string, value: unknown): unknown {
  return value instanceof Map ? [...value] : value;
}

function hashFingerprintPart(value: unknown): string {
  const text: string = JSON.stringify(value ?? null, serializeMapsAsEntries);

  return createHash('sha256').update(text).digest('hex');
}

export function computeDraftRunFingerprint(source: DraftRunFingerprintSource): DraftRunFingerprint {
  return Object.fromEntries(
    draftRunFingerprintParts.map((part) => [part, hashFingerprintPart(source[part])]),
  ) as Record<DraftRunFingerprintPart, string>;
}

export function listDraftRunFingerprintChanges(
  saved: DraftRunFingerprint,
  current: DraftRunFingerprint,
): string[] {
  return draftRunFingerprintParts
    .filter((part) => saved[part] !== current[part])
    .map((part) => draftRunFingerprintLabels[part]);
}

const sceneDraftCheckpointFormatVersion: number = 1;
const programChangeLabel: string = draftRunFingerprintLabels.program;

interface StoredSceneDraftCheckpoint {
  readonly version: number;
  readonly sceneStem: string;
  readonly startedAt: string;
  readonly fingerprint: DraftRunFingerprint;
  readonly checkpoint: SceneRunCheckpoint;
}

const draftRunFingerprintSchema: z.ZodType<DraftRunFingerprint> = z.object({
  program: z.string(),
  sceneInput: z.string(),
  previousScenes: z.string(),
  models: z.string(),
  tuning: z.string(),
  stages: z.string(),
  prompts: z.string(),
});

const storedSceneDraftCheckpointSchema: z.ZodType<StoredSceneDraftCheckpoint> = z.object({
  version: z.literal(sceneDraftCheckpointFormatVersion),
  sceneStem: z.string(),
  startedAt: z.string(),
  fingerprint: draftRunFingerprintSchema,
  checkpoint: z.custom<SceneRunCheckpoint>(
    (value) => typeof value === 'object' && value !== null && Array.isArray((value as SceneRunCheckpoint).finishedStages),
  ),
});

function readStoredCheckpoint(data: string): StoredSceneDraftCheckpoint | undefined {
  try {
    const parsed: z.ZodSafeParseResult<StoredSceneDraftCheckpoint> = storedSceneDraftCheckpointSchema.safeParse(
      JSON.parse(data),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function sceneDraftCheckpointId(sceneStem: string): string {
  return `scene-draft:${sceneStem}`;
}

export interface SceneDraftCheckpointTarget {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly fingerprint: DraftRunFingerprint;
}

export interface SceneDraftCheckpointsDependencies {
  readonly caches: WorkspaceCaches;
  readonly logger: IStoryboardLogger;
}

export class SceneDraftCheckpoints {
  public constructor(private readonly dependencies: SceneDraftCheckpointsDependencies) {}

  public async exists(workspaceRoot: StoryUri, sceneStem: string): Promise<boolean> {
    const store: RunStore = await this.openStore(workspaceRoot);

    return store.findSceneDraftCheckpoint(sceneDraftCheckpointId(sceneStem)) !== undefined;
  }

  public async discard(workspaceRoot: StoryUri, sceneStem: string): Promise<void> {
    (await this.openStore(workspaceRoot)).removeSceneDraftCheckpoint(sceneDraftCheckpointId(sceneStem));
  }

  public async open(target: SceneDraftCheckpointTarget): Promise<SceneDraftCheckpointRun> {
    const store: RunStore = await this.openStore(target.workspaceRoot);
    const id: string = sceneDraftCheckpointId(target.sceneStem);
    const resumable: StoredSceneDraftCheckpoint | undefined = this.findResumable(store, id, target);

    if (resumable !== undefined) {
      this.dependencies.logger.info(`${target.sceneStem}: ${describeResumePoint(resumable.checkpoint)}부터 이어 갑니다.`);
    }

    return new SceneDraftCheckpointRun(store, {
      id,
      target,
      startedAt: resumable?.startedAt ?? new Date().toISOString(),
      resumeFrom: resumable?.checkpoint,
    });
  }

  private findResumable(
    store: RunStore,
    id: string,
    target: SceneDraftCheckpointTarget,
  ): StoredSceneDraftCheckpoint | undefined {
    const savedData: string | undefined = store.findSceneDraftCheckpoint(id);
    if (savedData === undefined) {
      return undefined;
    }

    const stored: StoredSceneDraftCheckpoint | undefined = readStoredCheckpoint(savedData);
    const changes: readonly string[] =
      stored === undefined ? [programChangeLabel] : listDraftRunFingerprintChanges(stored.fingerprint, target.fingerprint);
    if (changes.length === 0) {
      return stored;
    }

    store.removeSceneDraftCheckpoint(id);
    this.dependencies.logger.warn(
      `${target.sceneStem}: 중단된 실행이 남아 있지만 ${changes.join('·')}이(가) 달라져 처음부터 생성합니다.`,
    );
    return undefined;
  }

  private async openStore(workspaceRoot: StoryUri): Promise<RunStore> {
    return new RunStore(await this.dependencies.caches.open(workspaceRoot));
  }
}

function describeResumePoint(checkpoint: SceneRunCheckpoint): string {
  const sectionCount: number = checkpoint.expansion?.sections.length ?? 0;
  const stageCount: number = checkpoint.finishedStages.length;

  return sectionCount > 0
    ? `끝난 단계 ${stageCount}개와 살붙임 ${sectionCount}구간 다음`
    : `끝난 단계 ${stageCount}개 다음`;
}

interface SceneDraftCheckpointRunState {
  readonly id: string;
  readonly target: SceneDraftCheckpointTarget;
  readonly startedAt: string;
  readonly resumeFrom: SceneRunCheckpoint | undefined;
}

export class SceneDraftCheckpointRun {
  private lastSaved: SceneRunCheckpoint | undefined;
  private runningStage: SceneStageId | undefined;
  private failedStage: SceneStageId | undefined;

  public constructor(
    private readonly store: RunStore,
    private readonly state: SceneDraftCheckpointRunState,
  ) {
    this.lastSaved = state.resumeFrom;
  }

  public get resumeFrom(): SceneRunCheckpoint | undefined {
    return this.state.resumeFrom;
  }

  public readonly save = async (checkpoint: SceneRunCheckpoint): Promise<void> => {
    const stored: StoredSceneDraftCheckpoint = {
      version: sceneDraftCheckpointFormatVersion,
      sceneStem: this.state.target.sceneStem,
      startedAt: this.state.startedAt,
      fingerprint: this.state.target.fingerprint,
      checkpoint,
    };
    this.store.saveSceneDraftCheckpoint({
      id: this.state.id,
      startedAt: this.state.startedAt,
      updatedAt: new Date().toISOString(),
      data: JSON.stringify(stored),
    });
    this.lastSaved = checkpoint;
  };

  public noteStageStart(stage: SceneStageId): void {
    this.runningStage = stage;
  }

  public noteStageEnd(stage: SceneStageId, failure: unknown): void {
    this.runningStage = undefined;
    if (failure !== undefined) {
      this.failedStage = stage;
    }
  }

  public discard(): void {
    this.store.removeSceneDraftCheckpoint(this.state.id);
  }

  public describeReuse(): DraftRunReuse | undefined {
    const resumed: SceneRunCheckpoint | undefined = this.state.resumeFrom;

    return resumed === undefined
      ? undefined
      : { stages: resumed.finishedStages, expansionSections: resumed.expansion?.sections.length ?? 0 };
  }

  public describeStop(): DraftRunStop {
    const failedStage: SceneStageId | undefined = this.failedStage ?? this.runningStage;
    const acceptedSections: number = this.lastSaved?.expansion?.sections.length ?? 0;
    const isExpansionStop: boolean = failedStage === 'expandSection';

    return {
      ...(failedStage === undefined ? {} : { failedStage }),
      ...(isExpansionStop ? { failedSection: acceptedSections + 1 } : {}),
      isResumable: this.lastSaved !== undefined,
    };
  }
}
