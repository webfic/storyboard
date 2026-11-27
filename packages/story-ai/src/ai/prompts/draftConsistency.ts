import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const DraftConsistencyPrompt: PromptModule<
  [body: string, facts: readonly string[], variant?: PromptVariantId]
> = {
  config: promptTuning('draftConsistency'),
  build(body: string, facts: readonly string[], variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('draftConsistency', variant, {
      view: { body, facts: facts.length > 0 ? facts.join('\n') : undefined },
    });
  },
};
