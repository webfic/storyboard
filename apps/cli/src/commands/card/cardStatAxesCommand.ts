import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeStatAxisLines } from '@/commands/card/cardStatViews';
import { failure, success } from '@/commands/outcomes';
import {
  elementKindLabels,
  isElementKind,
  listStatAxesOf,
  resolveStatAxisCatalog,
  statAxisGroupLabels,
  statAxisGroups,
  type ElementKind,
  type StatAxis,
  type StatAxisGroup,
} from '@storyboard/story-model';

const defaultAxisKind: ElementKind = 'character';

function describeGroupLines(group: StatAxisGroup, axes: readonly StatAxis[]): readonly string[] {
  const groupAxes: readonly StatAxis[] = axes.filter((axis) => axis.group === group);

  return groupAxes.length === 0
    ? []
    : [`[${statAxisGroupLabels[group]}]`, ...groupAxes.flatMap(describeStatAxisLines), ''];
}

export class CardStatAxesCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card stat axes',
    group: '카드',
    needsWorkspace: false,
    usage: 'card stat axes [character|background|narrator]',
    summary: '스탯으로 적을 수 있는 축과 1~5 단계의 뜻을 봅니다 (기본: 인물)',
    examples: ['storyboard card stat axes', 'storyboard card stat axes narrator'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const requested: string = args.positionals[0] ?? defaultAxisKind;
    if (!isElementKind(requested)) {
      return failure(`알 수 없는 카드 종류입니다: ${requested}`);
    }

    await container.loadResourceOverrides();

    const axes: readonly StatAxis[] = listStatAxesOf(resolveStatAxisCatalog(), requested);
    const lines: readonly string[] =
      axes.length > 0
        ? statAxisGroups.flatMap((group) => describeGroupLines(group, axes))
        : [`${elementKindLabels[requested]} 카드에 쓸 수 있는 축이 아직 없습니다.`];

    return success(lines.join('\n').trimEnd(), { kind: requested, axes });
  }
}
