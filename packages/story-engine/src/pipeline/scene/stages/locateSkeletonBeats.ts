import { numberParagraphsForPrompt, splitDraftParagraphs, type ParagraphSpan } from '#engine/pipeline/beatLocations';
import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { buildGenerateOptions, withAttribution } from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import { AiProviderError, sceneBeatText, type SceneBeat } from '@storyboard/story-model';

export class LocateSkeletonBeatsStage implements ISceneStage {
  public readonly id: SceneStageId = 'locateSkeletonBeats';

  public async run(run: SceneGenerationRun): Promise<void> {
    const beats: readonly SceneBeat[] = run.context.scene.card?.beats ?? [];
    const paragraphs: readonly ParagraphSpan[] = splitDraftParagraphs(run.polishedText);
    if (beats.length === 0 || paragraphs.length === 0) {
      return;
    }

    try {
      run.skeletonBeatStarts = await run.aiService.locateBeatParagraphs(
        beats.map(sceneBeatText),
        numberParagraphsForPrompt(run.polishedText, paragraphs),
        paragraphs.length,
        withAttribution(buildGenerateOptions(run.providers, 'beatLocation'), { primary: run.sceneRef }),
      );
    } catch (error) {
      if (!(error instanceof AiProviderError)) {
        throw error;
      }
      run.report({ kind: 'warning', message: `뼈대 비트 위치를 찾지 못해 뼈대 호출 단위로 셉니다 (${error.message})` });
    }
  }
}
