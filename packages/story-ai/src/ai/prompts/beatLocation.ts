import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const BeatLocationPrompt: PromptModule<
  [beats: readonly string[], numberedParagraphs: string, variant?: PromptVariantId]
> = {
  config: promptTuning('beatLocation'),
  build(
    beats: readonly string[],
    numberedParagraphs: string,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('beatLocation', variant, {
      view: { numberedBeats: numberedBeats(beats), numberedParagraphs },
    });
  },
};

function numberedBeats(beats: readonly string[]): string {
  return beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n');
}
