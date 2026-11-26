import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ListCardStatsUseCase,
  SetCardStatUseCase,
  UnsetCardStatUseCase,
  WorkspaceCards,
  type BundleWarning,
  type ListCardStatsResult,
  type SetCardStatResult,
  type UnsetCardStatResult,
  type WorkspaceCaches,
} from '@storyboard/story-engine';
import { NodeUri, type StatOrigin } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeCardBundleFromYaml } from './fixtures/cardBundles';
import { createWorkspaceCaches } from './fixtures/workspaceCacheFixture';

let workspace: string;
let caches: WorkspaceCaches;
let cards: WorkspaceCards;

function root(): NodeUri {
  return NodeUri.file(workspace);
}

function statsPath(kindDirectory: string, slug: string): string {
  return join(workspace, kindDirectory, `${slug}.card`, 'stats.yaml');
}

function setStat(
  slug: string,
  stat: string,
  value: number,
  origin: StatOrigin,
): Promise<SetCardStatResult> {
  return new SetCardStatUseCase(cards).execute({
    workspaceRoot: root(),
    slug,
    stat,
    value,
    origin,
  });
}

function unsetStat(slug: string, stat: string, origin: StatOrigin): Promise<UnsetCardStatResult> {
  return new UnsetCardStatUseCase(cards).execute({ workspaceRoot: root(), slug, stat, origin });
}

function listStats(slug: string): Promise<ListCardStatsResult> {
  return new ListCardStatsUseCase(cards).execute({ workspaceRoot: root(), slug });
}

