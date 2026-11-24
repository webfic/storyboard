import { describe, expect, it } from 'vitest';

import { ClaudeProvider, OpenAiProvider, isTransportFailure } from '@storyboard/story-ai';
import type { ClaudeClientLike, OpenAiClientLike } from '@storyboard/story-ai';

function namedError(name: string, message: string, facts: Record<string, unknown> = {}): Error {
  const error: Error = new Error(message);
  error.name = name;
  return Object.assign(error, facts);
}

function droppedStream(): Error {
  return namedError('Error', 'terminated', { cause: new TypeError('terminated') });
}

describe('isTransportFailure', () => {
  it.each([
    ['a stream the connection dropped (#249)', droppedStream()],
    ['a reset socket under the SDK error', namedError('Error', 'other side closed', { cause: namedError('Error', 'read', { code: 'ECONNRESET' }) })],
    ['a connection that never opened', namedError('APIConnectionError', 'Connection error.')],
    ['a server error', namedError('InternalServerError', '500 Internal error', { status: 500 })],
    ['an overloaded response', namedError('InternalServerError', '529 Overloaded', { status: 529 })],
    ['an overloaded event in the middle of a stream', namedError('Error', 'Overloaded', { status: undefined, type: 'overloaded_error' })],
    ['a fetch that failed', new TypeError('fetch failed')],
  ] as const)('reads %s as a transport failure', (_label, error) => {
    expect(isTransportFailure(error)).toBe(true);
  });

  it.each([
    ['a rejected request', namedError('BadRequestError', '400 invalid', { status: 400, type: 'invalid_request_error' })],
    ['a bad API key', namedError('AuthenticationError', '401 invalid x-api-key', { status: 401 })],
    ['a rate limit', namedError('RateLimitError', '429 rate limited', { status: 429 })],
    ['a cancelled request', namedError('APIUserAbortError', 'Request was aborted.', { cause: droppedStream() })],
    ['a plain error', new Error('JSON을 읽지 못했습니다')],
    ['a value that is not an error', 'terminated'],
  ] as const)('does not read %s as a transport failure', (_label, error) => {
    expect(isTransportFailure(error)).toBe(false);
  });
});

describe('API providers on a transport failure (#249)', () => {
  it('Claude marks a dropped stream as transport-failed and a rejected request as generation-failed', async () => {
    const providerFailingWith = (cause: unknown): ClaudeProvider =>
      new ClaudeProvider({
        apiKey: 'sk-ant-test',
        model: 'claude-sonnet-5',
        createClient: (): ClaudeClientLike => ({ messages: { create: async () => Promise.reject(cause) } }),
      });
    const request = { taskName: 'sceneDraft', messages: [{ role: 'user', content: '장면' }] } as const;

    await expect(providerFailingWith(droppedStream()).generate(request)).rejects.toMatchObject({
      code: 'transport-failed',
      message: 'Claude 텍스트 생성에 실패했습니다: terminated',
    });
    await expect(
      providerFailingWith(namedError('BadRequestError', '400 invalid', { status: 400 })).generate(request),
    ).rejects.toMatchObject({ code: 'generation-failed' });
  });

  it('OpenAI marks a server error as transport-failed', async () => {
    const client: OpenAiClientLike = {
      models: { list: async (): Promise<unknown> => Promise.resolve([]) },
      chat: { completions: { create: async () => Promise.reject({ status: 503 }) } },
    };
    const provider: OpenAiProvider = new OpenAiProvider({
      apiKey: 'sk-test',
      model: 'gpt-6-luna',
      createClient: (): OpenAiClientLike => client,
    });

    await expect(
      provider.generate({ taskName: 'noteExtraction', messages: [{ role: 'user', content: '노트' }] }),
    ).rejects.toMatchObject({ code: 'transport-failed' });
  });
});
