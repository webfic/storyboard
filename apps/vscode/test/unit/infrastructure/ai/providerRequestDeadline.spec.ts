import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigBridge, createAiProviderRegistry, SecretStore } from '@storyboard/story-ai';
import type {
  AiProviderRegistry,
  ClaudeClientLike,
  StoryboardConfigurationLike,
} from '@storyboard/story-ai';
import { AiProviderError, type AiGenerateResponse } from '@storyboard/story-model';

interface ClaudeCall {
  readonly signal?: AbortSignal;
}

const millisecondsPerMinute: number = 60 * 1000;

function answerWhenAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')));
  });
}

function createRegistry(
  settings: ReadonlyMap<string, unknown>,
  claudeClient: ClaudeClientLike,
): AiProviderRegistry {
  const configuration: StoryboardConfigurationLike = {
    get: <T>(key: string, fallback?: T): T => (settings.has(key) ? settings.get(key) : fallback) as T,
    update: async (): Promise<void> => undefined,
  };

  return createAiProviderRegistry({
    secretStore: new SecretStore({
      get: async (key: string): Promise<string | undefined> =>
        key === 'storyboard.apiKey.claude' ? 'sk-ant-test' : undefined,
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined,
    }),
    configBridge: new ConfigBridge({ getConfiguration: () => configuration }),
    createClaudeClient: () => claudeClient,
  });
}

function generateWithClaude(registry: AiProviderRegistry): Promise<AiGenerateResponse> {
  return registry.generateWithProvider('claude', {
    taskName: 'sceneDraft',
    messages: [{ role: 'user', content: '테스트' }],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the request deadline of an API provider', () => {
  it('ends a call that gets no reply as a timeout after the configured minutes', async () => {
    const calls: ClaudeCall[] = [];
    const registry: AiProviderRegistry = createRegistry(new Map([['ai.request.timeoutMinutes', 2]]), {
      messages: {
        create: async (_request, options) => {
          calls.push({ signal: options?.signal });
          return answerWhenAborted(options?.signal);
        },
      },
    });

    const generation: Promise<AiGenerateResponse> = generateWithClaude(registry);
    const outcome: Promise<unknown> = generation.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2 * millisecondsPerMinute - 1);
    expect(calls[0]?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error: unknown = await outcome;

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ code: 'request-timeout', providerId: 'claude' });
    expect((error as Error).message).toContain('2분 안에 끝나지 않아');
    expect((error as Error).message).toContain('ai.request.timeoutMinutes');
  });

  it('waits ten minutes by default', async () => {
    const calls: ClaudeCall[] = [];
    const registry: AiProviderRegistry = createRegistry(new Map(), {
      messages: {
        create: async (_request, options) => {
          calls.push({ signal: options?.signal });
          return answerWhenAborted(options?.signal);
        },
      },
    });

    const outcome: Promise<unknown> = generateWithClaude(registry).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10 * millisecondsPerMinute - 1);
    expect(calls[0]?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: 'request-timeout' });
  });

  it('leaves a call that answers in time as it was and keeps no timer running', async () => {
    const registry: AiProviderRegistry = createRegistry(new Map(), {
      messages: {
        create: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
    });

    const response: AiGenerateResponse = await generateWithClaude(registry);

    expect(response.text).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the provider error of a call that fails before the deadline', async () => {
    const registry: AiProviderRegistry = createRegistry(new Map(), {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    });

    await expect(generateWithClaude(registry)).rejects.toMatchObject({ code: 'generation-failed' });
  });
});
