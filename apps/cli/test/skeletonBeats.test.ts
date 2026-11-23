import {
  beatsByParagraphFromCalls,
  beatsByParagraphFromStarts,
  sectionOwnBeatNumbers,
  sectionPassageNumbers,
  splitDraftParagraphs,
} from '@storyboard/story-engine';
import { describe, expect, it } from 'vitest';

const skeleton: string = ['하나가 항구에 섰다.', '바람이 불었다.', '---', '하나가 등대에 올랐다.', '불이 켜졌다.'].join('\n\n');
const sections: readonly string[] = [
  ['하나가 항구에 섰다.', '바람이 불었다.', '---'].join('\n\n'),
  ['하나가 등대에 올랐다.', '불이 켜졌다.'].join('\n\n'),
];

describe('the beats an expansion section itself writes', () => {
  it('follows the paragraph each beat starts in, up to where the next beat starts', () => {
    const byParagraph = beatsByParagraphFromStarts(
      3,
      splitDraftParagraphs(skeleton),
      new Map([
        [1, 1],
        [2, 3],
        [3, 4],
      ]),
    );

    expect(sectionOwnBeatNumbers(sections, byParagraph)).toEqual([[1], [2, 3]]);
  });

  it('gives no answer from the starts when a beat was not found, so the skeleton calls decide', () => {
    expect(beatsByParagraphFromStarts(3, splitDraftParagraphs(skeleton), new Map([[1, 1]]))).toBeUndefined();

    const byCall = beatsByParagraphFromCalls(
      [
        { beatNumbers: [1, 2], paragraphCount: 3 },
        { beatNumbers: [3], paragraphCount: 1 },
      ],
      4,
    );
    expect(sectionOwnBeatNumbers(sections, byCall)).toEqual([[1, 2], [1, 2, 3]]);
  });

  it('gives nothing when the paragraphs no longer add up', () => {
    expect(beatsByParagraphFromCalls([{ beatNumbers: [1], paragraphCount: 2 }], 4)).toBeUndefined();
    expect(sectionOwnBeatNumbers(sections, [[1], [1]])).toBeUndefined();
  });

  it('numbers the passages a section touches by the scene breaks before it', () => {
    expect(sectionPassageNumbers(sections)).toEqual([[1], [2]]);
    expect(sectionPassageNumbers([skeleton])).toEqual([[1, 2]]);
  });
});
