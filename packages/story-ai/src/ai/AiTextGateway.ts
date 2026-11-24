import type { AiProviderRegistry } from '#ai/ai/providerRegistry';
import type {
  AiGenerateResponse,
  AiMessage,
  AiStreamChunk,
  UsageAttribution,
  UsageRecord,
  AiTaskName,
} from '@storyboard/story-model';
import {
  isRetryableErrorCode,
  AiProviderError,
  emptyTruncatedResponseMessage,
  projectUsageAttribution,
} from '@storyboard/story-model';
import { isAttributed } from '#ai/ai/aiResponseCoercion';
import { selectPromptVariant } from '#ai/ai/prompts/promptVariants';
import type { PromptVariantId } from '#ai/ai/prompts/types';
import type {
  AiCallObservation,
  GenerateTextOptions,
  OnUsageRecordCallback,
  StoryboardAiServiceOptions,
} from '#ai/ai/aiServiceTypes';
import type { TaskAiConfigResolved } from '#ai/ports/ConfigBridge';

const retryableCallAttemptLimit: number = 2;

function isEmptyTruncatedResponse(response: AiGenerateResponse): boolean {
  return response.isTruncated === true && response.text.trim().length === 0;
}

function isRetryableCall(error: unknown): boolean {
  return error instanceof AiProviderError && isRetryableErrorCode(error.code);
}

export class AiTextGateway {
  public constructor(
    private readonly registry: AiProviderRegistry,
    private readonly options: StoryboardAiServiceOptions,
  ) {}

  public async generate(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    const response: AiGenerateResponse = await this.sendWithRetry(
      () => this.observeCall(taskName, messages, options, () => this.requestGeneration(taskName, messages, options)),
      retryableCallAttemptLimit,
    );

    this.emitUsageIfNeeded(taskName, response, options.attribution);
    if (isEmptyTruncatedResponse(response)) {
      throw new AiProviderError(
        'output-limit',
        response.providerId,
        emptyTruncatedResponseMessage(response.providerId),
      );
    }
    return response;
  }

  public async *generateStream(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
  ): AsyncIterable<AiStreamChunk> {
    const stream: AsyncIterable<AiStreamChunk> = options.providerId
      ? this.registry.generateStreamWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        })
      : this.registry.generateStream({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        });

    const startedAt: Date = new Date();

    for await (const chunk of stream) {
      if (chunk.type === 'done') {
        this.emitUsageIfNeeded(taskName, chunk.response, options.attribution);
        this.emitCall(taskName, messages, options, startedAt, { response: chunk.response });
      }
      yield chunk;
    }
  }

  public resolvePromptVariant(taskName: AiTaskName, options: GenerateTextOptions): PromptVariantId {
    const resolved: TaskAiConfigResolved = this.registry.getTaskAiConfig(taskName);
    const override: PromptVariantId | undefined = this.registry.getPromptVariantOverride();
    return selectPromptVariant({
      providerId: options.providerId ?? resolved.providerId,
      taskName,
      model: resolved.model,
      maxTokens: options.maxTokens,
      ...(override === undefined ? {} : { override }),
    });
  }

  private requestGeneration(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    return options.providerId
      ? this.registry.generateWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          reasoningEffort: options.reasoningEffort,
        })
      : this.registry.generate({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          reasoningEffort: options.reasoningEffort,
        });
  }

  private async observeCall(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
    send: () => Promise<AiGenerateResponse>,
  ): Promise<AiGenerateResponse> {
    const startedAt: Date = new Date();

    try {
      const response: AiGenerateResponse = await send();
      this.emitCall(taskName, messages, options, startedAt, { response });
      return response;
    } catch (error) {
      this.emitCall(taskName, messages, options, startedAt, { error });
      throw error;
    }
  }

  private emitCall(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
    startedAt: Date,
    outcome: Pick<AiCallObservation, 'response' | 'error'>,
  ): void {
    this.options.onCall?.({
      taskName,
      messages,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      ...outcome,
      ...(options.traceTag === undefined ? {} : { traceTag: options.traceTag }),
    });
  }

  private async sendWithRetry(
    send: () => Promise<AiGenerateResponse>,
    attemptsLeft: number,
  ): Promise<AiGenerateResponse> {
    try {
      return await send();
    } catch (error) {
      const canRetry: boolean = attemptsLeft > 1 && isRetryableCall(error);
      if (!canRetry) {
        throw error;
      }

      return await this.sendWithRetry(send, attemptsLeft - 1);
    }
  }

  private emitUsageIfNeeded(
    taskName: UsageRecord['taskName'],
    response: AiGenerateResponse,
    attribution: UsageAttribution | undefined,
  ): void {
    const onUsage: OnUsageRecordCallback | undefined = this.options.onUsage;

    if (!onUsage) {
      return;
    }

    onUsage({
      taskName,
      providerId: response.providerId,
      model: response.model,
      usage: response.usage,
      ...(response.costUsd === undefined ? {} : { costUsd: response.costUsd }),
      attribution:
        attribution !== undefined && isAttributed(attribution)
          ? attribution
          : projectUsageAttribution,
    });
  }
}
