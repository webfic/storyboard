import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeUnknownStatOrigin, statOriginFrom } from '@/commands/card/cardStatViews';
import { failure, success } from '@/commands/outcomes';
import type { UnsetCardStatResult } from '@storyboard/story-engine';
import { bundleFileNames, type StatOrigin } from '@storyboard/story-model';

export class CardStatUnsetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card stat unset',
    writesWorkspace: true,
    group: '카드',
    usage: 'card stat unset <slug> <축> [--origin <author|training>]',
    summary: 'stats.yaml 에서 스탯 하나를 지웁니다 (작가가 적은 값은 훈련이 지우지 못합니다)',
    flags: ['origin'],
    examples: ['storyboard card stat unset elia 말수'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const [slug, stat] = args.positionals;
    if (slug === undefined || stat === undefined) {
      return failure('지울 스탯을 주세요: storyboard card stat unset <slug> <축>');
    }

    const origin: StatOrigin | undefined = statOriginFrom(args.flags);
    if (origin === undefined) {
      return failure(describeUnknownStatOrigin());
    }

    const result: UnsetCardStatResult = await container.cards.unsetStat({
      workspaceRoot: container.workspaceRoot,
      slug,
      stat,
      origin,
    });

    return result.ok
      ? success(
          `✓ ${result.path}/${bundleFileNames.stats}: ${result.stat.stat} ${result.stat.value} 을(를) 지웠습니다.`,
          result,
        )
      : failure(result.message, result);
  }
}
