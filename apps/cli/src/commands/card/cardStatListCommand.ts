import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeListedStat } from '@/commands/card/cardStatViews';
import { failure, success } from '@/commands/outcomes';
import type { ListCardStatsResult } from '@storyboard/story-engine';
import { bundleFileNames } from '@storyboard/story-model';

export class CardStatListCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card stat list',
    group: '카드',
    usage: 'card stat list <slug>',
    summary: '카드의 스탯을 값, 적은 주체, 그 단계의 뜻과 함께 봅니다',
    examples: ['storyboard card stat list elia', 'storyboard card stat list elia --json'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const slug: string | undefined = args.positionals[0];
    if (slug === undefined) {
      return failure('카드 slug 를 지정해 주세요: storyboard card stat list <slug>');
    }

    const result: ListCardStatsResult = await container.cards.listStats({
      workspaceRoot: container.workspaceRoot,
      slug,
    });
    if (!result.ok) {
      return failure(result.message, result);
    }

    const lines: readonly string[] =
      result.stats.length > 0 ? result.stats.map(describeListedStat) : ['(스탯 없음)'];

    return success([`${result.path}/${bundleFileNames.stats}`, ...lines].join('\n'), result);
  }
}
