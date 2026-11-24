import { type AiProviderId } from '#model/contracts/aiTypes';

export type AiProviderErrorCode =
  | 'missing-provider'
  | 'missing-api-key'
  | 'missing-model'
  | 'connection-failed'
  | 'generation-failed'
  | 'transport-failed'
  | 'output-limit'
  | 'provider-not-enabled'
  | 'risk-not-acknowledged'
  | 'cli-not-found'
  | 'cli-not-logged-in'
  | 'cli-usage-limit'
  | 'cli-timeout'
  | 'request-timeout'
  | 'login-required'
  | 'usage-limit';

export class AiProviderError extends Error {
  public constructor(
    public readonly code: AiProviderErrorCode,
    public readonly providerId: AiProviderId,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function isTimeoutErrorCode(code: AiProviderErrorCode): boolean {
  return code === 'cli-timeout' || code === 'request-timeout';
}

export function isRetryableErrorCode(code: AiProviderErrorCode): boolean {
  return isTimeoutErrorCode(code) || code === 'transport-failed';
}
