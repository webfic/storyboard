import { flagString } from '@/cliArguments';
import type { ListedCardStat } from '@storyboard/story-engine';
import {
  highestStatValue,
  lowestStatValue,
  statOrigins,
  type StatAxis,
  type StatOrigin,
} from '@storyboard/story-model';

export const statOriginLabels: Readonly<Record<StatOrigin, string>> = {
  author: '작가',
  training: '훈련',
};

const unknownAxisNote: string = '축 목록에 없는 축이라 생성에 쓰이지 않습니다';

export function statOriginFrom(
  flags: Readonly<Record<string, string | boolean>>,
): StatOrigin | undefined {
  const requested: string = flagString(flags, 'origin') ?? 'author';

  return statOrigins.find((origin) => origin === requested);
}

export function describeUnknownStatOrigin(): string {
  return `--origin 은 ${statOrigins.join(' 또는 ')} 이어야 합니다.`;
}

export function describeListedStat(listed: ListedCardStat): string {
  const { stat, value, source } = listed.stat;

  return `${stat} ${value}/${highestStatValue} (${statOriginLabels[source.origin]}) ${listed.meaning ?? unknownAxisNote}`;
}

export function describeStatAxisLines(axis: StatAxis): readonly string[] {
  return [
    `${axis.name}: ${axis.definition}`,
    ...axis.levels.map((meaning, index) => `    ${lowestStatValue + index} ${meaning}`),
  ];
}
