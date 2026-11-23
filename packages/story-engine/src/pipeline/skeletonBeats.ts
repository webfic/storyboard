import { placeBeatsByParagraph, splitDraftParagraphs, type ParagraphSpan } from '#engine/pipeline/beatLocations';
import type { BeatLocation } from '@storyboard/story-model';

export interface SkeletonCallParagraphs {
  readonly beatNumbers: readonly number[];
  readonly paragraphCount: number;
}

export function beatsByParagraphFromCalls(
  calls: readonly SkeletonCallParagraphs[],
  paragraphCount: number,
): readonly (readonly number[])[] | undefined {
  const callParagraphTotal: number = calls.reduce((sum, call) => sum + call.paragraphCount, 0);
  if (calls.length === 0 || callParagraphTotal !== paragraphCount) {
    return undefined;
  }

  return calls.flatMap((call) => Array.from({ length: call.paragraphCount }, () => call.beatNumbers));
}

function paragraphIndexAt(paragraphs: readonly ParagraphSpan[], offset: number): number {
  return paragraphs.findIndex((paragraph) => paragraph.start <= offset && offset <= paragraph.end);
}

export function beatsByParagraphFromStarts(
  beatCount: number,
  paragraphs: readonly ParagraphSpan[],
  startParagraphByBeat: ReadonlyMap<number, number>,
): readonly (readonly number[])[] | undefined {
  const locations: readonly BeatLocation[] = placeBeatsByParagraph(beatCount, paragraphs, startParagraphByBeat);
  const isEveryBeatLocated: boolean = locations.length > 0 && locations.every((location) => location.isLocated);
  if (!isEveryBeatLocated) {
    return undefined;
  }

  const beatsByParagraph: number[][] = paragraphs.map(() => []);
  for (const location of locations) {
    if (!location.isLocated) {
      continue;
    }
    const first: number = paragraphIndexAt(paragraphs, location.start);
    const last: number = paragraphIndexAt(paragraphs, location.end);
    for (let index: number = first; index >= 0 && index <= last; index += 1) {
      beatsByParagraph[index]?.push(location.beat);
    }
  }

  return beatsByParagraph;
}

export function sectionOwnBeatNumbers(
  sections: readonly string[],
  beatsByParagraph: readonly (readonly number[])[] | undefined,
): readonly (readonly number[])[] | undefined {
  if (beatsByParagraph === undefined) {
    return undefined;
  }

  const paragraphCounts: readonly number[] = sections.map((section) => splitDraftParagraphs(section).length);
  const sectionParagraphTotal: number = paragraphCounts.reduce((sum, count) => sum + count, 0);
  if (sectionParagraphTotal !== beatsByParagraph.length) {
    return undefined;
  }

  let firstParagraph: number = 0;
  return paragraphCounts.map((count) => {
    const covered: readonly (readonly number[])[] = beatsByParagraph.slice(firstParagraph, firstParagraph + count);
    firstParagraph += count;
    return [...new Set(covered.flat())].sort((left, right) => left - right);
  });
}
