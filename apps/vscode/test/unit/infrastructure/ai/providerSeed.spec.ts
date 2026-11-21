import { describe, expect, it } from 'vitest';

import { ConfigBridge, createAiProviderRegistry, SecretStore } from '@storyboard/story-ai';
import type {
  AiProviderRegistry,
  ClaudeClientLike,
  OpenAiClientLike,
  StoryboardConfigurationLike,
} from '@storyboard/story-ai';

interface SentRequests {
  readonly openai: unknown[];
  readonly claude: unknown[];
}

function createSeededRegistry(seed: number | undefined, sent: SentRequests): AiProviderRegistry {
  const settings: Map<string, unknown> = new Map<string, unknown>(
    seed === undefined ? [] : [['ai.seed', seed]],
  );
  const configuration: StoryboardConfigurationLike = {
    get: <T>(key: string, fallback?: T): T => (settings.has(key) ? settings.get(key) : fallback) as T,
    update: async (): Promise<void> => undefined,
  };
  const secrets: Map<string, string> = new Map<string, string>([
    ['storyboard.apiKey.openai', 'sk-test'],
    ['storyboard.apiKey.claude', 'sk-ant-test'],
  ]);
  const openAiClient: OpenAiClientLike = {
    models: { list: async (): Promise<unknown> => ({}) },
    chat: {
      completions: {
        create: async (request) => {
          sent.openai.push(request);
          return { choices: [{ message: { content: 'ok' } }] };
        },
      },
    },
  };
  const claudeClient: ClaudeClientLike = {
    messages: {
      create: async (request) => {
        sent.claude.push(request);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    },
  };

  return createAiProviderRegistry({
    secretStore: new SecretStore({
      get: async (key: string): Promise<string | undefined> => secrets.get(key),
      store: async (): Promise<void> => undefined,
      delete: async (): Promise<void> => undefined,
    }),
    configBridge: new ConfigBridge({ getConfiguration: () => configuration }),
    createOpenAiClient: () => openAiClient,
    createClaudeClient: () => claudeClient,
  });
}

describe('the generation seed', () => {
  it('reaches a provider that takes one', async () => {
    const sent: SentRequests = { openai: [], claude: [] };

    await createSeededRegistry(7, sent).generateWithProvider('openai', {
      taskName: 'sceneDraft',
      messages: [{ role: 'user', content: '테스트' }],
    });

    expect(sent.openai).toEqual([expect.objectContaining({ seed: 7 })]);
  });

  it('is left out for a provider that takes none', async () => {
    const sent: SentRequests = { openai: [], claude: [] };

    await createSeededRegistry(7, sent).generateWithProvider('claude', {
      taskName: 'sceneDraft',
      messages: [{ role: 'user', content: '테스트' }],
    });

    expect(sent.claude).toHaveLength(1);
    expect(sent.claude[0]).not.toHaveProperty('seed');
  });

  it('is not sent when the setting is left at zero', async () => {
    const sent: SentRequests = { openai: [], claude: [] };

    await createSeededRegistry(undefined, sent).generateWithProvider('openai', {
      taskName: 'sceneDraft',
      messages: [{ role: 'user', content: '테스트' }],
    });

    expect(sent.openai[0]).not.toHaveProperty('seed');
  });
});
