// GBA-style controls for test play: a cursor moved one square at a time, A to act, B to cancel.
// While a unit is being moved the cursor stays inside its reach, and while it walks, input waits.

import { followCursor, shortestRoute, type MoveSearch } from './movement';
import { moveUnit, unitAt, type PlayState, type PlayUnit } from './play';

export interface PlayView {
  readonly state: PlayState;
  readonly cursor: readonly [number, number];
  /** The unit whose range is shown, if any. */
  readonly selected: string | null;
  /** The movement arrow while moving a unit: cell indices from the unit to the cursor. */
  readonly route: readonly number[] | null;
  /** A unit walking its route to the square it was just moved to. Input is ignored until finishWalk. */
  readonly walking: { readonly id: string; readonly route: readonly number[] } | null;
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
  return { state, cursor: first ? first.at : [0, 0], selected: null, route: null, walking: null };
}

export function selectedUnit(view: PlayView): PlayUnit | undefined {
  return view.selected === null ? undefined : view.state.units.find((u) => u.id === view.selected);
}

/** A player unit that hasn't acted this turn can be moved; anything else only shows its range. */
export function canMove(unit: PlayUnit | undefined): boolean {
  return !!unit && unit.team === 'player' && !unit.moved;
}

/** The search for the unit being moved, if one is selected and can still move. */
function moving(view: PlayView, rules: PlayRules): { unit: PlayUnit; search: MoveSearch } | null {
  const unit = selectedUnit(view);
  return unit && canMove(unit) ? { unit, search: rules.searchOf(unit, view.state) } : null;
}

/**
 * Moves the cursor to (x, y), clamped to the map. While a unit is being moved the cursor only goes
 * where the unit can reach (its blue squares, plus friends standing inside its range); anywhere else
 * it stays put, so a held direction stops at the edge of the range with the arrow still showing.
 */
export function cursorTo(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  if (view.walking) return view;
  const cx = Math.min(Math.max(0, x), rules.width - 1);
  const cy = Math.min(Math.max(0, y), rules.height - 1);
  if (cx === view.cursor[0] && cy === view.cursor[1]) return view;
  const m = moving(view, rules);
  if (!m) return { ...view, cursor: [cx, cy] };
  const cell = cy * rules.width + cx;
  if (!m.search.reached.has(cell)) return view;
  return { ...view, cursor: [cx, cy], route: followCursor(m.search, view.route ?? [m.search.start], cell) };
}

/** A tap on a square: moves the cursor there and presses A. Ignored outside the reach of a unit being moved. */
export function tapAt(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  const moved = cursorTo(view, x, y, rules);
  if (moved.cursor[0] !== x || moved.cursor[1] !== y) return view;
  return pressA(moved, rules);
}

/** The arrow to draw: only while it ends under the cursor. */
export function visibleRoute(view: PlayView, rules: PlayRules): readonly number[] | null {
  const r = view.route;
  return r && r.length > 1 && r[r.length - 1] === view.cursor[1] * rules.width + view.cursor[0] ? r : null;
}


export function pressA(view: PlayView, rules: PlayRules): PlayView {
  if (view.walking) return view;
  const [x, y] = view.cursor;
  const sel = selectedUnit(view);
  const here = unitAt(view.state, x, y);
  const m = moving(view, rules);
  if (sel && m) {
    // Move into range (the unit's own square means wait); anywhere else does nothing, as in FE.
    const cell = y * rules.width + x;
    if (!m.search.stops.has(cell)) return view;
    const route = view.route && view.route[view.route.length - 1] === cell ? view.route : (shortestRoute(m.search, cell) ?? [cell]);
    return {
      ...view,
      state: moveUnit(view.state, sel.id, [x, y]),
      selected: null,
      route: null,
      walking: route.length > 1 ? { id: sel.id, route } : null,
    };
  }
  if (here && here.id !== view.selected) {
    return { ...view, selected: here.id, route: canMove(here) ? [here.at[1] * rules.width + here.at[0]] : null };
  }
  return { ...view, selected: null, route: null };
}

/** Cancels a selection and brings the cursor back to the unit, as FE does. */
export function pressB(view: PlayView): PlayView {
  if (view.walking) return view;
  const sel = selectedUnit(view);
  return sel ? { ...view, cursor: sel.at, selected: null, route: null } : view;
}

export function moveCursor(view: PlayView, dx: number, dy: number, rules: PlayRules): PlayView {
  return cursorTo(view, view.cursor[0] + dx, view.cursor[1] + dy, rules);
}

export function finishWalk(view: PlayView): PlayView {
  return view.walking ? { ...view, walking: null } : view;
}

/** EC's walking pace at normal speed. */
export const WALK_MS_PER_SQUARE = 200;

/** Where a walking unit is drawn after `ms`, in squares (fractional between squares), and whether it has arrived. */
export function walkPosition(route: readonly number[], width: number, ms: number, msPerSquare = WALK_MS_PER_SQUARE): { x: number; y: number; done: boolean } {
  const steps = route.length - 1;
  const t = Math.max(0, ms) / msPerSquare;
  const i = Math.min(Math.floor(t), steps);
  const a = route[i]!;
  const b = route[Math.min(i + 1, steps)]!;
  const k = i >= steps ? 0 : t - i;
  const ax = a % width;
  const bx = b % width;
  const ay = Math.floor(a / width);
  const by = Math.floor(b / width);
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, done: t >= steps };
}
