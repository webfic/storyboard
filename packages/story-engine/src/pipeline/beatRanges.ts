export interface BeatRange {
  readonly beats: readonly number[];
  readonly start: number;
  readonly end: number;
}

interface TextSpan {
  readonly start: number;
  readonly end: number;
}

const sceneBreakLine: string = '---';

function trimmedSpanOf(body: string, span: TextSpan): TextSpan {
  const text: string = body.slice(span.start, span.end);
  const leadingBlankLength: number = text.length - text.trimStart().length;

  return {
    start: span.start + leadingBlankLength,
    end: span.start + text.trimEnd().length,
  };
}

function segmentSpansOf(body: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let segmentStart: number = 0;
  let lineStart: number = 0;

  for (const line of body.split('\n')) {
    const isSceneBreak: boolean = line.trim() === sceneBreakLine;
    if (isSceneBreak) {
      spans.push(trimmedSpanOf(body, { start: segmentStart, end: lineStart }));
      segmentStart = lineStart + line.length;
    }
    lineStart += line.length + 1;
  }

  spans.push(trimmedSpanOf(body, { start: segmentStart, end: body.length }));
  return spans;
}

export function locateBeatRanges(
  body: string,
  beatSegments: readonly (readonly number[])[],
): readonly BeatRange[] | undefined {
  const spans: readonly TextSpan[] = segmentSpansOf(body);
  const isAlignedWithPlan: boolean =
    spans.length === beatSegments.length && spans.every((span) => span.end > span.start);

  if (!isAlignedWithPlan) {
    return undefined;
  }

  return spans.flatMap((span, index) => {
    const beats: readonly number[] = beatSegments[index] ?? [];
    return beats.length === 0 ? [] : [{ beats, start: span.start, end: span.end }];
  });
}
