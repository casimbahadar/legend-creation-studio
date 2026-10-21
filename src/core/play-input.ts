// GBA-style controls for test play: a cursor moved one square at a time, A to act, B to cancel.
// While a unit is being moved the cursor stays inside its reach; after it moves, FE's action menu
// (Attack, Wait) opens, B undoes the move, and Attack picks a target. While a unit walks or a battle
// plays, input waits.

import type { Strike } from './combat';
import { followCursor, shortestRoute, type MoveSearch } from './movement';
import { applyBattle, finishAction, moveUnit, unitAt, type PlayState, type PlayUnit } from './play';

export type MenuOption = 'attack' | 'wait';

export type Action =
  /** The action menu for a unit that has just moved from `from`. */
  | { readonly kind: 'menu'; readonly unit: string; readonly from: readonly [number, number]; readonly index: number }
  /** Choosing which enemy to attack. */
  | { readonly kind: 'target'; readonly unit: string; readonly from: readonly [number, number]; readonly targets: readonly string[]; readonly index: number };

export interface Battle {
  readonly attacker: string;
  readonly defender: string;
  readonly strikes: readonly Strike[];
}

export interface PlayView {
  readonly state: PlayState;
  readonly cursor: readonly [number, number];
  /** The unit whose range is shown, if any. */
  readonly selected: string | null;
  /** The movement arrow while moving a unit: cell indices from the unit to the cursor. */
  readonly route: readonly number[] | null;
  /** A unit walking its route to the square it was just moved to, from `from`. Input waits until finishWalk. */
  readonly walking: { readonly id: string; readonly route: readonly number[]; readonly from: readonly [number, number] } | null;
  readonly action: Action | null;
  /** A fight being shown. Input waits until finishBattle. */
  readonly battle: Battle | null;
}

export interface PlayRules {
  readonly width: number;
  readonly height: number;
  /** Where the unit can go this turn and how; its stops are the cells it can end on. */
  searchOf(unit: PlayUnit, state: PlayState): MoveSearch;
  /** Ids of enemies the unit could attack from where it stands, nearest first. */
  targetsOf(unit: PlayUnit, state: PlayState): string[];
  /** The blows of a fight between two units where they stand. */
  fight(attacker: PlayUnit, defender: PlayUnit, state: PlayState): Strike[];
}

/** The cursor starts on the first player unit, as FE starts it on the lord. */
export function startView(state: PlayState): PlayView {
  const first = state.units.find((u) => u.team === 'player') ?? state.units[0];
  return { state, cursor: first ? first.at : [0, 0], selected: null, route: null, walking: null, action: null, battle: null };
}

const unitById = (state: PlayState, id: string | null) => (id === null ? undefined : state.units.find((u) => u.id === id));

export function selectedUnit(view: PlayView): PlayUnit | undefined {
  return unitById(view.state, view.selected);
}

/** A player unit that hasn't acted this turn can be moved; anything else only shows its range. */
export function canMove(unit: PlayUnit | undefined): boolean {
  return !!unit && unit.team === 'player' && !unit.moved;
}

/** Input is ignored while a unit walks or a battle plays. */
const busy = (view: PlayView) => !!view.walking || !!view.battle;

/** The search for the unit being moved, if one is selected and can still move. */
function moving(view: PlayView, rules: PlayRules): { unit: PlayUnit; search: MoveSearch } | null {
  const unit = selectedUnit(view);
  return unit && canMove(unit) ? { unit, search: rules.searchOf(unit, view.state) } : null;
}

export function menuOptions(view: PlayView, rules: PlayRules): MenuOption[] {
  const unit = view.action ? unitById(view.state, view.action.unit) : undefined;
  if (!unit) return [];
  return rules.targetsOf(unit, view.state).length ? ['attack', 'wait'] : ['wait'];
}

function openMenu(view: PlayView, unit: string, from: readonly [number, number]): PlayView {
  return { ...view, selected: null, route: null, action: { kind: 'menu', unit, from, index: 0 } };
}

/**
 * Moves the cursor to (x, y), clamped to the map. While a unit is being moved the cursor only goes
 * where the unit can reach (its blue squares, plus friends standing inside its range); anywhere else
 * it stays put, so a held direction stops at the edge of the range with the arrow still showing.
 */
export function cursorTo(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  if (busy(view) || view.action) return view;
  const cx = Math.min(Math.max(0, x), rules.width - 1);
  const cy = Math.min(Math.max(0, y), rules.height - 1);
  if (cx === view.cursor[0] && cy === view.cursor[1]) return view;
  const m = moving(view, rules);
  if (!m) return { ...view, cursor: [cx, cy] };
  const cell = cy * rules.width + cx;
  if (!m.search.reached.has(cell)) return view;
  return { ...view, cursor: [cx, cy], route: followCursor(m.search, view.route ?? [m.search.start], cell) };
}

/** A D-pad press: moves the cursor, or the highlight in the action menu, or the chosen target. */
export function moveCursor(view: PlayView, dx: number, dy: number, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  const a = view.action;
  if (a?.kind === 'menu') {
    const n = menuOptions(view, rules).length;
    return dy ? { ...view, action: { ...a, index: (a.index + dy + n) % n } } : view;
  }
  if (a?.kind === 'target') {
    const n = a.targets.length;
    const index = (a.index + (dx + dy > 0 ? 1 : -1) + n) % n;
    const target = unitById(view.state, a.targets[index]!);
    return { ...view, action: { ...a, index }, cursor: target ? target.at : view.cursor };
  }
  return cursorTo(view, view.cursor[0] + dx, view.cursor[1] + dy, rules);
}

