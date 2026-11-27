import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface SkeletonFactsInput {
  readonly skeleton: string;
  readonly narrativeSource: string;
  readonly castFacts: readonly string[];
}

export const SkeletonFactsPrompt: PromptModule<[input: SkeletonFactsInput, variant?: PromptVariantId]> = {
  config: promptTuning('skeletonFacts'),
  build(input: SkeletonFactsInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('skeletonFacts', variant, {
      view: {
        skeleton: input.skeleton,
        narrativeSource: input.narrativeSource,
        hasCastFacts: input.castFacts.length > 0,
        castFacts: input.castFacts,
      },
    });
  },
};
