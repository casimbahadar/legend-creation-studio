import { describe, expect, it } from 'vitest';
import { startPlay, type PlayState, type PlayUnit } from './play';
import { searchMoves } from './movement';
import {
  canMove,
  cursorTo,
  finishWalk,
  moveCursor,
  pressA,
  pressB,
  selectedUnit,
  startView,
  tapAt,
  visibleRoute,
  walkPosition,
  type PlayRules,
} from './play-input';

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

  it('selects with A and moves into range with A, walking the arrow', () => {
    let v = pressA(startView(startPlay(chapter)), rules);
    expect(v.selected).toBe('eirika');
    v = pressA(moveCursor(v, 1, 0, rules), rules);
    expect(v.selected).toBeNull();
    expect(v.state.units.find((u) => u.id === 'eirika')).toMatchObject({ at: [2, 1], moved: true });
    expect(v.walking).toEqual({ id: 'eirika', route: [6, 7] });
  });

  it('keeps the cursor inside the reach of a unit being moved', () => {
    let v = pressA(startView(startPlay(chapter)), rules);
    v = moveCursor(moveCursor(moveCursor(v, 1, 0, rules), 1, 0, rules), 1, 0, rules);
    expect(v.cursor).toEqual([2, 1]);
    expect(visibleRoute(v, rules)).toEqual([6, 7]);
    // Without a unit selected the cursor goes anywhere.
    expect(moveCursor(pressB(v), 3, 0, rules).cursor).toEqual([4, 1]);
  });

  it('ignores taps outside the reach of a unit being moved', () => {
    const v = pressA(startView(startPlay(chapter)), rules);
    expect(tapAt(v, 3, 1, rules)).toBe(v);
    const moved = tapAt(v, 1, 2, rules);
    expect(moved.state.units.find((u) => u.id === 'eirika')?.at).toEqual([1, 2]);
  });

  it('ignores input while a unit walks, until the walk finishes', () => {
    const walking = pressA(moveCursor(pressA(startView(startPlay(chapter)), rules), 0, 1, rules), rules);
    expect(walking.walking).not.toBeNull();
    expect(moveCursor(walking, 1, 0, rules)).toBe(walking);
    expect(pressA(walking, rules)).toBe(walking);
    expect(pressB(walking)).toBe(walking);
    expect(moveCursor(finishWalk(walking), 1, 0, rules).cursor).toEqual([2, 2]);
  });

  it('waits in place when A is pressed on the unit itself, without walking', () => {
    const v = pressA(pressA(startView(startPlay(chapter)), rules), rules);
    expect(v.state.units.find((u) => u.id === 'eirika')).toMatchObject({ at: [1, 1], moved: true });
    expect(v.walking).toBeNull();
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

  it('draws the arrow from the unit to the cursor', () => {
    let v = pressA(startView(startPlay(chapter)), rules);
    expect(v.route).toEqual([6]);
    expect(visibleRoute(v, rules)).toBeNull();
    v = moveCursor(v, 1, 0, rules);
    expect(visibleRoute(v, rules)).toEqual([6, 7]);
    v = moveCursor(v, -1, 0, rules);
    expect(visibleRoute(v, rules)).toBeNull();
    expect(pressB(v).route).toBeNull();
  });
});

describe('walkPosition', () => {
  // Route along a 5-wide map: (0,0) -> (1,0) -> (1,1).
  const route = [0, 1, 6];
  it('moves one square per 200 ms in a straight line between squares', () => {
    expect(walkPosition(route, 5, 0)).toEqual({ x: 0, y: 0, done: false });
    expect(walkPosition(route, 5, 100)).toEqual({ x: 0.5, y: 0, done: false });
    expect(walkPosition(route, 5, 300)).toEqual({ x: 1, y: 0.5, done: false });
    expect(walkPosition(route, 5, 400)).toEqual({ x: 1, y: 1, done: true });
    expect(walkPosition(route, 5, 9999)).toEqual({ x: 1, y: 1, done: true });
  });
});
