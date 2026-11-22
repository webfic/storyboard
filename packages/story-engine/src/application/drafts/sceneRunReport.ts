import type { ConfigBridge } from '@storyboard/story-ai';
import { parseDraft, type BeatLocation, type UsageRecord } from '@storyboard/story-model';
import type { BeatLocator } from '#engine/application/drafts/beatLocator';
import type { GenerateDraftResult } from '#engine/application/drafts/generateDraftUseCase';
import { isSeedHonouredByEveryCall, summarizeUsageByStage, type StageUsage } from '#engine/application/ai/stageUsage';
import type { UsageMeter, UsageMeterSession } from '#engine/application/ai/usageMeter';
import { locateBeatRanges, type BeatRange } from '#engine/pipeline/beatRanges';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface SceneRunReport {
  readonly usage: readonly StageUsage[];
  readonly seedHonoured?: boolean;
  readonly beatRanges?: readonly BeatRange[];
  readonly beatLocations?: readonly BeatLocation[];
}

interface FinalDraftPlacement {
  readonly beatRanges?: readonly BeatRange[];
  readonly beatLocations?: readonly BeatLocation[];
}

export interface MeasuredSceneRun<T> {
  readonly outcome: T;
  readonly report: SceneRunReport;
}

export interface SceneRunReporterDependencies {
  readonly usageMeter: UsageMeter;
  readonly fileSystem: IFileSystem;
  readonly configBridge: Pick<ConfigBridge, 'getSeed'>;
  readonly beatLocator: BeatLocator;
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
      const placement: FinalDraftPlacement = await this.placeFinalDraftBeats(generationOf(outcome));

      return { outcome, report: this.describeSpending(spending.records(), placement) };
    } finally {
      spending.stop();
    }
  }

  private describeSpending(
    records: readonly UsageRecord[],
    placement: FinalDraftPlacement,
  ): SceneRunReport {
    const hasSeededCalls: boolean = this.deps.configBridge.getSeed() !== undefined && records.length > 0;

    return {
      usage: summarizeUsageByStage(records),
      ...(hasSeededCalls ? { seedHonoured: isSeedHonouredByEveryCall(records) } : {}),
      ...placement,
    };
  }

  private async placeFinalDraftBeats(generation: GenerateDraftResult): Promise<FinalDraftPlacement> {
    if (!generation.ok || generation.kind !== 'generated') {
      return {};
    }
    const hasNothingToPlace: boolean =
      generation.beatSegments === undefined && generation.beatsToLocate === undefined;
    if (hasNothingToPlace) {
      return {};
    }

    const finalBody: string = parseDraft(
      new TextDecoder().decode(await this.deps.fileSystem.readFile(generation.draftUri)),
    ).body;
    const beatRanges: readonly BeatRange[] | undefined =
      generation.beatSegments === undefined ? undefined : locateBeatRanges(finalBody, generation.beatSegments);
    const beatLocations: readonly BeatLocation[] | undefined =
      generation.beatsToLocate === undefined
        ? undefined
        : await this.deps.beatLocator.locate(generation.beatsToLocate, finalBody);

    return {
      ...(beatRanges === undefined ? {} : { beatRanges }),
      ...(beatLocations === undefined ? {} : { beatLocations }),
    };
  }
}
