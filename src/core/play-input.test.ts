import { describe, expect, it } from 'vitest';
import { startPlay, type PlayState, type PlayUnit } from './play';
import { searchMoves } from './movement';
import { canMove, cursorTo, moveCursor, pressA, pressB, selectedUnit, startView, visibleRoute, type PlayRules } from './play-input';

const chapter = {
  id: 'c',
  name: 'C',
  map: 'fe8-us/chapter-entry-0',
  goal: 'rout' as const,
  units: [
    { id: 'brigand-1', class: 'brigand', team: 'enemy' as const, level: 1, at: [4, 0] as [number, number] },
    { id: 'eirika', class: 'lord-eirika', team: 'player' as const, level: 1, at: [1, 1] as [number, number] },
  ],
};

// Open 5x3 field, every step costs 1, and every unit has Mov 1: it reaches its own square and the ones next to it.
const rules: PlayRules = {
  width: 5,
  height: 3,
  searchOf: (u: PlayUnit, _s: PlayState) => searchMoves({ width: 5, height: 3, terrain: new Array(15).fill(0) }, () => 1, 1, u.at, () => null),
};

describe('play controls', () => {
  it('starts the cursor on the first player unit', () => {
    expect(startView(startPlay(chapter)).cursor).toEqual([1, 1]);
  });

  it('moves the cursor one square and stops at the map edge', () => {
    let v = startView(startPlay(chapter));
    v = moveCursor(v, -1, 0, rules);
    v = moveCursor(v, -1, 0, rules);
    expect(v.cursor).toEqual([0, 1]);
    expect(cursorTo(v, 9, -3, rules).cursor).toEqual([4, 0]);
  });

  it('selects with A, moves into range with A, and ignores A out of range', () => {
    let v = pressA(startView(startPlay(chapter)), rules);
    expect(v.selected).toBe('eirika');
    const outOfRange = pressA(cursorTo(v, 3, 1, rules), rules);
    expect(outOfRange.selected).toBe('eirika');
    v = pressA(moveCursor(v, 1, 0, rules), rules);
    expect(v.selected).toBeNull();
    expect(v.state.units.find((u) => u.id === 'eirika')).toMatchObject({ at: [2, 1], moved: true });
  });

  it('waits in place when A is pressed on the unit itself', () => {
    const v = pressA(pressA(startView(startPlay(chapter)), rules), rules);
    expect(v.state.units.find((u) => u.id === 'eirika')).toMatchObject({ at: [1, 1], moved: true });
  });

  it('cancels with B and returns the cursor to the unit', () => {
    let v = pressA(startView(startPlay(chapter)), rules);
    v = pressB(moveCursor(v, 1, 0, rules));
    expect(v.selected).toBeNull();
    expect(v.cursor).toEqual([1, 1]);
    expect(pressB(v)).toBe(v);
  });

  it('shows an enemy range on A and clears it on a second A', () => {
    let v = pressA(cursorTo(startView(startPlay(chapter)), 4, 0, rules), rules);
    expect(selectedUnit(v)?.id).toBe('brigand-1');
    expect(canMove(selectedUnit(v))).toBe(false);
    v = pressA(v, rules);
    expect(v.selected).toBeNull();
  });

  it('draws the arrow from the unit to the cursor, and hides it out of reach', () => {
    let v = pressA(startView(startPlay(chapter)), rules);
    expect(v.route).toEqual([6]);
    expect(visibleRoute(v, rules)).toBeNull();
    v = moveCursor(v, 1, 0, rules);
    expect(visibleRoute(v, rules)).toEqual([6, 7]);
    v = moveCursor(v, 1, 0, rules);
    expect(visibleRoute(v, rules)).toBeNull();
    v = moveCursor(v, -1, 0, rules);
    expect(visibleRoute(v, rules)).toEqual([6, 7]);
    expect(pressB(v).route).toBeNull();
  });
});
