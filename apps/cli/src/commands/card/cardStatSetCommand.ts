import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  describeUnknownStatOrigin,
  statOriginFrom,
  statOriginLabels,
} from '@/commands/card/cardStatViews';
import { failure, success } from '@/commands/outcomes';
import type { SetCardStatResult } from '@storyboard/story-engine';
import { bundleFileNames, type StatOrigin } from '@storyboard/story-model';

const setOutcomeLabels: Readonly<Record<'added' | 'replaced' | 'unchanged', string>> = {
  added: '적었습니다',
  replaced: '바꿨습니다',
  unchanged: '이미 같은 값입니다',
};

export class CardStatSetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card stat set',
    writesWorkspace: true,
    group: '카드',
    usage: 'card stat set <slug> <축> <값> [--origin <author|training>]',
    summary:
      'stats.yaml 에 스탯 하나를 적습니다 (값은 1~5. 작가가 적은 값은 훈련이 바꾸지 못합니다)',
    flags: ['origin'],
    examples: [
      'storyboard card stat set elia 대담함 2',
      'storyboard card stat set elia 말수 4 --origin training',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const [slug, stat, valueText] = args.positionals;
    if (slug === undefined || stat === undefined || valueText === undefined) {
      return failure('적을 스탯을 모두 주세요: storyboard card stat set <slug> <축> <값>');
    }

    const origin: StatOrigin | undefined = statOriginFrom(args.flags);
    if (origin === undefined) {
      return failure(describeUnknownStatOrigin());
    }

    const result: SetCardStatResult = await container.cards.setStat({
      workspaceRoot: container.workspaceRoot,
      slug,
      stat,
      value: Number(valueText),
      origin,
    });

    return result.ok
      ? success(
          `✓ ${result.path}/${bundleFileNames.stats}: ${result.stat.stat} ${result.stat.value} ${setOutcomeLabels[result.kind]} (출처 ${statOriginLabels[result.stat.source.origin]})`,
          result,
        )
      : failure(result.message, result);
  }
}
