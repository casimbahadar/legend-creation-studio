import { describe, expect, it } from 'vitest';
import { goalProblem, goalRule, seizeLord } from './goals';
import { mapRef, type ProjectChapter } from './project';

const base: ProjectChapter = {
  id: 'c',
  name: 'C',
  map: mapRef(0),
  goal: 'rout',
  units: [
    { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [1, 1], character: 'eirika' },
    { id: 'boss', class: 'fighter', team: 'enemy', level: 5, at: [5, 5], character: 'oneill' },
    { id: 'soldier', class: 'soldier', team: 'enemy', level: 1, at: [6, 5] },
  ],
};

describe('chapter goals', () => {
  it('needs nothing more for Rout', () => {
    expect(goalProblem(base)).toBeNull();
    expect(goalRule(base)).toEqual({ kind: 'rout' });
  });

  it('lets Eirika seize, or Ephraim in his chapters', () => {
    expect(seizeLord(base)).toBe('eirika');
    expect(seizeLord({ ...base, replaces: mapRef(5) })).toBe('ephraim');
    expect(seizeLord({ ...base, replaces: mapRef(24) })).toBe('ephraim');
    expect(seizeLord({ ...base, replaces: mapRef(12) })).toBe('eirika');
  });

  it('needs a square and the lord for Seize', () => {
    expect(goalProblem({ ...base, goal: 'seize' })).toBe('Choose the square to seize.');
    expect(goalRule({ ...base, goal: 'seize', seizeAt: [3, 3] })).toEqual({ kind: 'seize', at: [3, 3], lord: 'eirika' });
    expect(goalProblem({ ...base, goal: 'seize', seizeAt: [3, 3] })).toBeNull();
    expect(goalProblem({ ...base, goal: 'seize', seizeAt: [3, 3], replaces: mapRef(5) })).toMatch(/Only Ephraim can seize/);
  });

  it('needs an enemy playing an FE8 boss for Defeat boss', () => {
    expect(goalProblem({ ...base, goal: 'boss' })).toMatch(/Choose the boss/);
    expect(goalProblem({ ...base, goal: 'boss', boss: 'soldier' })).toMatch(/Choose the boss/);
    expect(goalRule({ ...base, goal: 'boss', boss: 'boss' })).toEqual({ kind: 'boss', unit: 'boss' });
  });

  it('uses 10 turns for Survive unless told otherwise', () => {
    expect(goalRule({ ...base, goal: 'survive' })).toEqual({ kind: 'survive', turns: 10 });
    expect(goalProblem({ ...base, goal: 'survive', surviveTurns: 0 })).toMatch(/from 1 to 99/);
  });
});
