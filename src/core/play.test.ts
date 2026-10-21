import { describe, expect, it } from 'vitest';
import { areFoes, endTurn, moveUnit, startPlay, unitAt } from './play';
import type { ProjectChapter } from './project';

const chapter: ProjectChapter = {
  id: 'c',
  name: 'C',
  map: 'fe8-us/chapter-entry-0',
  goal: 'rout',
  units: [
    { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [1, 1], items: ['rapier'] },
    { id: 'brigand-1', class: 'brigand', team: 'enemy', level: 1, at: [5, 5] },
  ],
};

describe('play session', () => {
  it('starts from the chapter without changing it', () => {
    const s = startPlay(chapter);
    const moved = moveUnit(s, 'eirika', [2, 1]);
    expect(unitAt(moved, 2, 1)).toMatchObject({ id: 'eirika', moved: true, items: ['rapier'] });
    expect(unitAt(moved, 1, 1)).toBeUndefined();
    expect(chapter.units[0]!.at).toEqual([1, 1]);
    expect(unitAt(s, 1, 1)?.id).toBe('eirika');
  });

  it('readies every unit at the end of the turn', () => {
    const s = endTurn(moveUnit(startPlay(chapter), 'eirika', [2, 1]));
    expect(s.turn).toBe(2);
    expect(s.units.every((u) => !u.moved)).toBe(true);
  });

  it('puts player and ally on the same side', () => {
    expect(areFoes('player', 'ally')).toBe(false);
    expect(areFoes('player', 'enemy')).toBe(true);
    expect(areFoes('ally', 'enemy')).toBe(true);
    expect(areFoes('enemy', 'enemy')).toBe(false);
  });
});
