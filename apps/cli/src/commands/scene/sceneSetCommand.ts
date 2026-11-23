import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean, flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import { readBeatChanges, readBeatNumber, type BeatChangesReading, type BeatNumberReading } from '@/commands/scene/sceneBeatInput';
import type {
  EditSceneBeatResult,
  SceneTargetLengthScenes,
  SetSceneTargetLengthResult,
} from '@storyboard/story-engine';

export class SceneSetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene set',
    writesWorkspace: true,
    group: '씬',
    usage:
      'scene set <씬> | --all --target-words <n>  /  scene set <씬> --beat <n> [--text <text>] [--cast <ids>] [--place <card>] [--time <text>] [--break true|false]',
    summary:
      '씬 카드의 목표 분량(자)을 정하거나(--all 은 모든 씬, 작품 계약의 목표 분량은 project set), --beat 로 비트 하나의 내용·출연·장소·시각·씬 나눔을 고칩니다',
    flags: ['all', 'target-words', 'beat', 'text', 'cast', 'place', 'time', 'break'],
    examples: [
      'storyboard scene set 001-first-meeting --target-words 20000',
      'storyboard scene set --all --target-words 20000',
      'storyboard scene set 001-first-meeting --beat 12 --break true',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const beat: BeatNumberReading = readBeatNumber(args);
    if (beat === undefined) {
      return await this.setTargetLength({ container, args });
    }
    if ('problem' in beat) {
      return failure(beat.problem);
    }

    return await this.editBeat({ container, args }, beat.beatNumber);
  }

  private async editBeat({ container, args }: CommandContext, beatNumber: number): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    const reading: BeatChangesReading = readBeatChanges(args);
    if (stem === undefined) {
      return failure('고칠 씬을 지정해 주세요.');
    }
    if ('problem' in reading) {
      return failure(reading.problem);
    }

    const edited: EditSceneBeatResult = await container.drafts.editSceneBeat({
      workspaceRoot: container.workspaceRoot,
      scene: stem,
      beatNumber,
      changes: reading.changes,
      removedFields: [],
    });
    return edited.ok
      ? success(`${edited.stem} 의 비트 ${beatNumber}번을 고쳤습니다.`, edited)
      : failure(edited.message);
  }

  private async setTargetLength({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    const scenes: SceneTargetLengthScenes | undefined = flagBoolean(args.flags, 'all')
      ? 'all'
      : stem === undefined
        ? undefined
        : [stem];
    const rawTargetWords: string | undefined = flagString(args.flags, 'target-words');
    if (scenes === undefined || rawTargetWords === undefined) {
      return failure('정할 씬(또는 --all)과 --target-words <n> 을 지정해 주세요.');
    }

    const targetWordCount: number = Number(rawTargetWords);
    const isPositiveInteger: boolean = Number.isInteger(targetWordCount) && targetWordCount > 0;
    if (!isPositiveInteger) {
      return failure(`--target-words 는 양의 정수여야 합니다: ${rawTargetWords}`);
    }

    const written: SetSceneTargetLengthResult = await container.drafts.setSceneTargetLength({
      workspaceRoot: container.workspaceRoot,
      scenes,
      targetWordCount,
    });
    if (!written.ok) {
      return failure(written.message);
    }

    return success(
      `씬 ${written.stems.length}개의 목표 분량을 약 ${targetWordCount.toLocaleString('en-US')}자로 정했습니다.`,
      written,
    );
  }
}
