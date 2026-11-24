import { type AiProviderErrorCode } from '@storyboard/story-model';

type GenerationFailureCode = Extract<AiProviderErrorCode, 'generation-failed' | 'transport-failed'>;

interface ErrorFacts {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly status?: unknown;
  readonly type?: unknown;
  readonly code?: unknown;
  readonly cause?: unknown;
}

const firstServerErrorStatus: number = 500;
const causeDepthLimit: number = 4;
const cancelledRequestErrorNames: readonly string[] = ['APIUserAbortError', 'AbortError'];
const connectionErrorNames: readonly string[] = ['APIConnectionError', 'APIConnectionTimeoutError'];
const serverSideStreamErrorTypes: readonly string[] = ['overloaded_error', 'api_error'];
const droppedConnectionCodes: readonly string[] = [
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
];
const droppedStreamMessages: readonly string[] = ['terminated', 'fetch failed'];

function isErrorFacts(value: unknown): value is ErrorFacts {
  return typeof value === 'object' && value !== null;
}

function isCancelledRequest(facts: ErrorFacts): boolean {
  return typeof facts.name === 'string' && cancelledRequestErrorNames.includes(facts.name);
}

function isServerOrConnectionFailure(facts: ErrorFacts): boolean {
  const isServerError: boolean = typeof facts.status === 'number' && facts.status >= firstServerErrorStatus;
  const isConnectionError: boolean =
    typeof facts.name === 'string' && connectionErrorNames.includes(facts.name);
  const isServerSideStreamError: boolean =
    typeof facts.type === 'string' && serverSideStreamErrorTypes.includes(facts.type);
  const isDroppedConnection: boolean =
    typeof facts.code === 'string' && droppedConnectionCodes.includes(facts.code);
  const isDroppedStream: boolean =
    typeof facts.message === 'string' && droppedStreamMessages.includes(facts.message);

  return isServerError || isConnectionError || isServerSideStreamError || isDroppedConnection || isDroppedStream;
}

export function isTransportFailure(error: unknown): boolean {
  let current: unknown = error;

  for (let depth: number = 0; depth < causeDepthLimit && isErrorFacts(current); depth += 1) {
    if (isCancelledRequest(current)) {
      return false;
    }
    if (isServerOrConnectionFailure(current)) {
      return true;
    }
    current = current.cause;
  }

  return false;
}

export function generationFailureCodeOf(error: unknown): GenerationFailureCode {
  return isTransportFailure(error) ? 'transport-failed' : 'generation-failed';
}
