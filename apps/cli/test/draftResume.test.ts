import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAiProvider } from '@storyboard/story-ai';
import { AiProviderError, parseDraft, type AiGenerateRequest, type AiGenerateResponse } from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';

import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';
import type { DispatchResult } from '@/commands/dispatchContract';

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

interface ResumedSceneData {
  readonly usage: readonly StageUsageRow[];
  readonly reused?: { readonly stages: readonly string[]; readonly expansionSections: number };
}

interface DraftSceneData {
  readonly draft: string;
  readonly warnings: readonly unknown[];
}

interface StoppedSceneData {
  readonly failedStage?: string;
  readonly failedSection?: number;
  readonly isResumable: boolean;
}

const expansionTask: string = 'sceneSectionExpansion';
const skeletonTask: string = 'sceneSkeleton';
const personaTask: string = 'personaGeneration';
const failingExpansionCall: number = 7;

let home: string;
let workspace: string;
let generateSpy: MockInstance<(request: AiGenerateRequest) => Promise<AiGenerateResponse>>;
let calledTasks: string[];

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

async function dispatch(...args: string[]): Promise<DispatchResult> {
  return await new CommandDispatcher(deps()).dispatch(args);
}

async function generateScene(...extraArgs: string[]): Promise<DispatchResult> {
  return await dispatch('draft', 'generate', '001-opening', '--no-revise', '--json', ...extraArgs);
}

interface JsonReport<T> {
  readonly ok: boolean;
  readonly message: string;
  readonly data: T;
}

function readReport<T>(result: DispatchResult): JsonReport<T> {
  return JSON.parse(result.stdout) as JsonReport<T>;
}

const realGenerate: (request: AiGenerateRequest) => Promise<AiGenerateResponse> = MockAiProvider.prototype.generate;
const streamDropMessage: string = '스트림이 끊겼습니다';

interface CallFailure {
  readonly failingExpansionCall?: number;
  readonly error?: Error;
}

function recordCalls(options: CallFailure): void {
  let expansionCalls: number = 0;
  calledTasks = [];

  generateSpy.mockImplementation(async function (this: MockAiProvider, request: AiGenerateRequest) {
    calledTasks.push(request.taskName);
    if (request.taskName === expansionTask) {
      expansionCalls += 1;
      if (expansionCalls === options.failingExpansionCall) {
        throw options.error ?? new Error(streamDropMessage);
      }
    }
    return await realGenerate.call(this, request);
  });
}

async function failInExpansion(...extraArgs: string[]): Promise<JsonReport<StoppedSceneData>> {
  return await stopInExpansion({ failingExpansionCall }, ...extraArgs);
}

async function stopInExpansion(
  failure: CallFailure,
  ...extraArgs: string[]
): Promise<JsonReport<StoppedSceneData>> {
  recordCalls(failure);
  const failed: DispatchResult = await generateScene(...extraArgs);
  expect(failed.exitCode).toBe(1);
  recordCalls({});
  return readReport<StoppedSceneData>(failed);
}

function countCalls(task: string): number {
  return calledTasks.filter((name) => name === task).length;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-resume-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-resume-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ 'ai.provider.default': 'mock', 'generation.section.outputLimit': 1000 }),
  );

  expect((await dispatch('init', '--title', '이어 하기 시험', '--genre', '미스터리')).exitCode).toBe(0);
  await dispatch('card', 'create', 'character', '등대지기의 손녀', '--name', '하나', '--id', 'hana');
  await writeSceneBundleFromYaml(
    workspace,
    [
      'type: scene',
      'id: 001-opening',
      'characters:',
      '  - hana',
      'beats:',
      '  - 하나가 항구에 선다',
      '  - 하나가 등대에 오른다',
      '  - 하나가 불빛을 본다',
      '  - 하나가 편지를 연다',
      '',
    ].join('\n'),
  );
  expect((await dispatch('scene', 'set', '001-opening', '--target-words', '4000')).exitCode).toBe(0);

  generateSpy = vi.spyOn(MockAiProvider.prototype, 'generate');
  recordCalls({});
});

