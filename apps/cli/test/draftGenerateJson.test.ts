import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseDraft, STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';

import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

interface StageUsageRow {
  readonly stage?: string;
  readonly task: string;
  readonly calls: number;
}

interface GeneratedWarning {
  readonly sectionNumber?: number;
  readonly beatNumbers?: readonly number[];
}

interface GeneratedSceneData {
  readonly draft: string;
  readonly warnings: readonly GeneratedWarning[];
  readonly cached: boolean;
  readonly usage: readonly StageUsageRow[];
  readonly traceRunId?: string;
  readonly seedHonoured?: boolean;
  readonly beatRanges?: readonly { readonly beats: readonly number[]; readonly start: number; readonly end: number }[];
}

let home: string;
let workspace: string;

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

async function generateScene(...extraArgs: string[]): Promise<GeneratedSceneData> {
  const result = await new CommandDispatcher(deps()).dispatch([
    'draft',
    'generate',
    '001-opening',
    '--no-revise',
    '--json',
    ...extraArgs,
  ]);
  expect(result.exitCode).toBe(0);
  return (JSON.parse(result.stdout) as { data: GeneratedSceneData }).data;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-generate-json-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-generate-json-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));

  const init = await new CommandDispatcher(deps()).dispatch(['init', '--title', '사용량 시험', '--genre', '미스터리']);
  expect(init.exitCode).toBe(0);
  await new CommandDispatcher(deps()).dispatch(['card', 'create', 'character', '등대지기의 손녀', '--name', '하나', '--id', 'hana']);
  await writeSceneBundleFromYaml(
    workspace,
    ['type: scene', 'id: 001-opening', 'characters:', '  - hana', 'beats:', '  - 하나가 항구에 선다', ''].join('\n'),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('draft generate --json', () => {
  it('reports the model calls of the run by stage and task', async () => {
    const generated: GeneratedSceneData = await generateScene();

    expect(generated.cached).toBe(false);
    expect(generated.usage.length).toBeGreaterThan(0);
    expect(generated.usage.every((row) => row.calls > 0 && row.stage !== undefined)).toBe(true);
    expect(generated.usage).toContainEqual(
      expect.objectContaining({ stage: 'draftSkeleton', task: 'sceneSkeleton' }),
    );
    expect(generated.usage).toContainEqual(
      expect.objectContaining({ stage: 'expandSection', task: 'sceneSectionExpansion' }),
    );
    expect(generated.usage).toContainEqual(
      expect.objectContaining({ stage: 'updateStoryState', task: 'storyStateUpdate' }),
    );
    expect(generated.traceRunId).toBeUndefined();
    expect(generated.seedHonoured).toBeUndefined();
  });

  it('says whether every call took the seed of the run file', async () => {
    const params: string = join(workspace, 'seeded.json');
    writeFileSync(params, JSON.stringify({ 'ai.seed': 11 }));

    const generated: GeneratedSceneData = await generateScene('--params', params);

    expect(generated.seedHonoured).toBe(true);
  });

  it('places the beats of a scene with planned breaks in the finished draft', async () => {
    const dispatcher: CommandDispatcher = new CommandDispatcher(deps());
    await dispatcher.dispatch(['card', 'create', 'background', '바닷가 등대', '--name', '등대', '--id', 'lighthouse']);
    await dispatcher.dispatch(['card', 'create', 'background', '고깃배가 드나드는 항구', '--name', '항구', '--id', 'harbor']);
    await writeSceneBundleFromYaml(
      workspace,
      [
        'type: scene',
        'id: 001-opening',
        'characters:',
        '  - hana',
        'beats:',
        '  - text: 하나가 항구에 선다',
        '    place: harbor',
        '    time: 아침',
        '  - text: 하나가 등대에 오른다',
        '    place: lighthouse',
        '    time: 밤',
        '',
      ].join('\n'),
    );

    const generated: GeneratedSceneData = await generateScene();
    const body: string = parseDraft(readFileSync(generated.draft, 'utf8')).body;
    const [first, second] = generated.beatRanges ?? [];

    expect(generated.beatRanges?.map((range) => range.beats)).toEqual([[1], [2]]);
    expect(first?.start).toBe(0);
    expect(second?.end).toBe(body.trimEnd().length);
    expect(body.slice(first?.end, second?.start).trim()).toBe('---');
    expect(generated.warnings.filter((warning) => warning.sectionNumber !== undefined)).toSatisfy(
      (located: readonly GeneratedWarning[]) =>
        located.length > 0 && located.every((warning) => warning.beatNumbers?.join() === '1,2'),
    );
  });

  it('gives no beat range to a scene without planned breaks', async () => {
    expect((await generateScene()).beatRanges).toBeUndefined();
  });

  it('names the trace run when one run file turns the trace on', async () => {
    const params: string = join(workspace, 'point.json');
    writeFileSync(params, JSON.stringify({ 'trace.enabled': true }));

    const generated: GeneratedSceneData = await generateScene('--params', params);
    const traceRoot: string = join(workspace, ...STORYBOARD_RELATIVE_PATHS.traceDirectory.split('/'));

    expect(generated.traceRunId).toBeDefined();
    expect(existsSync(join(traceRoot, generated.traceRunId ?? '', 'run.json'))).toBe(true);
  });

  it('says a cache hit made no call', async () => {
    await generateScene();

    const again: GeneratedSceneData = await generateScene();

    expect(again).toMatchObject({ cached: true, usage: [] });
    expect(again.traceRunId).toBeUndefined();
  });
});
