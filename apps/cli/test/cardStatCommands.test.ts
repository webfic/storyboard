import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveVerb, type ParsedArguments } from '@/cliArguments';
import type { CommandOutcome } from '@/commands/outcome';
import { commandCatalog, findCommand } from '@/commands/index';
import type { ICommandHandler } from '@/commands/commandHandler';
import { createCliContainer, type CliContainer } from '@/container';
import { writeCardBundleFromYaml } from './fixtures/cardBundles';

let home: string;
let workspace: string;
let previousHome: string | undefined;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function container(): CliContainer {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '0.0.0',
  });
}

function parse(words: readonly string[], flags: Record<string, string | boolean> = {}): ParsedArguments {
  return resolveVerb(
    { words: [...words], flags },
    commandCatalog.map((spec) => spec.verb),
  );
}

async function run(
  words: readonly string[],
  flags: Record<string, string | boolean> = {},
): Promise<CommandOutcome> {
  const parsed: ParsedArguments = parse(words, flags);
  const command: ICommandHandler | undefined = findCommand(parsed.path.join(' '));
  if (command === undefined) {
    throw new Error(`unknown verb: ${parsed.path.join(' ')}`);
  }

  return await command.execute({ container: container(), args: parsed });
}

function statsFile(): string {
  return readFileSync(join(workspace, 'character', 'elia.card', 'stats.yaml'), 'utf8');
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-stat-cmd-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-stat-cmd-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  await run(['init'], { title: '달의 문' });
  writeCardBundleFromYaml(workspace, 'type: character\nid: elia\nname: 엘리아\nrole: main\n');
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.STORYBOARD_HOME;
  } else {
    process.env.STORYBOARD_HOME = previousHome;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('card stat verbs', () => {
  it('are found as three-word verbs with the rest left as positionals', () => {
    expect(parse(['card', 'stat', 'set', 'elia', '대담함', '2'])).toMatchObject({
      path: ['card', 'stat', 'set'],
      positionals: ['elia', '대담함', '2'],
    });
  });
});

describe('card stat set', () => {
  it('writes the author value when no origin is given, even with nobody at the terminal', async () => {
    const outcome: CommandOutcome = await run(['card', 'stat', 'set', 'elia', '대담함', '2']);

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('대담함 2 적었습니다 (출처 작가)');
    expect(statsFile()).toBe('- {stat: 대담함, value: 2, source: {origin: author}}\n');
  });

  it('writes a training value with --origin training', async () => {
    await run(['card', 'stat', 'set', 'elia', '말수', '4'], { origin: 'training' });

    expect(statsFile()).toBe('- {stat: 말수, value: 4, source: {origin: training}}\n');
  });

  it('fails and keeps the file when training targets the author value', async () => {
    await run(['card', 'stat', 'set', 'elia', '대담함', '2']);

    const outcome: CommandOutcome = await run(['card', 'stat', 'set', 'elia', '대담함', '5'], {
      origin: 'training',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('작가가 정한 값');
    expect(statsFile()).toContain('value: 2');
  });

  it('refuses an origin it does not know', async () => {
    const outcome: CommandOutcome = await run(['card', 'stat', 'set', 'elia', '대담함', '2'], {
      origin: 'agent',
    });

    expect(outcome).toMatchObject({ ok: false, message: '--origin 은 author 또는 training 이어야 합니다.' });
  });

  it('refuses a value that is not a number from 1 to 5', async () => {
    const outcome: CommandOutcome = await run(['card', 'stat', 'set', 'elia', '대담함', '높음']);

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('1에서 5 사이의 정수');
  });

  it('asks for the missing words', async () => {
    expect(await run(['card', 'stat', 'set', 'elia', '대담함'])).toMatchObject({ ok: false });
  });
});

describe('card stat unset', () => {
  it('removes the stat', async () => {
    await run(['card', 'stat', 'set', 'elia', '대담함', '2']);

    const outcome: CommandOutcome = await run(['card', 'stat', 'unset', 'elia', '대담함']);

    expect(outcome.ok).toBe(true);
    expect(statsFile()).toBe('[]\n');
  });
});

describe('card stat list', () => {
  it('shows each stat with who wrote it and what the level means', async () => {
    await run(['card', 'stat', 'set', 'elia', '말수', '2']);

    const outcome: CommandOutcome = await run(['card', 'stat', 'list', 'elia']);

    expect(outcome.message).toBe(
      ['character/elia.card/stats.yaml', '말수 2/5 (작가) 필요한 말만 짧게 한다'].join('\n'),
    );
    expect(outcome.data).toMatchObject({
      stats: [{ stat: { stat: '말수', value: 2, source: { origin: 'author' } }, meaning: '필요한 말만 짧게 한다' }],
    });
  });

  it('says a card has no stats', async () => {
    expect((await run(['card', 'stat', 'list', 'elia'])).message).toContain('(스탯 없음)');
  });
});

describe('card stat axes', () => {
  it('lists character axes by group with the meaning of every level', async () => {
    const outcome: CommandOutcome = await run(['card', 'stat', 'axes']);

    expect(outcome.message).toContain('[성격]');
    expect(outcome.message).toContain('[말투]');
    expect(outcome.message).toContain('    1 맞서야 할 때 물러서고 남이 나서기를 기다린다');
    expect(outcome.data).toMatchObject({ kind: 'character' });
  });

  it('says so when a kind has no axis yet', async () => {
    expect((await run(['card', 'stat', 'axes', 'narrator'])).message).toBe(
      '서술자 카드에 쓸 수 있는 축이 아직 없습니다.',
    );
  });

  it('refuses a kind that does not exist', async () => {
    expect(await run(['card', 'stat', 'axes', 'weapon'])).toMatchObject({ ok: false });
  });
});

describe('card show', () => {
  it('lists the stats under the statements', async () => {
    await run(['card', 'stat', 'set', 'elia', '말수', '2']);

    const outcome: CommandOutcome = await run(['card', 'show', 'elia']);

    expect(outcome.message).toContain('스탯\n  말수 2/5 (작가) 필요한 말만 짧게 한다');
    expect(outcome.data).toMatchObject({ stats: [{ stat: { stat: '말수' } }] });
  });

  it('shows no stat section for a card without stats', async () => {
    const outcome: CommandOutcome = await run(['card', 'show', 'elia']);

    expect(outcome.message).not.toContain('스탯');
    expect(outcome.data).not.toHaveProperty('stats');
  });
});
