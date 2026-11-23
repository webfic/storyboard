import { selectSectionCastFacts } from '@storyboard/story-engine';
import { SceneSectionExpansionPrompt, type PromptArtifact } from '@storyboard/story-ai';
import { formatCharacterProfileLines, type CharacterCard, type SceneBeat } from '@storyboard/story-model';
import { describe, expect, it } from 'vitest';

const hana: CharacterCard = {
  type: 'character',
  id: 'hana',
  name: '하나',
  description: ['항구 마을 서점 주인', '말수가 적다'],
  attributes: { 나이: 17, 학교: '중퇴', 별명: null },
};
const jun: CharacterCard = { type: 'character', id: 'jun', name: '준', attributes: { 나이: 18 } };
const mina: CharacterCard = { type: 'character', id: 'mina', name: '미나' };

const beats: readonly SceneBeat[] = [
  { text: '하나가 항구에 선다.', cast: ['hana'] },
  { text: '준이 등대에서 내려온다.', cast: ['준'] },
  '셋이 저녁을 먹는다.',
];

describe('the profile lines of a character card', () => {
  it('gives the description and the set attributes, each under the character name', () => {
    expect(formatCharacterProfileLines(hana)).toEqual([
      '하나 — 설명: 항구 마을 서점 주인 / 말수가 적다',
      '하나 — 속성: 나이=17, 학교=중퇴',
    ]);
  });

  it('gives nothing for a card with neither', () => {
    expect(formatCharacterProfileLines(mina)).toEqual([]);
  });
});

describe('the cast facts of one expansion section', () => {
  const characters: readonly CharacterCard[] = [hana, jun, mina];

  it('takes the characters the section beats cast, by id or by name', () => {
    expect(selectSectionCastFacts({ characters, beats, beatNumbers: [2] })).toEqual(['준 — 속성: 나이=18']);
    expect(selectSectionCastFacts({ characters, beats, beatNumbers: [1, 2] })).toHaveLength(3);
  });

  it('takes every scene character when the section beats cast no one', () => {
    const everyone: readonly string[] = characters.flatMap(formatCharacterProfileLines);

    expect(selectSectionCastFacts({ characters, beats, beatNumbers: [3] })).toEqual(everyone);
    expect(selectSectionCastFacts({ characters, beats, beatNumbers: [] })).toEqual(everyone);
  });
});

describe('the expansion prompt', () => {
  const baseInput = { skeleton: '뼈대', section: '구간', targetLength: 2000 };

  it('lists the cast facts and forbids inventing a personal fact the cards do not give', () => {
    const prompt: PromptArtifact = SceneSectionExpansionPrompt.build({
      ...baseInput,
      castFacts: ['하나 — 속성: 나이=17'],
    });

    expect(prompt.user).toContain('[인물 사실 — 이 구간 인물의 확정 신상]\n- 하나 — 속성: 나이=17');
    expect(prompt.system).toContain('거기 없는 신상을 지어내지 말고');
  });

  it('leaves the block out without cast facts, and the under-length retry asks for known facts only', () => {
    const prompt: PromptArtifact = SceneSectionExpansionPrompt.build({ ...baseInput, isUnderLengthRetry: true });

    expect(prompt.user).not.toContain('[인물 사실');
    expect(prompt.user).toContain('새 신상이나 과거사를 지어내 분량을 채우지 마라');
  });
});
