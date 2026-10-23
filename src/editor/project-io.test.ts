import { describe, expect, it } from 'vitest';
import { limitItems, startingLevel, type EditorRom } from './project-io';

describe('opening older files', () => {
  it('keeps the first four items of units that carry more', () => {
    const file = { chapters: [{ units: [{ id: 'a', items: ['w', 'x', 'y', 'z', 'v'] }, { id: 'b', items: ['w'] }, { id: 'c' }] }] };
    expect(limitItems(file)).toEqual(['"a" carried 5 items; kept the first 4, as a unit starts with at most 4.']);
    expect(file.chapters[0]!.units.map((u) => u.items)).toEqual([['w', 'x', 'y', 'z'], ['w'], undefined]);
    expect(limitItems(null)).toEqual([]);
  });
});

describe('starting levels', () => {
  it("uses the level a character joins at in vanilla, or 1", () => {
    const characters = Array.from({ length: 5 }, (_, k) => ({ baseLevel: k === 4 ? 3 : 1 }));
    const data = { characters } as unknown as EditorRom;
    expect(startingLevel(data, 'moulder')).toBe(3);
    expect(startingLevel(data, 'eirika')).toBe(1);
    expect(startingLevel(data, undefined)).toBe(1);
  });
});
