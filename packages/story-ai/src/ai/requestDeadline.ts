import { AiProviderError, type AiProviderId } from '@storyboard/story-model';

const millisecondsPerMinute: number = 60 * 1000;

function describeTimeout(providerId: AiProviderId, timeoutMs: number): string {
  const minutes: number = Number((timeoutMs / millisecondsPerMinute).toFixed(1));

  return `${providerId} 호출이 ${minutes}분 안에 끝나지 않아 끊었습니다(시간 초과). 응답이 오지 않았거나 출력이 아주 길었을 수 있습니다. 더 기다리려면 ai.request.timeoutMinutes 를 늘리세요.`;
}

export class RequestDeadline {
  private readonly controller: AbortController = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private hasExpired: boolean = false;

  public constructor(
    private readonly providerId: AiProviderId,
    private readonly timeoutMs: number,
  ) {
    this.timer = setTimeout(this.expire, timeoutMs);
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public explainFailure(error: unknown): unknown {
    return this.hasExpired
      ? new AiProviderError('request-timeout', this.providerId, describeTimeout(this.providerId, this.timeoutMs), error)
      : error;
  }

  public clear(): void {
    clearTimeout(this.timer);
  }

  private readonly expire = (): void => {
    this.hasExpired = true;
    this.controller.abort();
  };
}

export async function runWithinDeadline<T>(
  providerId: AiProviderId,
  timeoutMs: number,
  runRequest: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const deadline: RequestDeadline = new RequestDeadline(providerId, timeoutMs);

  try {
    return await runRequest(deadline.signal);
  } catch (error) {
    throw deadline.explainFailure(error);
  } finally {
    deadline.clear();
  }
}

export interface AiRequestOptions {
  readonly signal?: AbortSignal;
}

export function requestOptionsOf(request: { readonly signal?: AbortSignal }): AiRequestOptions {
  return request.signal === undefined ? {} : { signal: request.signal };
}
