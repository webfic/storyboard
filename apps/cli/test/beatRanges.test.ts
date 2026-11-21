import { locateBeatRanges, type BeatRange } from '@storyboard/story-engine';
import { describe, expect, it } from 'vitest';

describe('locating beats in a finished draft', () => {
  it('gives each scene-break segment to the beats planned for it', () => {
    const body: string = ['하나가 항구에 섰다.', '', '---', '', '하나가 등대에 올랐다.', '불이 켜졌다.'].join('\n');

    const ranges: readonly BeatRange[] | undefined = locateBeatRanges(body, [[1, 2], [3]]);

    expect(ranges).toEqual([
      { beats: [1, 2], start: 0, end: 11 },
      { beats: [3], start: 18, end: body.length },
    ]);
    expect(body.slice(ranges?.[0]?.start, ranges?.[0]?.end)).toBe('하나가 항구에 섰다.');
    expect(body.slice(ranges?.[1]?.start, ranges?.[1]?.end)).toBe('하나가 등대에 올랐다.\n불이 켜졌다.');
  });

  it('gives no range when the draft has another number of segments than the plan', () => {
    expect(locateBeatRanges('하나가 항구에 섰다.', [[1], [2]])).toBeUndefined();
    expect(locateBeatRanges('앞.\n---\n가운데.\n---\n뒤.', [[1], [2]])).toBeUndefined();
  });

  it('gives no range when a segment came out empty', () => {
    expect(locateBeatRanges('앞.\n---\n\n---\n뒤.', [[1], [2], [3]])).toBeUndefined();
  });

  it('leaves out a segment no beat was planned for', () => {
    expect(locateBeatRanges('앞.\n---\n뒤.', [[], [1]])).toEqual([{ beats: [1], start: 7, end: 9 }]);
  });
});
