import { z } from 'zod';

import { headerTextSchema } from '#model/element/elementId';
import { isElementKind, type ElementKind } from '#model/element/elementKind';
import { highestStatValue, lowestStatValue, type Stat } from '#model/element/stat';

import statAxisData from './statAxis.params.json';

export type StatAxisGroup = 'personality' | 'speech';

export const statAxisGroups: readonly [StatAxisGroup, ...StatAxisGroup[]] = [
  'personality',
  'speech',
];

export const statAxisGroupLabels: Record<StatAxisGroup, string> = {
  personality: '성격',
  speech: '말투',
};

export interface StatAxis {
  readonly name: string;
  readonly group: StatAxisGroup;
  readonly kinds: readonly ElementKind[];
  readonly definition: string;
  readonly levels: readonly string[];
}

export interface StatAxisCatalog {
  readonly axes: readonly StatAxis[];
}

export const statLevelCount: number = highestStatValue - lowestStatValue + 1;

const elementKindSchema: z.ZodType<ElementKind> = z.custom<ElementKind>(
  (value) => typeof value === 'string' && isElementKind(value),
  { message: '알 수 없는 카드 종류입니다.' },
);

export const statAxisSchema: z.ZodType<StatAxis> = z
  .object({
    name: headerTextSchema,
    group: z.enum(statAxisGroups),
    kinds: z.array(elementKindSchema).min(1).readonly(),
    definition: headerTextSchema,
    levels: z
      .array(headerTextSchema)
      .length(statLevelCount, { message: `단계의 뜻은 ${statLevelCount}개여야 합니다.` })
      .readonly(),
  })
  .strict();

function listRepeatedAxisIndexes(axes: readonly StatAxis[]): readonly number[] {
  return axes.flatMap((axis, index): number[] => {
    const firstIndex: number = axes.findIndex((earlier) => earlier.name === axis.name);

    return firstIndex === index ? [] : [index];
  });
}

export const statAxisCatalogSchema: z.ZodType<StatAxisCatalog> = z
  .object({ axes: z.array(statAxisSchema).readonly() })
  .strict()
  .superRefine((catalog, context) => {
    for (const index of listRepeatedAxisIndexes(catalog.axes)) {
      context.addIssue({
        code: 'custom',
        path: ['axes', index, 'name'],
        message: '같은 이름의 축이 두 번 정의돼 있습니다.',
      });
    }
  });

export const engineStatAxisCatalog: StatAxisCatalog = statAxisCatalogSchema.parse(statAxisData);

let statAxisCatalogInForce: StatAxisCatalog = engineStatAxisCatalog;

export function resolveStatAxisCatalog(): StatAxisCatalog {
  return statAxisCatalogInForce;
}

export function extendStatAxisCatalog(addition: StatAxisCatalog): void {
  statAxisCatalogInForce = { axes: [...statAxisCatalogInForce.axes, ...addition.axes] };
}

export function resetStatAxisCatalog(): void {
  statAxisCatalogInForce = engineStatAxisCatalog;
}

export const statAxisAdditionFileSchema: z.ZodType<StatAxisCatalog> =
  statAxisCatalogSchema.superRefine((addition, context) => {
    for (const [index, axis] of addition.axes.entries()) {
      if (findStatAxis(statAxisCatalogInForce, axis.name) !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['axes', index, 'name'],
          message: `이미 있는 축은 다시 정의할 수 없습니다: ${axis.name}`,
        });
      }
    }
  });

export function findStatAxis(catalog: StatAxisCatalog, name: string): StatAxis | undefined {
  return catalog.axes.find((axis) => axis.name === name);
}

export function listStatAxesOf(catalog: StatAxisCatalog, kind: ElementKind): readonly StatAxis[] {
  return catalog.axes.filter((axis) => axis.kinds.includes(kind));
}

export function describeStatLevel(axis: StatAxis, value: number): string | undefined {
  return axis.levels[value - lowestStatValue];
}

export function findStatAxisOf(
  catalog: StatAxisCatalog,
  kind: ElementKind,
  statName: string,
): StatAxis | undefined {
  const axis: StatAxis | undefined = findStatAxis(catalog, statName);

  return axis?.kinds.includes(kind) === true ? axis : undefined;
}

function describeStatPromptLine(axis: StatAxis, value: number): string[] {
  const meaning: string | undefined = describeStatLevel(axis, value);

  return meaning === undefined ? [] : [`${axis.name} ${value}/${highestStatValue}: ${meaning}`];
}

export function describeStatPromptLines(
  catalog: StatAxisCatalog,
  kind: ElementKind,
  stats: readonly Stat[],
): readonly string[] {
  return stats.flatMap((stat): string[] => {
    const axis: StatAxis | undefined = findStatAxisOf(catalog, kind, stat.stat);

    return axis === undefined ? [] : describeStatPromptLine(axis, stat.value);
  });
}
