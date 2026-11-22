import { z } from 'zod';

import { parseJsonArray } from '#model/contracts/aiResponseParser';

export type BeatLocation =
  | { readonly beat: number; readonly isLocated: true; readonly start: number; readonly end: number }
  | { readonly beat: number; readonly isLocated: false };

interface BeatParagraphAnswer {
  readonly index: number;
  readonly paragraph: number;
}

const beatParagraphAnswerSchema: z.ZodType<BeatParagraphAnswer> = z.object({
  index: z.number().int().min(1),
  paragraph: z.number().int().min(0),
});

export function coerceBeatParagraphs(
  rawText: string,
  beatCount: number,
  paragraphCount: number,
): ReadonlyMap<number, number> {
  const parsedArray: unknown[] | null = parseJsonArray(rawText);
  const paragraphByBeat: Map<number, number> = new Map<number, number>();

  for (const item of parsedArray ?? []) {
    const parsed: z.ZodSafeParseResult<BeatParagraphAnswer> = beatParagraphAnswerSchema.safeParse(item);
    const isUsable: boolean =
      parsed.success &&
      parsed.data.index <= beatCount &&
      parsed.data.paragraph >= 1 &&
      parsed.data.paragraph <= paragraphCount &&
      !paragraphByBeat.has(parsed.data.index);

    if (parsed.success && isUsable) {
      paragraphByBeat.set(parsed.data.index, parsed.data.paragraph);
    }
  }

  return paragraphByBeat;
}
