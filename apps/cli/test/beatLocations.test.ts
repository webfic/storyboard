import {
  addBeatSpansToWarnings,
  numberParagraphsForPrompt,
  placeBeatsByParagraph,
  splitDraftParagraphs,
  type ParagraphSpan,
} from '@storyboard/story-engine';
import { coerceBeatParagraphs, type BeatLocation } from '@storyboard/story-model';
import { describe, expect, it } from 'vitest';

const body: string = [
  '하나가 항구에 섰다.',
  '',
  '바람이 불었다.',
  '',
  '---',
  '',
  '하나가 등대에 올랐다.',
  '불이 켜졌다.',
  '',
  '"왔구나." 준이 말했다.',
].join('\n');

function paragraphTexts(text: string, paragraphs: readonly ParagraphSpan[]): readonly string[] {
  return paragraphs.map((paragraph) => text.slice(paragraph.start, paragraph.end));
}

describe('numbering the paragraphs of a finished draft', () => {
  it('takes each run of lines between blank lines as one paragraph and skips the scene break', () => {
    const paragraphs: readonly ParagraphSpan[] = splitDraftParagraphs(body);

    expect(paragraphTexts(body, paragraphs)).toEqual([
      '하나가 항구에 섰다.',
      '바람이 불었다.',
      '하나가 등대에 올랐다.\n불이 켜졌다.',
      '"왔구나." 준이 말했다.',
    ]);
    expect(numberParagraphsForPrompt(body, paragraphs)).toContain('[3] 하나가 등대에 올랐다.\n불이 켜졌다.');
  });
});

describe('placing beats by the paragraph each one starts in', () => {
  const paragraphs: readonly ParagraphSpan[] = splitDraftParagraphs(body);

  it('runs a beat from its paragraph to the paragraph before the next beat starts', () => {
    const locations: readonly BeatLocation[] = placeBeatsByParagraph(
      3,
      paragraphs,
      new Map([
        [1, 1],
        [2, 3],
        [3, 4],
      ]),
    );

    expect(locations.map((location) => location.isLocated && body.slice(location.start, location.end))).toEqual([
      '하나가 항구에 섰다.\n\n바람이 불었다.',
      '하나가 등대에 올랐다.\n불이 켜졌다.',
      '"왔구나." 준이 말했다.',
    ]);
  });

  it('gives beats that start in one paragraph the same range', () => {
    const locations: readonly BeatLocation[] = placeBeatsByParagraph(
      2,
      paragraphs,
      new Map([
        [1, 3],
        [2, 3],
      ]),
    );

    expect(locations[0]).toEqual(locations[1] && { ...locations[1], beat: 1 });
  });

  it('leaves a beat the answer skipped, and both beats of an order it cannot settle, unlocated', () => {
    const locations: readonly BeatLocation[] = placeBeatsByParagraph(
      4,
      paragraphs,
      new Map([
        [1, 1],
        [2, 4],
        [3, 2],
      ]),
    );

    expect(locations.map((location) => [location.beat, location.isLocated])).toEqual([
      [1, true],
      [2, false],
      [3, false],
      [4, false],
    ]);
  });

  it('drops only a lone answer that jumps ahead of the beats after it', () => {
    const locations: readonly BeatLocation[] = placeBeatsByParagraph(
      4,
      paragraphs,
      new Map([
        [1, 1],
        [2, 4],
        [3, 2],
        [4, 3],
      ]),
    );

    expect(locations.map((location) => [location.beat, location.isLocated])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, true],
    ]);
  });
});

describe('reading the start paragraphs a model answered', () => {
  it('keeps one answer per beat inside the numbered paragraphs and drops 0 as absent', () => {
    const answer: string = JSON.stringify([
      { index: 1, paragraph: 2 },
      { index: 1, paragraph: 3 },
      { index: 2, paragraph: 0 },
      { index: 3, paragraph: 9 },
      { index: 4, paragraph: 4 },
      { index: 9, paragraph: 1 },
      { index: 5 },
    ]);

    expect([...coerceBeatParagraphs(answer, 5, 4)]).toEqual([
      [1, 2],
      [4, 4],
    ]);
  });
});

describe('giving warnings the range of their beats', () => {
  const locations: readonly BeatLocation[] = [
    { beat: 1, isLocated: true, start: 0, end: 10 },
    { beat: 2, isLocated: true, start: 12, end: 30 },
    { beat: 3, isLocated: false },
  ];

  it('spans every beat a warning names, and adds nothing when one of them is unlocated', () => {
    const warnings = addBeatSpansToWarnings(
      [{ message: 'a', beatNumbers: [1, 2] }, { message: 'b', beatNumbers: [2, 3] }, { message: 'c' }],
      locations,
    );

    expect(warnings).toEqual([
      { message: 'a', beatNumbers: [1, 2], start: 0, end: 30 },
      { message: 'b', beatNumbers: [2, 3] },
      { message: 'c' },
    ]);
  });
});
