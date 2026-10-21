// GBA-style controls for test play: a cursor moved one square at a time, A to act, B to cancel.

import { moveUnit, unitAt, type PlayState, type PlayUnit } from './play';

export interface PlayView {
  readonly state: PlayState;
  readonly cursor: readonly [number, number];
  /** The unit whose range is shown, if any. */
  readonly selected: string | null;
}

export interface PlayRules {
  readonly width: number;
  readonly height: number;
  /** Cells (y * width + x) the unit could end its move on. */
  rangeOf(unit: PlayUnit, state: PlayState): ReadonlyMap<number, number>;
}

/** The cursor starts on the first player unit, as FE starts it on the lord. */
export function startView(state: PlayState): PlayView {
  const first = state.units.find((u) => u.team === 'player') ?? state.units[0];
  return { state, cursor: first ? first.at : [0, 0], selected: null };
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
  return cx === view.cursor[0] && cy === view.cursor[1] ? view : { ...view, cursor: [cx, cy] };
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
    if (!rules.rangeOf(sel, view.state).has(y * rules.width + x)) return view;
    return { ...view, state: moveUnit(view.state, sel.id, [x, y]), selected: null };
  }
  if (here && here.id !== view.selected) return { ...view, selected: here.id };
  return { ...view, selected: null };
}

/** Cancels a selection and brings the cursor back to the unit, as FE does. */
export function pressB(view: PlayView): PlayView {
  const sel = selectedUnit(view);
  return sel ? { ...view, cursor: sel.at, selected: null } : view;
}
