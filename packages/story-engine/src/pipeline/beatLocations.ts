import type { BeatLocation } from '@storyboard/story-model';

export interface ParagraphSpan {
  readonly start: number;
  readonly end: number;
}

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

const sceneBreakLine: string = '---';

function isParagraphLine(line: string): boolean {
  const trimmed: string = line.trim();
  return trimmed.length > 0 && trimmed !== sceneBreakLine;
}

export function splitDraftParagraphs(body: string): readonly ParagraphSpan[] {
  const paragraphs: ParagraphSpan[] = [];
  let openStart: number | undefined;
  let openEnd: number = 0;
  let lineStart: number = 0;

  for (const line of body.split('\n')) {
    const lineEnd: number = lineStart + line.trimEnd().length;

    if (isParagraphLine(line)) {
      openStart ??= lineStart + (line.length - line.trimStart().length);
      openEnd = lineEnd;
    } else if (openStart !== undefined) {
      paragraphs.push({ start: openStart, end: openEnd });
      openStart = undefined;
    }

    lineStart += line.length + 1;
  }

  if (openStart !== undefined) {
    paragraphs.push({ start: openStart, end: openEnd });
  }
  return paragraphs;
}

export function numberParagraphsForPrompt(body: string, paragraphs: readonly ParagraphSpan[]): string {
  return paragraphs
    .map((paragraph, index) => `[${index + 1}] ${body.slice(paragraph.start, paragraph.end)}`)
    .join('\n\n');
}

function longestOrderedRunEndingAt(paragraphOrder: readonly number[]): number[] {
  const lengths: number[] = paragraphOrder.map(() => 1);

  paragraphOrder.forEach((paragraph, index) => {
    for (let earlier: number = 0; earlier < index; earlier += 1) {
      const isInOrder: boolean = (paragraphOrder[earlier] ?? 0) <= paragraph;
      if (isInOrder) {
        lengths[index] = Math.max(lengths[index] ?? 1, (lengths[earlier] ?? 1) + 1);
      }
    }
  });
  return lengths;
}

function findOrderedBeats(beats: readonly number[], paragraphByBeat: ReadonlyMap<number, number>): Set<number> {
  const paragraphOrder: readonly number[] = beats.map((beat) => paragraphByBeat.get(beat) ?? 0);
  const endingAt: readonly number[] = longestOrderedRunEndingAt(paragraphOrder);
  const startingAt: readonly number[] = longestOrderedRunEndingAt(
    [...paragraphOrder].reverse().map((paragraph) => -paragraph),
  ).reverse();
  const longest: number = Math.max(0, ...endingAt);

  const isOnLongestRun = (index: number): boolean =>
    (endingAt[index] ?? 0) + (startingAt[index] ?? 0) - 1 === longest;
  const runPositionCounts: Map<number, number> = new Map<number, number>();
  beats.forEach((_, index) => {
    if (isOnLongestRun(index)) {
      const position: number = endingAt[index] ?? 0;
      runPositionCounts.set(position, (runPositionCounts.get(position) ?? 0) + 1);
    }
  });

  return new Set(
    beats.filter((_, index) => isOnLongestRun(index) && runPositionCounts.get(endingAt[index] ?? 0) === 1),
  );
}

function spanFromParagraph(
  paragraphs: readonly ParagraphSpan[],
  firstParagraph: number,
  nextParagraph: number | undefined,
): TextSpan {
  const lastParagraph: number = nextParagraph === undefined ? paragraphs.length : nextParagraph - 1;

  return {
    start: paragraphs[firstParagraph - 1]?.start ?? 0,
    end: paragraphs[lastParagraph - 1]?.end ?? 0,
  };
}

export function placeBeatsByParagraph(
  beatCount: number,
  paragraphs: readonly ParagraphSpan[],
  paragraphByBeat: ReadonlyMap<number, number>,
): readonly BeatLocation[] {
  const answeredBeats: readonly number[] = [...paragraphByBeat.keys()].sort((left, right) => left - right);
  const orderedBeats: Set<number> = findOrderedBeats(answeredBeats, paragraphByBeat);
  const startParagraphs: readonly number[] = [
    ...new Set(answeredBeats.filter((beat) => orderedBeats.has(beat)).map((beat) => paragraphByBeat.get(beat) ?? 0)),
  ];

  return Array.from({ length: beatCount }, (_, index): BeatLocation => {
    const beat: number = index + 1;
    const paragraph: number | undefined = orderedBeats.has(beat) ? paragraphByBeat.get(beat) : undefined;

    if (paragraph === undefined) {
      return { beat, isLocated: false };
    }

    const nextParagraph: number | undefined = startParagraphs.find((start) => start > paragraph);
    return { beat, isLocated: true, ...spanFromParagraph(paragraphs, paragraph, nextParagraph) };
  });
}

export function spanOfBeats(
  beatNumbers: readonly number[] | undefined,
  locations: readonly BeatLocation[],
): TextSpan | undefined {
  if (beatNumbers === undefined || beatNumbers.length === 0) {
    return undefined;
  }

  const spans: TextSpan[] = [];
  for (const beatNumber of beatNumbers) {
    const location: BeatLocation | undefined = locations.find((candidate) => candidate.beat === beatNumber);
    if (location === undefined || !location.isLocated) {
      return undefined;
    }
    spans.push(location);
  }

  return {
    start: Math.min(...spans.map((span) => span.start)),
    end: Math.max(...spans.map((span) => span.end)),
  };
}

export function addBeatSpansToWarnings<W extends { readonly beatNumbers?: readonly number[] }>(
  warnings: readonly W[],
  locations: readonly BeatLocation[] | undefined,
): readonly (W & { readonly start?: number; readonly end?: number })[] {
  if (locations === undefined) {
    return warnings;
  }

  return warnings.map((warning) => {
    const span: TextSpan | undefined = spanOfBeats(warning.beatNumbers, locations);
    return span === undefined ? warning : { ...warning, start: span.start, end: span.end };
  });
}
