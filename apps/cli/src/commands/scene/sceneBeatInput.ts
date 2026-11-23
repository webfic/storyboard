import { flagString } from '@/cliArguments';
import type { RawArguments } from '@/cliArguments';
import type { SceneBeatChanges } from '@storyboard/story-engine';

export type BeatNumberReading = { readonly beatNumber: number } | { readonly problem: string } | undefined;

export type BeatChangesReading = { readonly changes: SceneBeatChanges } | { readonly problem: string };

const breakValues: Readonly<Record<string, boolean>> = { true: true, false: false };

export function readBeatNumber(args: Pick<RawArguments, 'flags'>): BeatNumberReading {
  const raw: string | undefined = flagString(args.flags, 'beat');
  if (raw === undefined) {
    return undefined;
  }

  const beatNumber: number = Number(raw);
  const isPositiveInteger: boolean = Number.isInteger(beatNumber) && beatNumber > 0;
  return isPositiveInteger ? { beatNumber } : { problem: `--beat 는 1 이상의 정수여야 합니다: ${raw}` };
}

function splitCastList(raw: string): string[] {
  return raw
    .split(',')
    .map((reference) => reference.trim())
    .filter((reference) => reference.length > 0);
}

export function readBeatChanges(args: Pick<RawArguments, 'flags'>): BeatChangesReading {
  const text: string | undefined = flagString(args.flags, 'text');
  const cast: string | undefined = flagString(args.flags, 'cast');
  const place: string | undefined = flagString(args.flags, 'place');
  const time: string | undefined = flagString(args.flags, 'time');
  const rawBreak: string | undefined = flagString(args.flags, 'break');
  const shouldBreak: boolean | undefined = rawBreak === undefined ? undefined : breakValues[rawBreak];

  if (rawBreak !== undefined && shouldBreak === undefined) {
    return { problem: `--break 는 true 나 false 여야 합니다: ${rawBreak}` };
  }

  const changes: SceneBeatChanges = {
    ...(text === undefined ? {} : { text }),
    ...(cast === undefined ? {} : { cast: splitCastList(cast) }),
    ...(place === undefined ? {} : { place }),
    ...(time === undefined ? {} : { time }),
    ...(shouldBreak === undefined ? {} : { break: shouldBreak }),
  };
  return Object.keys(changes).length === 0
    ? { problem: '바꿀 항목(--text, --cast, --place, --time, --break)을 하나 이상 지정해 주세요.' }
    : { changes };
}
