import type { SceneCoordinateLedger } from '#engine/pipeline/sceneCoordinates';
import type {
  DialoguePolishSummary,
  SaveSceneRunCheckpoint,
  SceneCoordinateSnapshot,
  SceneExpansionProgress,
  SceneRunCheckpoint,
  SceneRunSnapshot,
  SceneStageWarning,
  SceneWarning,
} from '#engine/pipeline/sceneGenerationTypes';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { SkeletonCallParagraphs } from '#engine/pipeline/skeletonBeats';
import type { Background, BackgroundFactConflict, SceneDialogueRecord } from '@storyboard/story-model';

export interface SceneRunState {
  personasUsed: Map<string, string>;
  background: Background;
  backgroundFactConflicts: readonly BackgroundFactConflict[];
  voiceSamples: Map<string, readonly string[]>;
  skeleton: string;
  sceneCoordinates: SceneCoordinateLedger;
  polishedText: string;
  skeletonCallParagraphs: readonly SkeletonCallParagraphs[];
  skeletonFacts: readonly string[];
  skeletonBeatStarts: ReadonlyMap<number, number> | undefined;
  dialoguePolish: DialoguePolishSummary | undefined;
  draftBody: string;
  dialogueRecord: SceneDialogueRecord | undefined;
  readonly warnings: SceneWarning[];
}


function captureSceneCoordinates(ledger: SceneCoordinateLedger): SceneCoordinateSnapshot {
  return {
    segments: ledger.segments.map((segment) => segment ?? null),
    isAlignedWithBreaks: ledger.isAlignedWithBreaks,
    ...(ledger.beats === undefined ? {} : { beats: ledger.beats }),
  };
}

function restoreSceneCoordinates(snapshot: SceneCoordinateSnapshot): SceneCoordinateLedger {
  return {
    segments: snapshot.segments.map((segment) => segment ?? undefined),
    isAlignedWithBreaks: snapshot.isAlignedWithBreaks,
    ...(snapshot.beats === undefined ? {} : { beats: snapshot.beats }),
  };
}

function captureSceneRun(run: SceneRunState): SceneRunSnapshot {
  return {
    personasUsed: [...run.personasUsed],
    background: run.background,
    backgroundFactConflicts: run.backgroundFactConflicts,
    voiceSamples: [...run.voiceSamples],
    skeleton: run.skeleton,
    sceneCoordinates: captureSceneCoordinates(run.sceneCoordinates),
    polishedText: run.polishedText,
    skeletonCallParagraphs: run.skeletonCallParagraphs,
    ...(run.skeletonFacts.length === 0 ? {} : { skeletonFacts: run.skeletonFacts }),
    ...(run.skeletonBeatStarts === undefined ? {} : { skeletonBeatStarts: [...run.skeletonBeatStarts] }),
    ...(run.dialoguePolish === undefined ? {} : { dialoguePolish: run.dialoguePolish }),
    draftBody: run.draftBody,
    ...(run.dialogueRecord === undefined ? {} : { dialogueRecord: run.dialogueRecord }),
  };
}

function restoreSceneRun(run: SceneRunState, snapshot: SceneRunSnapshot): void {
  run.personasUsed = new Map(snapshot.personasUsed);
  run.background = snapshot.background;
  run.backgroundFactConflicts = snapshot.backgroundFactConflicts;
  run.voiceSamples = new Map(snapshot.voiceSamples);
  run.skeleton = snapshot.skeleton;
  run.sceneCoordinates = restoreSceneCoordinates(snapshot.sceneCoordinates);
  run.polishedText = snapshot.polishedText;
  run.skeletonCallParagraphs = snapshot.skeletonCallParagraphs;
  run.skeletonFacts = snapshot.skeletonFacts ?? [];
  run.skeletonBeatStarts =
    snapshot.skeletonBeatStarts === undefined ? undefined : new Map(snapshot.skeletonBeatStarts);
  run.dialoguePolish = snapshot.dialoguePolish;
  run.draftBody = snapshot.draftBody;
  run.dialogueRecord = snapshot.dialogueRecord;
}

function withoutStage(warning: SceneStageWarning): SceneWarning {
  const { stage: _stage, ...sceneWarning } = warning;

  return sceneWarning;
}

export class SceneRunCheckpoints {
  private readonly finishedStages: SceneStageId[];
  private readonly finishedWarnings: SceneStageWarning[];
  private resumedExpansion: SceneExpansionProgress | undefined;
  private warningCountAtStageStart: number = 0;

  public constructor(
    private readonly resumeFrom: SceneRunCheckpoint | undefined,
    private readonly save: SaveSceneRunCheckpoint | undefined,
  ) {
    this.finishedStages = [...(resumeFrom?.finishedStages ?? [])];
    this.finishedWarnings = [...(resumeFrom?.warnings ?? [])];
    this.resumedExpansion = resumeFrom?.expansion;
  }

  public restoreInto(run: SceneRunState): readonly SceneStageWarning[] {
    if (this.resumeFrom === undefined) {
      return [];
    }

    restoreSceneRun(run, this.resumeFrom.run);
    run.warnings.push(...this.finishedWarnings.map(withoutStage));
    return this.finishedWarnings;
  }

  public isFinished(stage: SceneStageId): boolean {
    return this.finishedStages.includes(stage);
  }

  public beginStage(warningCount: number): void {
    this.warningCountAtStageStart = warningCount;
  }

  public async finishStage(
    run: SceneRunState,
    stage: SceneStageId,
    warnings: readonly SceneStageWarning[],
  ): Promise<void> {
    this.finishedStages.push(stage);
    this.finishedWarnings.push(...warnings);
    await this.save?.({
      finishedStages: [...this.finishedStages],
      warnings: [...this.finishedWarnings],
      run: captureSceneRun(run),
    });
  }

  public takeResumedExpansion(): SceneExpansionProgress | undefined {
    const resumed: SceneExpansionProgress | undefined = this.resumedExpansion;
    this.resumedExpansion = undefined;

    return resumed;
  }

  public async recordExpansion(run: SceneRunState, sections: readonly string[]): Promise<void> {
    await this.save?.({
      finishedStages: [...this.finishedStages],
      warnings: [...this.finishedWarnings],
      run: captureSceneRun(run),
      expansion: { sections: [...sections], warnings: run.warnings.slice(this.warningCountAtStageStart) },
    });
  }
}
