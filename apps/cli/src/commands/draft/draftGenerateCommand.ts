import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  describeBatchFailure,
  describeBatchStep,
  sceneStageLabels,
} from '@/commands/draft/draftProgress';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import {
  describeMissingChapterSummaries,
  WorkspaceInput,
  cancelledBeforeRun,
  type PaidRunSummary,
} from '@/commands/workspaceInput';
import { resolveSceneStemFrom, sceneUriFor } from '@/commands/sceneArguments';
import {
  describeReviseOutcome,
  draftWarningMessages,
  type DraftWarning,
  type GenerateAllDraftsResult,
  type GenerateAllDraftsSummary,
  type ReviseDraftWorkflowResult,
  type ReviseOutcome,
  type StageUsage,
  type BeatRange,
  type DraftRunReuse,
  type GenerateDraftResult,
  addBeatSpansToWarnings,
} from '@storyboard/story-engine';
import type { GenerateAndReviseDraftResult, ReadyDraft, WorkspaceStatus } from '@storyboard/story-app';
import type { BeatLocation, DraftGenerationStepId, StoryUri } from '@storyboard/story-model';

export class DraftGenerateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'draft generate',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft generate <stem> | --all',
    summary: '씬 초안을 생성합니다 (--force 로 재생성, --all 은 필요한 씬만, --all --force 는 모든 씬을 다시)',
    flags: ['all', 'force', 'no-revise', 'revise-iterations', 'params'],
    examples: ['storyboard draft generate 001-scene-1-1', 'storyboard draft generate --all'],
  };

  public async execute(context: CommandContext): Promise<CommandOutcome> {
    return flagBoolean(context.args.flags, 'all')
      ? this.generateAll(context)
      : this.generateScene(context);
  }

  private async generateAll({ container, args }: CommandContext): Promise<CommandOutcome> {
    const isForced: boolean = flagBoolean(args.flags, 'force');
    const isConfirmed: boolean = await new WorkspaceInput(container).confirmPaidRun((status) =>
      isForced ? describeForcedBatchTarget(status) : describePendingBatchTarget(status),
    );

    if (!isConfirmed) {
      return cancelledBeforeRun;
    }

    const batchGeneration: GenerateAllDraftsResult = await container.drafts.generateAll({
      force: isForced,
      shouldPause: container.pauseRequests.watch(),
      onProgress: (progress) => {
        const step: string = describeBatchStep(progress);
        container.progress.update({
          line: `${progress.current}/${progress.total} ${progress.label} · ${step}`,
          unit: { current: progress.current, total: progress.total, label: progress.label },
          step,
        });
      },
    });

    if (!batchGeneration.ok) {
      return failure(describeBatchFailure(batchGeneration.kind), batchGeneration);
    }

    return describeBatchSummary(batchGeneration.summary, { isForced });
  }

  private async generateScene({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = await resolveSceneStemFrom(container, args);
    if (stem === undefined) {
      return failure('씬 stem을 지정해 주세요. 예: storyboard draft generate 001-scene-1-1');
    }

    const { generation, revision, usage, seedHonoured, beatRanges, beatLocations }: GenerateAndReviseDraftResult =
      await container.drafts.generateAndRevise({
        sceneUri: sceneUriFor(container.workspaceRoot, stem),
        force: flagBoolean(args.flags, 'force'),
        isReviseAllowed: !flagBoolean(args.flags, 'no-revise'),
        onPipelineProgress: (stage, current, total) => {
          const step: string = `${sceneStageLabels[stage] ?? stage} ${current}/${total}`;
          container.progress.update({ line: step, step });
        },
        onDraftReady: (draft) => {
          for (const message of draftWarningMessages(draftWarningsOf(draft))) {
            container.logger.warn(message);
          }
        },
        onReviseProgress: (message) => container.progress.update({ line: message, step: message }),
      });

    if (!generation.ok) {
      return describeStoppedRun(generation);
    }

    return this.describeGeneratedScene(container, {
      generation,
      revision,
      usage,
      seedHonoured,
      beatRanges,
      beatLocations,
    });
  }

  private describeGeneratedScene(
    container: CommandContext['container'],
    { generation: draft, revision, usage, seedHonoured, beatRanges, beatLocations }: GeneratedSceneRun,
  ): CommandOutcome {
    const warnings: readonly DraftWarning[] = addBeatSpansToWarnings(draftWarningsOf(draft), beatLocations);
    const revise: ReviseOutcome | undefined = revision && describeReviseOutcome(revision);
    const reviseStage: DraftGenerationStepId = 'reviseLoop';

    if (revise?.warning) {
      container.logger.warn(revise.warning);
    }

    const isCached: boolean = draft.kind === 'cache_hit';
    const reused: DraftRunReuse | undefined = draft.kind === 'generated' ? draft.reused : undefined;
    return success(
      describeGeneratedMessage({ isCached, reused }),
      {
        draft: (draft.draftUri as StoryUri).fsPath,
        cached: isCached,
        usage,
        ...(seedHonoured === undefined ? {} : { seedHonoured }),
        ...(beatRanges === undefined ? {} : { beatRanges }),
        ...(beatLocations === undefined ? {} : { beatLocations }),
        ...(draft.kind === 'generated' && draft.traceRunId !== undefined
          ? { traceRunId: draft.traceRunId }
          : {}),
        ...(reused === undefined ? {} : { reused }),
        warnings: revise?.warning
          ? [...warnings, { message: revise.warning, stage: reviseStage }]
          : warnings,
        ...(revise === undefined ? {} : { revise }),
      },
    );
  }
}

