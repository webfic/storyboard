import { isAuthorStat, type Stat, type StatOrigin, type StoryUri } from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export interface UnsetCardStatRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug: string;
  readonly stat: string;
  readonly origin: StatOrigin;
}

export type UnsetCardStatResult =
  | { readonly ok: true; readonly kind: 'removed'; readonly path: string; readonly stat: Stat }
  | {
      readonly ok: false;
      readonly kind: 'missing' | 'held-by-author';
      readonly message: string;
    };

export class UnsetCardStatUseCase implements IUseCase<UnsetCardStatRequest, UnsetCardStatResult> {
  public constructor(private readonly cards: WorkspaceCards) {}

  public async execute(request: UnsetCardStatRequest): Promise<UnsetCardStatResult> {
    const bundle: ElementBundle | undefined = await this.cards.findBundleBySlug(
      request.workspaceRoot,
      request.slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${request.slug}` };
    }

    const current: readonly Stat[] = await this.cards.readStats(request.workspaceRoot, bundle);
    const existing: Stat | undefined = current.find((stat) => stat.stat === request.stat);
    if (existing === undefined) {
      return {
        ok: false,
        kind: 'missing',
        message: `지울 스탯이 없습니다: ${request.slug} ${request.stat}`,
      };
    }
    if (isAuthorStat(existing) && request.origin === 'training') {
      return {
        ok: false,
        kind: 'held-by-author',
        message: `작가가 정한 값이라 지우지 않았습니다: ${request.slug} ${request.stat} ${existing.value}`,
      };
    }

    await this.cards.writeStats(
      request.workspaceRoot,
      bundle,
      current.filter((stat) => stat !== existing),
    );
    return { ok: true, kind: 'removed', path: bundle.path, stat: existing };
  }
}
