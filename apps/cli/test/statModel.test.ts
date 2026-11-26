import {
  describeStatLevel,
  engineStatAxisCatalog,
  statAxisCatalogSchema,
  statLevelCount,
  statListSchema,
  statSchema,
  type Stat,
  type StatAxis,
} from '@storyboard/story-model';
import { describe, expect, it } from 'vitest';

const boldness: Stat = { stat: '대담함', value: 4, source: { origin: 'training' } };

const talkativeness: Stat = { stat: '말수', value: 2, source: { origin: 'author' } };

function axisNamed(name: string): StatAxis {
  const axis: StatAxis | undefined = engineStatAxisCatalog.axes.find(
    (candidate) => candidate.name === name,
  );
  if (axis === undefined) {
    throw new Error(`엔진 축 목록에 ${name} 이 없습니다.`);
  }

  return axis;
}

describe('stat schema', () => {
  it('accepts a stat from training and one from the author', () => {
    expect(statSchema.parse(boldness)).toEqual(boldness);
    expect(statSchema.parse(talkativeness)).toEqual(talkativeness);
  });

  it.each([0, 6, 2.5])('refuses the value %s', (value) => {
    expect(statSchema.safeParse({ ...boldness, value }).success).toBe(false);
  });

  it('refuses an origin other than author and training', () => {
    expect(statSchema.safeParse({ ...boldness, source: { origin: 'agent' } }).success).toBe(false);
  });

  it('refuses a field it does not know', () => {
    expect(statSchema.safeParse({ ...boldness, about: 'dokyung' }).success).toBe(false);
  });
});

describe('stat list schema', () => {
  it('accepts different stats side by side', () => {
    expect(statListSchema.safeParse([boldness, talkativeness]).success).toBe(true);
  });

  it('refuses the same stat written twice', () => {
    const repeated: Stat = { ...boldness, value: 1, source: { origin: 'author' } };

    expect(statListSchema.safeParse([boldness, repeated]).success).toBe(false);
  });
});

describe('engine stat axis catalog', () => {
  it('gives every axis a meaning for each level', () => {
    for (const axis of engineStatAxisCatalog.axes) {
      expect(axis.levels, axis.name).toHaveLength(statLevelCount);
    }
  });

  it('holds character axes for personality and for speech', () => {
    expect(axisNamed('대담함')).toMatchObject({ group: 'personality', kinds: ['character'] });
    expect(axisNamed('말수')).toMatchObject({ group: 'speech', kinds: ['character'] });
  });

  it('reads the meaning of a level from the lowest value up', () => {
    const boldnessAxis: StatAxis = axisNamed('대담함');

    expect(describeStatLevel(boldnessAxis, 1)).toBe(boldnessAxis.levels[0]);
    expect(describeStatLevel(boldnessAxis, 5)).toBe(boldnessAxis.levels[4]);
    expect(describeStatLevel(boldnessAxis, 6)).toBeUndefined();
  });
});

describe('stat axis catalog schema', () => {
  it('refuses two axes with one name', () => {
    const boldnessAxis: StatAxis = axisNamed('대담함');

    expect(statAxisCatalogSchema.safeParse({ axes: [boldnessAxis, boldnessAxis] }).success).toBe(
      false,
    );
  });

  it('refuses an axis without five level meanings', () => {
    const shortAxis: StatAxis = { ...axisNamed('대담함'), levels: ['낮다', '높다'] };

    expect(statAxisCatalogSchema.safeParse({ axes: [shortAxis] }).success).toBe(false);
  });

  it('refuses an axis for a card kind that does not exist', () => {
    const strayAxis: unknown = { ...axisNamed('대담함'), kinds: ['weapon'] };

    expect(statAxisCatalogSchema.safeParse({ axes: [strayAxis] }).success).toBe(false);
  });
});
