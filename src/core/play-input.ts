// GBA-style controls for test play: a cursor moved one square at a time, A to act, B to cancel.

import { followCursor, type MoveSearch } from './movement';
import { moveUnit, unitAt, type PlayState, type PlayUnit } from './play';

export interface PlayView {
  readonly state: PlayState;
  readonly cursor: readonly [number, number];
  /** The unit whose range is shown, if any. */
  readonly selected: string | null;
  /** The movement arrow while moving a unit: cell indices from the unit to the last square it could reach. */
  readonly route: readonly number[] | null;
}

export interface PlayRules {
  readonly width: number;
  readonly height: number;
  /** Where the unit can go this turn and how; its stops are the cells it can end on. */
  searchOf(unit: PlayUnit, state: PlayState): MoveSearch;
}

/** The cursor starts on the first player unit, as FE starts it on the lord. */
export function startView(state: PlayState): PlayView {
  const first = state.units.find((u) => u.team === 'player') ?? state.units[0];
  return { state, cursor: first ? first.at : [0, 0], selected: null, route: null };
}

export function selectedUnit(view: PlayView): PlayUnit | undefined {
  return view.selected === null ? undefined : view.state.units.find((u) => u.id === view.selected);
}

/** A player unit that hasn't acted this turn can be moved; anything else only shows its range. */
export function canMove(unit: PlayUnit | undefined): boolean {
  return !!unit && unit.team === 'player' && !unit.moved;
}

export function cursorTo(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  const cx = Math.min(Math.max(0, x), rules.width - 1);
  const cy = Math.min(Math.max(0, y), rules.height - 1);
  if (cx === view.cursor[0] && cy === view.cursor[1]) return view;
  const sel = selectedUnit(view);
  if (!sel || !canMove(sel) || !view.route) return { ...view, cursor: [cx, cy] };
  // Out of reach, the arrow keeps its last shape (hidden) so it can carry on when the cursor comes back.
  const route = followCursor(rules.searchOf(sel, view.state), view.route, cy * rules.width + cx) ?? view.route;
  return { ...view, cursor: [cx, cy], route };
}

/** The arrow to draw: only while it ends under the cursor. */
export function visibleRoute(view: PlayView, rules: PlayRules): readonly number[] | null {
  const r = view.route;
  return r && r.length > 1 && r[r.length - 1] === view.cursor[1] * rules.width + view.cursor[0] ? r : null;
}

export function moveCursor(view: PlayView, dx: number, dy: number, rules: PlayRules): PlayView {
  return cursorTo(view, view.cursor[0] + dx, view.cursor[1] + dy, rules);
}

export function pressA(view: PlayView, rules: PlayRules): PlayView {
  const [x, y] = view.cursor;
  const sel = selectedUnit(view);
  const here = unitAt(view.state, x, y);
  if (sel && canMove(sel)) {
    // Move into range (the unit's own square means wait); anywhere else does nothing, as in FE.
    if (!rules.searchOf(sel, view.state).stops.has(y * rules.width + x)) return view;
    return { ...view, state: moveUnit(view.state, sel.id, [x, y]), selected: null, route: null };
  }
  if (here && here.id !== view.selected) {
    return { ...view, selected: here.id, route: canMove(here) ? [here.at[1] * rules.width + here.at[0]] : null };
  }
  return { ...view, selected: null, route: null };
}

/** Cancels a selection and brings the cursor back to the unit, as FE does. */
export function pressB(view: PlayView): PlayView {
  const sel = selectedUnit(view);
  return sel ? { ...view, cursor: sel.at, selected: null, route: null } : view;
}
