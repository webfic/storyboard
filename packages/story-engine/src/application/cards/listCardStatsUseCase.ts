import {
  describeStatLevel,
  findStatAxis,
  resolveStatAxisCatalog,
  type ElementKind,
  type Stat,
  type StatAxis,
  type StatAxisCatalog,
  type StoryUri,
} from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export interface ListCardStatsRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug: string;
}

export interface ListedCardStat {
  readonly stat: Stat;
  readonly axis?: StatAxis;
  readonly meaning?: string;
}

export type ListCardStatsResult =
  | {
      readonly ok: true;
      readonly kind: 'listed';
      readonly path: string;
      readonly cardKind: ElementKind;
      readonly stats: readonly ListedCardStat[];
    }
  | { readonly ok: false; readonly kind: 'missing'; readonly message: string };

export function describeCardStat(stat: Stat, kind: ElementKind): ListedCardStat {
  const catalog: StatAxisCatalog = resolveStatAxisCatalog();
  const axis: StatAxis | undefined = findStatAxis(catalog, stat.stat);
  if (axis?.kinds.includes(kind) !== true) {
    return { stat };
  }

  const meaning: string | undefined = describeStatLevel(axis, stat.value);

  return { stat, axis, ...(meaning === undefined ? {} : { meaning }) };
}

export class ListCardStatsUseCase implements IUseCase<ListCardStatsRequest, ListCardStatsResult> {
  public constructor(private readonly cards: WorkspaceCards) {}

  public async execute(request: ListCardStatsRequest): Promise<ListCardStatsResult> {
    const bundle: ElementBundle | undefined = await this.cards.findBundleBySlug(
      request.workspaceRoot,
      request.slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${request.slug}` };
    }

    const stats: readonly Stat[] = await this.cards.readStats(request.workspaceRoot, bundle);

    return {
      ok: true,
      kind: 'listed',
      path: bundle.path,
      cardKind: bundle.header.kind,
      stats: stats.map((stat) => describeCardStat(stat, bundle.header.kind)),
    };
  }
}