/** A tap on a square: moves the cursor there and presses A. Ignored outside the reach of a unit being moved. */
export function tapAt(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  const a = view.action;
  if (a?.kind === 'target') {
    // Tap a target to choose it; tap it again to attack.
    const index = a.targets.findIndex((id) => {
      const t = unitById(view.state, id);
      return t && t.at[0] === x && t.at[1] === y;
    });
    if (index < 0) return view;
    if (index === a.index) return pressA(view, rules);
    return { ...view, action: { ...a, index }, cursor: [x, y] };
  }
  if (a) return view;
  const moved = cursorTo(view, x, y, rules);
  if (moved.cursor[0] !== x || moved.cursor[1] !== y) return view;
  return pressA(moved, rules);
}

/** Picks an option in the action menu, as A does on the highlighted one. */
export function chooseOption(view: PlayView, option: MenuOption, rules: PlayRules): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'menu') return view;
  const unit = unitById(view.state, a.unit);
  if (!unit) return view;
  if (option === 'wait') return { ...view, state: finishAction(view.state, unit.id), action: null };
  const targets = rules.targetsOf(unit, view.state);
  const first = unitById(view.state, targets[0] ?? null);
  if (!first) return view;
  return { ...view, action: { kind: 'target', unit: unit.id, from: a.from, targets, index: 0 }, cursor: first.at };
}

export function pressA(view: PlayView, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  const a = view.action;
  if (a?.kind === 'menu') {
    const option = menuOptions(view, rules)[a.index];
    return option ? chooseOption(view, option, rules) : view;
  }
  if (a?.kind === 'target') {
    const attacker = unitById(view.state, a.unit);
    const defender = unitById(view.state, a.targets[a.index] ?? null);
    if (!attacker || !defender) return view;
    return { ...view, action: null, battle: { attacker: attacker.id, defender: defender.id, strikes: rules.fight(attacker, defender, view.state) } };
  }
  const [x, y] = view.cursor;
  const here = unitAt(view.state, x, y);
  const m = moving(view, rules);
  if (m) {
    // Move into range (the unit's own square opens the menu where it stands); anywhere else does nothing, as in FE.
    const cell = y * rules.width + x;
    if (!m.search.stops.has(cell)) return view;
    const from = m.unit.at;
    if (cell === m.search.start) return openMenu(view, m.unit.id, from);
    const route = view.route && view.route[view.route.length - 1] === cell ? view.route : (shortestRoute(m.search, cell) ?? [m.search.start, cell]);
    return { ...view, state: moveUnit(view.state, m.unit.id, [x, y]), selected: null, route: null, walking: { id: m.unit.id, route, from } };
  }
  if (here && here.id !== view.selected) {
    return { ...view, selected: here.id, route: canMove(here) ? [here.at[1] * rules.width + here.at[0]] : null };
  }
  return { ...view, selected: null, route: null };
}

/**
 * B: from targeting, back to the menu; from the menu, undo the move (the unit goes back and is picked
 * up again with the arrow to where it was); otherwise cancel the selection and bring the cursor back.
 */
export function pressB(view: PlayView, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  const a = view.action;
  if (a?.kind === 'target') {
    const unit = unitById(view.state, a.unit);
    return { ...view, action: { kind: 'menu', unit: a.unit, from: a.from, index: 0 }, cursor: unit ? unit.at : view.cursor };
  }
  if (a?.kind === 'menu') {
    const unit = unitById(view.state, a.unit);
    if (!unit) return { ...view, action: null };
    const dest = unit.at;
    const state = moveUnit(view.state, unit.id, a.from);
    const back = unitById(state, unit.id)!;
    const search = rules.searchOf(back, state);
    const route = shortestRoute(search, dest[1] * rules.width + dest[0]) ?? [search.start];
    return { ...view, state, action: null, selected: unit.id, route, cursor: dest };
  }
  const sel = selectedUnit(view);
  return sel ? { ...view, cursor: sel.at, selected: null, route: null } : view;
}

/** The walk is over: the action menu opens for the unit. */
export function finishWalk(view: PlayView): PlayView {
  return view.walking ? openMenu({ ...view, walking: null }, view.walking.id, view.walking.from) : view;
}

/** The battle has been shown: apply its result. */
export function finishBattle(view: PlayView): PlayView {
  const b = view.battle;
  if (!b) return view;
  const attacker = unitById(view.state, b.attacker);
  const defender = unitById(view.state, b.defender);
  const last = b.strikes[b.strikes.length - 1];
  const state = applyBattle(view.state, b.attacker, b.defender, last?.attackerHp ?? attacker?.hp ?? 0, last?.defenderHp ?? defender?.hp ?? 0);
  const still = unitById(state, b.attacker);
  return { ...view, state, battle: null, cursor: still ? still.at : view.cursor };
}

/** The arrow to draw: only while it ends under the cursor. */
export function visibleRoute(view: PlayView, rules: PlayRules): readonly number[] | null {
  const r = view.route;
  return r && r.length > 1 && r[r.length - 1] === view.cursor[1] * rules.width + view.cursor[0] ? r : null;
}

/** Walking pace, set in playtesting: between EC's normal (200 ms) and fast (110 ms) speeds. */
export const WALK_MS_PER_SQUARE = 150;

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
