import {
  elementKindLabels,
  findStatAxis,
  highestStatValue,
  isAuthorStat,
  listStatAxesOf,
  lowestStatValue,
  resolveStatAxisCatalog,
  type ElementKind,
  type Stat,
  type StatAxis,
  type StatAxisCatalog,
  type StatOrigin,
  type StoryUri,
} from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export interface SetCardStatRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug: string;
  readonly stat: string;
  readonly value: number;
  readonly origin: StatOrigin;
}

export type SetCardStatResult =
  | {
      readonly ok: true;
      readonly kind: 'added' | 'replaced' | 'unchanged';
      readonly path: string;
      readonly stat: Stat;
    }
  | {
      readonly ok: false;
      readonly kind: 'missing' | 'invalid' | 'held-by-author';
      readonly message: string;
    };

export function describeStatAxisRefusal(kind: ElementKind, statName: string): string | undefined {
  const catalog: StatAxisCatalog = resolveStatAxisCatalog();
  const axis: StatAxis | undefined = findStatAxis(catalog, statName);
  if (axis?.kinds.includes(kind) === true) {
    return undefined;
  }

  const usableNames: readonly string[] = listStatAxesOf(catalog, kind).map((usable) => usable.name);
  const usable: string =
    usableNames.length > 0
      ? `쓸 수 있는 축: ${usableNames.join(', ')}`
      : '이 종류에 쓸 수 있는 축이 아직 없습니다';

  return `${elementKindLabels[kind]} 카드에 쓸 수 없는 축입니다: ${statName} (${usable})`;
}

export class SetCardStatUseCase implements IUseCase<SetCardStatRequest, SetCardStatResult> {
  public constructor(private readonly cards: WorkspaceCards) {}

  public async execute(request: SetCardStatRequest): Promise<SetCardStatResult> {
    const bundle: ElementBundle | undefined = await this.cards.findBundleBySlug(
      request.workspaceRoot,
      request.slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${request.slug}` };
    }

    const refusal: string | undefined = this.describeRefusal(request, bundle.header.kind);
    if (refusal !== undefined) {
      return { ok: false, kind: 'invalid', message: refusal };
    }

    const current: readonly Stat[] = await this.cards.readStats(request.workspaceRoot, bundle);
    const existing: Stat | undefined = current.find((stat) => stat.stat === request.stat);
    if (existing !== undefined && isAuthorStat(existing) && request.origin === 'training') {
      return {
        ok: false,
        kind: 'held-by-author',
        message: `작가가 정한 값이라 바꾸지 않았습니다: ${request.slug} ${request.stat} ${existing.value}`,
      };
    }

    const next: Stat = {
      stat: request.stat,
      value: request.value,
      source: { origin: request.origin },
    };
    if (existing?.value === next.value && existing.source.origin === next.source.origin) {
      return { ok: true, kind: 'unchanged', path: bundle.path, stat: existing };
    }

    await this.cards.writeStats(
      request.workspaceRoot,
      bundle,
      this.placeStat(current, existing, next),
    );
    return {
      ok: true,
      kind: existing === undefined ? 'added' : 'replaced',
      path: bundle.path,
      stat: next,
    };
  }

  private describeRefusal(request: SetCardStatRequest, kind: ElementKind): string | undefined {
    const isLevel: boolean =
      Number.isInteger(request.value) &&
      request.value >= lowestStatValue &&
      request.value <= highestStatValue;
    if (!isLevel) {
      return `스탯 값은 ${lowestStatValue}에서 ${highestStatValue} 사이의 정수여야 합니다: ${request.value}`;
    }

    return describeStatAxisRefusal(kind, request.stat);
  }

  private placeStat(
    current: readonly Stat[],
    existing: Stat | undefined,
    next: Stat,
  ): readonly Stat[] {
    return existing === undefined
      ? [...current, next]
      : current.map((stat) => (stat === existing ? next : stat));
  }
}
