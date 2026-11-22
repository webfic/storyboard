import type { ConfigBridge } from '@storyboard/story-ai';
import { parseDraft, type UsageRecord } from '@storyboard/story-model';
import type { GenerateDraftResult } from '#engine/application/drafts/generateDraftUseCase';
import { isSeedHonouredByEveryCall, summarizeUsageByStage, type StageUsage } from '#engine/application/ai/stageUsage';
import type { UsageMeter, UsageMeterSession } from '#engine/application/ai/usageMeter';
import { locateBeatRanges, type BeatRange } from '#engine/pipeline/beatRanges';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface SceneRunReport {
  readonly usage: readonly StageUsage[];
  readonly seedHonoured?: boolean;
  readonly beatRanges?: readonly BeatRange[];
}

export interface MeasuredSceneRun<T> {
  readonly outcome: T;
  readonly report: SceneRunReport;
}

export interface SceneRunReporterDependencies {
  readonly usageMeter: UsageMeter;
  readonly fileSystem: IFileSystem;
  readonly configBridge: Pick<ConfigBridge, 'getSeed'>;
}

export class SceneRunReporter {
  public constructor(private readonly deps: SceneRunReporterDependencies) {}

  public async measure<T>(
    runScene: () => Promise<T>,
    generationOf: (outcome: T) => GenerateDraftResult,
  ): Promise<MeasuredSceneRun<T>> {
    const spending: UsageMeterSession = this.deps.usageMeter.startSession();

    try {
      const outcome: T = await runScene();
      const beatRanges: readonly BeatRange[] | undefined = await this.locateFinalBeatRanges(
        generationOf(outcome),
      );

      return { outcome, report: this.describeSpending(spending.records(), beatRanges) };
    } finally {
      spending.stop();
    }
  }

  private describeSpending(
    records: readonly UsageRecord[],
    beatRanges: readonly BeatRange[] | undefined,
  ): SceneRunReport {
    const hasSeededCalls: boolean = this.deps.configBridge.getSeed() !== undefined && records.length > 0;

    return {
      usage: summarizeUsageByStage(records),
      ...(hasSeededCalls ? { seedHonoured: isSeedHonouredByEveryCall(records) } : {}),
      ...(beatRanges === undefined ? {} : { beatRanges }),
    };
  }

  private async locateFinalBeatRanges(
    generation: GenerateDraftResult,
  ): Promise<readonly BeatRange[] | undefined> {
    if (!generation.ok || generation.kind !== 'generated' || generation.beatSegments === undefined) {
      return undefined;
    }

    const finalText: string = new TextDecoder().decode(
      await this.deps.fileSystem.readFile(generation.draftUri),
    );
    return locateBeatRanges(parseDraft(finalText).body, generation.beatSegments);
  }
}
