import { z } from 'zod';

import { elementIdSchema, headerTextSchema } from '#model/element/elementId';

export type StatOrigin = 'author' | 'training';

export const statOrigins: readonly [StatOrigin, ...StatOrigin[]] = ['author', 'training'];

export interface StatSource {
  readonly origin: StatOrigin;
}

export interface Stat {
  readonly stat: string;
  readonly value: number;
  readonly about?: string;
  readonly source: StatSource;
}

export const lowestStatValue: number = 1;

export const highestStatValue: number = 5;

export const statSourceSchema: z.ZodType<StatSource> = z
  .object({ origin: z.enum(statOrigins) })
  .strict();

export const statSchema: z.ZodType<Stat> = z
  .object({
    stat: headerTextSchema,
    value: z.number().int().min(lowestStatValue).max(highestStatValue),
    about: elementIdSchema.optional(),
    source: statSourceSchema,
  })
  .strict();

export function isSameStatSlot(first: Stat, second: Stat): boolean {
  return first.stat === second.stat && first.about === second.about;
}

function listRepeatedStatIndexes(stats: readonly Stat[]): readonly number[] {
  return stats.flatMap((stat, index): number[] => {
    const firstIndex: number = stats.findIndex((earlier) => isSameStatSlot(earlier, stat));

    return firstIndex === index ? [] : [index];
  });
}

export const statListSchema: z.ZodType<readonly Stat[]> = z
  .array(statSchema)
  .readonly()
  .superRefine((stats, context) => {
    for (const index of listRepeatedStatIndexes(stats)) {
      context.addIssue({
        code: 'custom',
        path: [index],
        message: '같은 스탯이 같은 상대에 두 번 적혀 있습니다.',
      });
    }
  });
