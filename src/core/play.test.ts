import { describe, expect, it } from 'vitest';
import { applyBattle, areFoes, endTurn, finishAction, moveUnit, startPlay, unitAt } from './play';
import type { Stats } from './combat';
import type { ProjectChapter } from './project';

const STATS: Stats = { hp: 18, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 2, con: 6 };
const statsOf = () => STATS;

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
    const s = startPlay(chapter, statsOf);
    expect(unitAt(s, 1, 1)).toMatchObject({ id: 'eirika', hp: 18, level: 1, items: ['rapier'], moved: false });
    const moved = moveUnit(s, 'eirika', [2, 1]);
    expect(unitAt(moved, 2, 1)).toMatchObject({ id: 'eirika', moved: false });
    expect(unitAt(finishAction(moved, 'eirika'), 2, 1)?.moved).toBe(true);
    expect(chapter.units[0]!.at).toEqual([1, 1]);
  });

  it('applies a fight and removes the fallen', () => {
    const s = applyBattle(startPlay(chapter, statsOf), 'eirika', 'brigand-1', 12, 0);
    expect(s.units).toHaveLength(1);
    expect(s.units[0]).toMatchObject({ id: 'eirika', hp: 12, moved: true });
  });

  it('readies every unit at the end of the turn', () => {
    const s = endTurn(finishAction(startPlay(chapter, statsOf), 'eirika'));
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
