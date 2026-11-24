import { describe, expect, it, vi } from 'vitest';

import { AiTextGateway, type AiCallObservation, type AiProviderRegistry } from '@storyboard/story-ai';
import { AiProviderError, type AiGenerateResponse, type UsageRecord } from '@storyboard/story-model';

const response: AiGenerateResponse = {
  text: '본문',
  providerId: 'claude-code',
  model: 'claude-opus-5-5',
  usage: { inputTokens: 1, outputTokens: 1 },
} as AiGenerateResponse;

function timeout(): AiProviderError {
  return new AiProviderError('cli-timeout', 'claude-code', '시간 안에 끝나지 않아 중단했습니다.');
}

function droppedStream(): AiProviderError {
  return new AiProviderError('transport-failed', 'claude', 'Claude 텍스트 생성에 실패했습니다: terminated');
}

function createGateway(
  generate: () => Promise<AiGenerateResponse>,
  usage: UsageRecord[] = [],
  calls: AiCallObservation[] = [],
): AiTextGateway {
  const registry: AiProviderRegistry = {
    generate: vi.fn(generate),
    generateWithProvider: vi.fn(generate),
  } as unknown as AiProviderRegistry;

  return new AiTextGateway(registry, {
    onUsage: (record: UsageRecord): void => void usage.push(record),
    onCall: (call: AiCallObservation): void => void calls.push(call),
  });
}

describe('AiTextGateway', () => {
  it('sends a call that timed out once more and keeps the second answer', async () => {
    const generate = vi.fn<() => Promise<AiGenerateResponse>>()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(response);
    const usage: UsageRecord[] = [];

    await expect(
      createGateway(generate, usage).generate('sceneBeats', [], {}),
    ).resolves.toBe(response);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(usage).toHaveLength(1);
  });

  it('gives up after the second time-out with the provider error', async () => {
    const generate = vi.fn<() => Promise<AiGenerateResponse>>().mockRejectedValue(timeout());

    await expect(createGateway(generate).generate('sceneBeats', [], {})).rejects.toMatchObject({
      code: 'cli-timeout',
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('sends a call whose stream dropped once more and records both attempts (#249)', async () => {
    const generate = vi.fn<() => Promise<AiGenerateResponse>>()
      .mockRejectedValueOnce(droppedStream())
      .mockResolvedValueOnce(response);
    const usage: UsageRecord[] = [];
    const calls: AiCallObservation[] = [];

    await expect(
      createGateway(generate, usage, calls).generate('sceneSectionExpansion', [], { maxTokens: 8000 }),
    ).resolves.toBe(response);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(usage).toHaveLength(1);
    expect(calls.map((call) => ({ hasError: call.error !== undefined, hasResponse: call.response !== undefined }))).toEqual([
      { hasError: true, hasResponse: false },
      { hasError: false, hasResponse: true },
    ]);
  });

  it('gives up after the second dropped stream with the provider error', async () => {
    const generate = vi.fn<() => Promise<AiGenerateResponse>>().mockRejectedValue(droppedStream());
    const calls: AiCallObservation[] = [];

    await expect(createGateway(generate, [], calls).generate('sceneBeats', [], {})).rejects.toMatchObject({
      code: 'transport-failed',
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
  });

  it.each(['cli-usage-limit', 'usage-limit', 'generation-failed'] as const)(
    'does not send a call again after %s',
    async (code) => {
      const generate = vi
        .fn<() => Promise<AiGenerateResponse>>()
        .mockRejectedValue(new AiProviderError(code, 'claude-code', '실패'));

      await expect(createGateway(generate).generate('sceneBeats', [], {})).rejects.toMatchObject({
        code,
      });
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );

  it('reports an answer the output limit left empty as an output-limit error and still counts its usage (#193, #213)', async () => {
    const emptyTruncated: AiGenerateResponse = { ...response, text: '  ', isTruncated: true };
    const usage: UsageRecord[] = [];

    await expect(
      createGateway(async () => emptyTruncated, usage).generate('backgroundDescription', [], {}),
    ).rejects.toMatchObject({ code: 'output-limit', providerId: 'claude-code' });
    expect(usage).toHaveLength(1);
  });

  it('keeps a truncated answer that still has text for the caller to judge', async () => {
    const truncated: AiGenerateResponse = { ...response, isTruncated: true };

    await expect(createGateway(async () => truncated).generate('sceneBeats', [], {})).resolves.toBe(truncated);
  });

  it('does not send a cancelled call again', async () => {
    const aborted: Error = new Error('aborted');
    const generate = vi.fn<() => Promise<AiGenerateResponse>>().mockRejectedValue(aborted);

    await expect(createGateway(generate).generate('sceneBeats', [], {})).rejects.toBe(aborted);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