beforeEach(() => {
  caches = createWorkspaceCaches();
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-stats-'));
  cards = new WorkspaceCards({ fileSystem: new NodeFileSystem(), caches });

  writeCardBundleFromYaml(workspace, 'type: character\nid: elia\nname: 엘리아\nrole: main\n');
  writeCardBundleFromYaml(workspace, 'type: location\nid: harbor\nname: 항구\n');
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('SetCardStatUseCase', () => {
  it('writes the author value to stats.yaml beside the card', async () => {
    const result: SetCardStatResult = await setStat('elia', '대담함', 2, 'author');

    expect(result).toMatchObject({ ok: true, kind: 'added', path: 'character/elia.card' });
    expect(readFileSync(statsPath('character', 'elia'), 'utf8')).toBe(
      '- {stat: 대담함, value: 2, source: {origin: author}}\n',
    );
  });

  it('lets training change a value training wrote', async () => {
    await setStat('elia', '말수', 3, 'training');

    const result: SetCardStatResult = await setStat('elia', '말수', 4, 'training');

    expect(result).toMatchObject({ ok: true, kind: 'replaced', stat: { value: 4 } });
  });

  it('keeps the author value when training tries to change it', async () => {
    await setStat('elia', '대담함', 2, 'author');
    const before: string = readFileSync(statsPath('character', 'elia'), 'utf8');

    const result: SetCardStatResult = await setStat('elia', '대담함', 5, 'training');

    expect(result).toMatchObject({ ok: false, kind: 'held-by-author' });
    expect(readFileSync(statsPath('character', 'elia'), 'utf8')).toBe(before);
  });

  it('lets the author take over a value training wrote', async () => {
    await setStat('elia', '말수', 3, 'training');

    const result: SetCardStatResult = await setStat('elia', '말수', 3, 'author');

    expect(result).toMatchObject({
      ok: true,
      kind: 'replaced',
      stat: { value: 3, source: { origin: 'author' } },
    });
  });

  it('reports no change when the same value is written again', async () => {
    await setStat('elia', '말수', 3, 'training');

    expect(await setStat('elia', '말수', 3, 'training')).toMatchObject({
      ok: true,
      kind: 'unchanged',
    });
  });

  it('keeps the order of the stats when one is replaced', async () => {
    await setStat('elia', '대담함', 2, 'training');
    await setStat('elia', '말수', 3, 'training');

    await setStat('elia', '대담함', 4, 'training');

    const listed: ListCardStatsResult = await listStats('elia');
    expect(listed.ok && listed.stats.map((item) => item.stat.stat)).toEqual(['대담함', '말수']);
  });

  it('refuses an axis the catalog does not hold and names the ones it does', async () => {
    const result: SetCardStatResult = await setStat('elia', '의협심', 3, 'author');

    expect(result).toMatchObject({ ok: false, kind: 'invalid' });
    expect(result.ok ? '' : result.message).toContain('대담함');
    expect(existsSync(statsPath('character', 'elia'))).toBe(false);
  });

  it('refuses a character axis on a background card', async () => {
    const result: SetCardStatResult = await setStat('harbor', '대담함', 3, 'author');

    expect(result).toMatchObject({ ok: false, kind: 'invalid' });
    expect(result.ok ? '' : result.message).toContain('배경');
  });

  it.each([0, 6, 2.5])('refuses the value %s', async (value) => {
    expect(await setStat('elia', '대담함', value, 'author')).toMatchObject({
      ok: false,
      kind: 'invalid',
    });
  });

  it('says so when the card does not exist', async () => {
    expect(await setStat('nobody', '대담함', 3, 'author')).toMatchObject({
      ok: false,
      kind: 'missing',
    });
  });
});

describe('UnsetCardStatUseCase', () => {
  it('removes a stat and leaves the others', async () => {
    await setStat('elia', '대담함', 2, 'author');
    await setStat('elia', '말수', 3, 'training');

    const result: UnsetCardStatResult = await unsetStat('elia', '말수', 'training');

    expect(result).toMatchObject({ ok: true, kind: 'removed', stat: { stat: '말수' } });
    const listed: ListCardStatsResult = await listStats('elia');
    expect(listed.ok && listed.stats.map((item) => item.stat.stat)).toEqual(['대담함']);
  });

  it('keeps the author value when training tries to remove it', async () => {
    await setStat('elia', '대담함', 2, 'author');

    expect(await unsetStat('elia', '대담함', 'training')).toMatchObject({
      ok: false,
      kind: 'held-by-author',
    });
    expect((await listStats('elia')).ok).toBe(true);
    expect(readFileSync(statsPath('character', 'elia'), 'utf8')).toContain('대담함');
  });

  it('says so when the stat is not on the card', async () => {
    expect(await unsetStat('elia', '말수', 'author')).toMatchObject({ ok: false, kind: 'missing' });
  });
});

describe('ListCardStatsUseCase', () => {
  it('lists nothing for a card without stats.yaml and does not create the file', async () => {
    expect(await listStats('elia')).toMatchObject({ ok: true, cardKind: 'character', stats: [] });
    expect(existsSync(statsPath('character', 'elia'))).toBe(false);
  });

  it('gives each stat the meaning of its level', async () => {
    await setStat('elia', '말수', 2, 'author');

    const listed: ListCardStatsResult = await listStats('elia');

    expect(listed.ok && listed.stats[0]).toMatchObject({
      stat: { stat: '말수', value: 2 },
      axis: { group: 'speech' },
      meaning: '필요한 말만 짧게 한다',
    });
  });

  it('lists a hand-written stat whose axis is unknown without a meaning', async () => {
    writeFileSync(
      statsPath('character', 'elia'),
      '- {stat: 의협심, value: 4, source: {origin: author}}\n',
    );

    const listed: ListCardStatsResult = await listStats('elia');

    expect(listed.ok && listed.stats).toEqual([
      { stat: { stat: '의협심', value: 4, source: { origin: 'author' } } },
    ]);
  });
});

describe('a bundle with stats.yaml', () => {
  it('is not reported as holding a file the bundle does not know', async () => {
    await setStat('elia', '대담함', 2, 'author');

    const warnings: readonly BundleWarning[] = await cards.listWarnings(root());

    expect(warnings.filter((warning) => warning.kind === 'unknown-entry')).toEqual([]);
  });

  it('shows the new value to a roster that was already loaded', async () => {
    await cards.loadRoster(root());

    await setStat('elia', '대담함', 2, 'author');

    const listed: ListCardStatsResult = await listStats('elia');
    expect(listed.ok && listed.stats).toHaveLength(1);
  });
});