afterEach(() => {
  generateSpy.mockRestore();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('draft generate after a failed run', () => {
  it('says where it stopped and that running it again continues', async () => {
    const stopped: JsonReport<StoppedSceneData> = await failInExpansion();

    expect(stopped.ok).toBe(false);
    expect(stopped.data).toMatchObject({ failedStage: 'expandSection', isResumable: true });
    expect(stopped.data.failedSection).toBeGreaterThan(1);
    expect(stopped.message).toContain(streamDropMessage);
    expect(stopped.message).toContain(`살붙임 ${stopped.data.failedSection}구간에서 멈췄습니다`);
    expect(stopped.message).toContain('--force 없이 다시 실행하면 이어서 합니다');
  });

  it('continues from the failed section without calling the finished stages again', async () => {
    const stopped: JsonReport<StoppedSceneData> = await failInExpansion();

    const resumed: DispatchResult = await generateScene();
    const report: JsonReport<ResumedSceneData> = readReport<ResumedSceneData>(resumed);

    expect(resumed.exitCode).toBe(0);
    expect(countCalls(skeletonTask)).toBe(0);
    expect(countCalls(personaTask)).toBe(0);
    expect(countCalls(expansionTask)).toBeGreaterThan(0);
    expect(report.data.reused?.stages).toContain('draftSkeleton');
    expect(report.data.reused?.stages).not.toContain('expandSection');
    expect(report.data.reused?.expansionSections).toBe((stopped.data.failedSection ?? 0) - 1);
    expect(report.data.usage.some((row) => row.task === skeletonTask)).toBe(false);
    expect(report.message).toContain('멈춘 실행을 이어');
  });

  it('writes the draft and warnings an uninterrupted run writes', async () => {
    await failInExpansion();
    const resumed: JsonReport<DraftSceneData> = readReport(await generateScene());
    const resumedBody: string = parseDraft(readFileSync(resumed.data.draft, 'utf8')).body;

    const uninterrupted: JsonReport<DraftSceneData> = readReport(await generateScene('--force'));

    expect(parseDraft(readFileSync(uninterrupted.data.draft, 'utf8')).body).toBe(resumedBody);
    expect(resumed.data.warnings).toEqual(uninterrupted.data.warnings);
  });

  it('forgets the stopped run once the draft is written', async () => {
    await failInExpansion();
    expect((await generateScene()).exitCode).toBe(0);

    const again: DispatchResult = await generateScene();

    expect(readReport<{ readonly cached: boolean }>(again).data.cached).toBe(true);
  });

  it('continues instead of reusing the old draft when a forced rerun stopped', async () => {
    expect((await generateScene()).exitCode).toBe(0);
    await failInExpansion('--force');

    const resumed: JsonReport<ResumedSceneData & { readonly cached: boolean }> = readReport(await generateScene());

    expect(resumed.data.cached).toBe(false);
    expect(resumed.data.reused?.stages).toContain('draftSkeleton');
  });

  it('keeps the finished stages when the provider usage limit stops the run', async () => {
    const stopped: JsonReport<StoppedSceneData> = await stopInExpansion({
      failingExpansionCall,
      error: new AiProviderError('usage-limit', 'mock', '사용 한도에 걸렸습니다'),
    });

    const resumed: JsonReport<ResumedSceneData> = readReport(await generateScene());

    expect(stopped.data).toMatchObject({ failedStage: 'expandSection', isResumable: true });
    expect(resumed.data.reused?.stages).toContain('draftSkeleton');
    expect(countCalls(skeletonTask)).toBe(0);
  });

  it('starts over on --force', async () => {
    await failInExpansion();

    const forced: JsonReport<ResumedSceneData> = readReport(await generateScene('--force'));

    expect(forced.ok).toBe(true);
    expect(countCalls(skeletonTask)).toBeGreaterThan(0);
    expect(forced.data.reused).toBeUndefined();
  });

  it('starts over when a setting the run depends on changed', async () => {
    await failInExpansion();
    const params: string = join(workspace, 'tuned.json');
    writeFileSync(params, JSON.stringify({ 'generation.skeleton.lengthRatio': 0.5 }));

    const changed: JsonReport<ResumedSceneData> = readReport(await generateScene('--params', params));

    expect(changed.ok).toBe(true);
    expect(countCalls(skeletonTask)).toBeGreaterThan(0);
    expect(changed.data.reused).toBeUndefined();
  });
});
