import type { AiServices } from '#engine/application/engineServices';
import type { BeatLocationSource } from '#engine/application/drafts/draftGenerationContract';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { TraceRunSession } from '#engine/persistence/generationTraceRecorder';
import {
  numberParagraphsForPrompt,
  placeBeatsByParagraph,
  splitDraftParagraphs,
  type ParagraphSpan,
} from '#engine/pipeline/beatLocations';
import type { StoryboardAiService } from '@storyboard/story-ai';
import {
  draftGenerationTraceKind,
  extractErrorMessage,
  type BeatLocation,
  type DraftGenerationStepId,
} from '@storyboard/story-model';

export class BeatLocator {
  public constructor(
    private readonly ai: AiServices,
    private readonly logger: IStoryboardLogger,
  ) {}

  public async locate(source: BeatLocationSource, body: string): Promise<readonly BeatLocation[] | undefined> {
    const paragraphs: readonly ParagraphSpan[] = splitDraftParagraphs(body);
    if (paragraphs.length === 0) {
      return source.beats.map((_, index): BeatLocation => ({ beat: index + 1, isLocated: false }));
    }

    const session: TraceRunSession = await this.ai.traceRecorder.startRun(source.workspaceRoot, {
      kind: draftGenerationTraceKind,
      subject: { sceneStem: source.sceneStem },
      continuesRunOfKind: draftGenerationTraceKind,
    });
    const locateStep: DraftGenerationStepId = 'locateBeats';
    try {
      const locations: readonly BeatLocation[] = await this.ai.traceRecorder.runStage(
        source.workspaceRoot,
        locateStep,
        () => this.askForStartParagraphs(source, body, paragraphs),
      );
      await session.finish('completed');
      return locations;
    } catch (error) {
      await session.finish('completed');
      this.logger.warn(
        `${source.sceneStem}: 비트 위치를 찾지 못했습니다. 원고는 저장됐습니다. (${extractErrorMessage(error)})`,
      );
      return undefined;
    }
  }

  private async askForStartParagraphs(
    source: BeatLocationSource,
    body: string,
    paragraphs: readonly ParagraphSpan[],
  ): Promise<readonly BeatLocation[]> {
    const aiService: StoryboardAiService = this.ai.gateway.createService(source.workspaceRoot);
    const paragraphByBeat: ReadonlyMap<number, number> = await aiService.locateBeatParagraphs(
      source.beats,
      numberParagraphsForPrompt(body, paragraphs),
      paragraphs.length,
      {
        providerId: this.ai.gateway.getTaskProvider('beatLocation'),
        attribution: { primary: { kind: 'scene', id: source.sceneStem } },
      },
    );

    return placeBeatsByParagraph(source.beats.length, paragraphs, paragraphByBeat);
  }
}
