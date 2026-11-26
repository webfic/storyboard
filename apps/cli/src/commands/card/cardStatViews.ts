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

const originOfPersonAtTheTerminal: StatOrigin = 'author';

export type StatOriginReading =
  | { readonly ok: true; readonly origin: StatOrigin }
  | { readonly ok: false; readonly message: string };

export interface StatOriginRequest {
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly canPersonAnswer: boolean;
}

export function readStatOrigin(request: StatOriginRequest): StatOriginReading {
  const requested: string | undefined = flagString(request.flags, 'origin');
  if (requested === undefined) {
    return request.canPersonAnswer
      ? { ok: true, origin: originOfPersonAtTheTerminal }
      : {
          ok: false,
          message: `사람이 답할 수 없는 실행에서는 적는 주체를 밝혀 주세요: --origin ${statOrigins.join(' 또는 --origin ')}`,
        };
  }

  const origin: StatOrigin | undefined = statOrigins.find((candidate) => candidate === requested);

  return origin === undefined
    ? { ok: false, message: `--origin 은 ${statOrigins.join(' 또는 ')} 이어야 합니다.` }
    : { ok: true, origin };
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
