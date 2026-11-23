import { formatCharacterProfileLines, type CharacterCard, type SceneBeat } from '@storyboard/story-model';

export interface SectionCastFactsInput {
  readonly characters: readonly CharacterCard[];
  readonly beats: readonly SceneBeat[];
  readonly beatNumbers: readonly number[];
}

function findSectionCast(input: SectionCastFactsInput): CharacterCard[] {
  const castRefs: Set<string> = new Set(
    input.beatNumbers.flatMap((beatNumber) => {
      const beat: SceneBeat | undefined = input.beats[beatNumber - 1];
      return beat === undefined || typeof beat === 'string' ? [] : (beat.cast ?? []);
    }),
  );

  return input.characters.filter((character) => castRefs.has(character.id) || castRefs.has(character.name));
}

export function selectSectionCastFacts(input: SectionCastFactsInput): string[] {
  const sectionCast: readonly CharacterCard[] = findSectionCast(input);
  const characters: readonly CharacterCard[] = sectionCast.length > 0 ? sectionCast : input.characters;

  return characters.flatMap(formatCharacterProfileLines);
}
