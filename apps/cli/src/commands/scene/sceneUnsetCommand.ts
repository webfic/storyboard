import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { sceneBeatFields, sceneUnsetFields, type SceneBeatField, type SceneUnsetField } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import { readBeatNumber, type BeatNumberReading } from '@/commands/scene/sceneBeatInput';
import type {
  EditSceneBeatResult,
  SceneTargetLengthScenes,
  SetSceneTargetLengthResult,
} from '@storyboard/story-engine';

export class SceneUnsetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene unset',
    writesWorkspace: true,
    group: '씬',
    usage: `scene unset <씬> | --all <${sceneUnsetFields.join('|')}>  /  scene unset <씬> --beat <n> <${sceneBeatFields.join('|')}>`,
    summary:
      '씬 카드의 목표 분량을 지우거나(본문의 [목표 분량]이나 씬 개요 길이로 정한 값이 쓰입니다), --beat 로 비트 하나의 항목을 지웁니다',
    flags: ['all', 'beat'],
    examples: [
      'storyboard scene unset 001-first-meeting target-words',
      'storyboard scene unset --all target-words',
      'storyboard scene unset 001-first-meeting --beat 12 break',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const beat: BeatNumberReading = readBeatNumber(args);
    if (beat === undefined) {
      return await this.unsetTargetLength({ container, args });
    }
    if ('problem' in beat) {
      return failure(beat.problem);
    }

    return await this.unsetBeatField({ container, args }, beat.beatNumber);
  }

  private async unsetBeatField({ container, args }: CommandContext, beatNumber: number): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    const field: string | undefined = args.positionals[1];
    const isKnownField: boolean = sceneBeatFields.includes(field as SceneBeatField);
    if (stem === undefined || !isKnownField) {
      return failure(`지울 씬과 비트 항목(${sceneBeatFields.join(', ')})을 지정해 주세요.`);
    }

    const edited: EditSceneBeatResult = await container.drafts.editSceneBeat({
      workspaceRoot: container.workspaceRoot,
      scene: stem,
      beatNumber,
      changes: {},
      removedFields: [field as SceneBeatField],
    });
    return edited.ok
      ? success(`${edited.stem} 의 비트 ${beatNumber}번에서 ${field} 를 지웠습니다.`, edited)
      : failure(edited.message);
  }

  private async unsetTargetLength({ container, args }: CommandContext): Promise<CommandOutcome> {
    const isAll: boolean = flagBoolean(args.flags, 'all');
    const field: string | undefined = args.positionals[isAll ? 0 : 1];
    const stem: string | undefined = sceneStemFrom(args);
    const scenes: SceneTargetLengthScenes | undefined = isAll ? 'all' : stem === undefined ? undefined : [stem];
    const isKnownField: boolean = sceneUnsetFields.includes(field as SceneUnsetField);
    if (scenes === undefined || !isKnownField) {
      return failure(`지울 씬(또는 --all)과 항목(${sceneUnsetFields.join(', ')})을 지정해 주세요.`);
    }

    const written: SetSceneTargetLengthResult = await container.drafts.setSceneTargetLength({
      workspaceRoot: container.workspaceRoot,
      scenes,
      targetWordCount: undefined,
    });
    if (!written.ok) {
      return failure(written.message);
    }

    return success(`씬 ${written.stems.length}개의 목표 분량을 지웠습니다.`, written);
  }
}