interface GeneratedSceneRun {
  readonly generation: ReadyDraft;
  readonly revision: ReviseDraftWorkflowResult | undefined;
  readonly usage: readonly StageUsage[];
  readonly seedHonoured: boolean | undefined;
  readonly beatRanges: readonly BeatRange[] | undefined;
  readonly beatLocations: readonly BeatLocation[] | undefined;
}

function draftWarningsOf(draft: ReadyDraft): readonly DraftWarning[] {
  return draft.kind === 'generated' ? draft.warnings : [];
}

function describePendingBatchTarget(status: WorkspaceStatus): PaidRunSummary {
  const pending: number = status.drafts.missing + status.drafts.stale;
  return {
    title: `초안 ${pending}개 생성`,
    details: [
      `대상  초안이 없거나 카드보다 오래된 씬 ${pending}개 (전체 ${status.scenes.total}개)`,
      ...describeMissingChapterSummaries(status),
    ],
  };
}

function describeForcedBatchTarget(status: WorkspaceStatus): PaidRunSummary {
  return {
    title: `초안 ${status.scenes.total}개 다시 생성`,
    details: [
      `대상  모든 씬 ${status.scenes.total}개 (--force: 입력이 같은 씬도 다시 만듭니다)`,
      ...describeMissingChapterSummaries(status),
    ],
  };
}

const pausedBatchResumeHint: string = '다시 실행하면 남은 씬부터 이어 갑니다.';
const pausedForcedBatchResumeHint: string =
  '--force 와 함께 다시 실행하면 처음 씬부터 다시 만들고, --force 없이 실행하면 바뀐 씬만 만듭니다.';

function describeBatchSummary(
  summary: GenerateAllDraftsSummary,
  { isForced }: { readonly isForced: boolean },
): CommandOutcome {
  const { cacheHits, failureLabels, failures, generated, pausedWithRemaining } = summary;

  if (pausedWithRemaining !== undefined) {
    return {
      ok: false,
      message:
        `멈췄습니다: 생성 ${generated}건, 남은 씬 ${pausedWithRemaining}개. ` +
        (isForced ? pausedForcedBatchResumeHint : pausedBatchResumeHint),
      data: summary,
      stop: 'paused',
    };
  }

  return {
    ok: failures === 0,
    message:
      failures === 0
        ? `초안 ${generated}건 생성, ${cacheHits}건은 입력이 같아 그대로 둡니다.`
        : `${failures}건 실패 (생성 ${generated}건, 캐시 ${cacheHits}건): ${failureLabels.join(', ')}`,
    data: summary,
  };
}

type StoppedDraftRun = Extract<GenerateDraftResult, { readonly ok: false }>;

const resumeHint: string = '--force 없이 다시 실행하면 이어서 합니다.';

function describeStopPoint(stopped: StoppedDraftRun): string | undefined {
  if (stopped.failedStage === undefined) {
    return undefined;
  }

  const stageLabel: string = sceneStageLabels[stopped.failedStage] ?? stopped.failedStage;
  const section: string = stopped.failedSection === undefined ? '' : ` ${stopped.failedSection}구간`;
  return `${stageLabel}${section}에서 멈췄습니다.`;
}

function describeStoppedRun(stopped: StoppedDraftRun): CommandOutcome {
  const reason: string = stopped.kind === 'failed' ? stopped.message : '취소했습니다.';
  const message: string = [
    reason,
    describeStopPoint(stopped),
    stopped.isResumable === true ? resumeHint : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');

  return failure(message, {
    ...(stopped.failedStage === undefined ? {} : { failedStage: stopped.failedStage }),
    ...(stopped.failedSection === undefined ? {} : { failedSection: stopped.failedSection }),
    isResumable: stopped.isResumable === true,
  });
}

function describeGeneratedMessage(run: { readonly isCached: boolean; readonly reused: DraftRunReuse | undefined }): string {
  if (run.isCached) {
    return '입력이 같아 기존 초안을 씁니다.';
  }
  if (run.reused === undefined) {
    return '초안을 생성했습니다.';
  }

  const sections: string =
    run.reused.expansionSections === 0 ? '' : `, 살붙임 ${run.reused.expansionSections}구간`;
  return `멈춘 실행을 이어 초안을 생성했습니다 (그대로 쓴 단계 ${run.reused.stages.length}개${sections}).`;
}
