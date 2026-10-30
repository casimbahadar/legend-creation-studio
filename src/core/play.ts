// A test-play session: unit positions and turns, built from one chapter of the project.
// The project is never changed by playing; leaving play discards the session.

import type { Stats } from './combat';
import type { ExpResult } from './experience';
import { goalRule, type GoalRule } from './goals';
import { DEFAULT_BEHAVIOUR, type Behaviour, type PlaceKind, type ProjectChapter, type ProjectUnit, type Team } from './project';

export interface PlayUnit {
  readonly id: string;
  readonly class: string;
  readonly team: Team;
  readonly at: readonly [number, number];
  /** Item names, as in the project. */
  readonly items: readonly string[];
  /** Uses left for each item, in the same order; null for one that never runs out. */
  readonly uses: readonly (number | null)[];
  readonly level: number;
  /** Movement added by Boots (movBonus); none if left out. */
  readonly movBonus?: number;
  /** Experience toward the next level, 0 to 99; null for a unit that gains none (not a player unit, or at its last level). */
  readonly exp: number | null;
  readonly stats: Stats;
  /** Current HP; the unit falls at 0. */
  readonly hp: number;
  /** How the unit acts when the computer moves it. */
  readonly ai: Behaviour;
  /** The chapter is lost if this unit falls. */
  readonly mustSurvive: boolean;
  /** Has acted this turn. */
  readonly moved: boolean;
  /** For computer-controlled units: whether it is set on healing itself (see ai.ts); not if left out. */
  readonly healing?: boolean;
  /** A status from a staff, if any. */
  readonly status?: Status;
  /** Barrier's Res bonus (barrierDuration): 7 when given, a point less at each of its side's phase starts; none if left out. */
  readonly barrier?: number;
}

/** The statuses staves give (UNIT_STATUS_SLEEP, UNIT_STATUS_SILENCED, UNIT_STATUS_BERSERK). */
export type StatusKind = 'sleep' | 'silence' | 'berserk';

/** A status and how many more of the unit's own phases begin before it wears off (statusDuration). */
export interface Status {
  readonly kind: StatusKind;
  readonly turns: number;
}

/** How long a status lasts (SetUnitStatus). */
export const STATUS_TURNS = 5;

/** A door, chest, village or house in play (decision 38), with what it gives as plain values. */
export interface PlayPlace {
  readonly kind: PlaceKind;
  readonly at: readonly [number, number];
  readonly item?: string;
  readonly gold?: number;
  /** What is said there. */
  readonly text?: string;
  /** FE8's own scene here does more than test play shows (checking who visits, a unit joining). */
  readonly more?: boolean;
  /** Opened, or visited: each opens or is visited once. */
  readonly done?: boolean;
}

/** What a unit found opening a chest or visiting a village or house. */
export interface Found {
  readonly kind: PlaceKind;
  readonly unit: string;
  readonly text?: string;
  readonly item?: string;
  readonly gold?: number;
  /** The item was left behind: the unit's items were full. */
  readonly full?: boolean;
  readonly more?: boolean;
}

export interface PlayState {
  readonly turn: number;
  readonly units: readonly PlayUnit[];
  /** Units that have fallen, in order. */
  readonly fallen: readonly PlayUnit[];
  /** What wins the chapter (decision 36); Rout if left out. */
  readonly goal?: GoalRule;
  /** The lord has seized. */
  readonly seized?: boolean;
  /** Doors, chests, villages and houses; none if left out. */
  readonly places?: readonly PlayPlace[];
  /** The party's gold from chests, villages and houses; none if left out. */
  readonly gold?: number;
}

export type Outcome = { readonly result: 'victory' } | { readonly result: 'defeat'; readonly fallen: PlayUnit | null };

/** Items a unit can carry in play (UNIT_ITEM_COUNT); it starts with at most four (MAX_ITEMS). */
export const UNIT_ITEM_COUNT = 5;

/** Player and ally units are on one side; enemies on the other. */
export function areFoes(a: Team, b: Team): boolean {
  return (a === 'enemy') !== (b === 'enemy');
}

/**
 * Starts a session from a chapter; `statsOf` gives each unit's stats (from its class and level),
 * `expOf` its starting experience (none if left out) and `usesOf` an item's full uses (null, or left
 * out: never runs out).
 */
export function startPlay(
  chapter: ProjectChapter,
  statsOf: (unit: ProjectUnit) => Stats,
  expOf: (unit: ProjectUnit) => number | null = () => null,
  usesOf: (item: string) => number | null = () => null,
  places: readonly PlayPlace[] = [],
): PlayState {
  return {
    ...(places.length ? { places } : {}),
    turn: 1,
    units: chapter.units.map((u) => {
      const stats = statsOf(u);
      return {
        id: u.id,
        class: u.class,
        team: u.team,
        at: [u.at[0], u.at[1]],
        items: [...(u.items ?? [])],
        uses: (u.items ?? []).map(usesOf),
        level: u.level,
        exp: expOf(u),
        stats,
        hp: stats.hp,
        ai: u.ai ?? DEFAULT_BEHAVIOUR,
        mustSurvive: (u.mustSurvive ?? false) && u.team !== 'enemy',
        moved: false,
      };
    }),
    fallen: [],
    goal: goalRule(chapter),
  };
}

/** The door, chest, village or house of `kind` at a square, if it isn't opened or visited yet. */
export function closedPlace(state: PlayState, kind: PlaceKind | readonly PlaceKind[], x: number, y: number): PlayPlace | undefined {
  const kinds: readonly PlaceKind[] = typeof kind === 'string' ? [kind] : kind;
  return state.places?.find((p) => kinds.includes(p.kind) && !p.done && p.at[0] === x && p.at[1] === y);
}

/** Closed doors beside a square (ForEachAdjacentPosition, TryAddClosedDoorToTargetList), left, right, up, down. */
export function doorsBeside(state: PlayState, at: readonly [number, number]): PlayPlace[] {
  return ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).flatMap(([dx, dy]) => closedPlace(state, 'door', at[0] + dx, at[1] + dy) ?? []);
}

/** Marks places done and gives a unit what one of them holds: its item if the unit has room, or its gold to the party. */
function open(state: PlayState, done: readonly PlayPlace[], unitId: string, gives: PlayPlace | undefined, usesOf: (item: string) => number | null): { state: PlayState; found: Found | null } {
  let next: PlayState = { ...state, places: state.places?.map((p) => (done.includes(p) ? { ...p, done: true } : p)) };
  if (!gives || gives.kind === 'door') return { state: next, found: null };
  const unit = next.units.find((u) => u.id === unitId);
  const full = gives.item !== undefined && (!unit || unit.items.length >= UNIT_ITEM_COUNT);
  if (gives.item !== undefined && !full) {
    next = { ...next, units: next.units.map((u) => (u.id === unitId ? { ...u, items: [...u.items, gives.item!], uses: [...u.uses, usesOf(gives.item!)] } : u)) };
  }
  if (gives.gold !== undefined) next = { ...next, gold: (next.gold ?? 0) + gives.gold };
  const found: Found = {
    kind: gives.kind,
    unit: unitId,
    ...(gives.text !== undefined ? { text: gives.text } : {}),
    ...(gives.item !== undefined ? { item: gives.item } : {}),
    ...(gives.gold !== undefined ? { gold: gives.gold } : {}),
    ...(full ? { full: true } : {}),
    ...(gives.more ? { more: true } : {}),
  };
  return { state: next, found };
}

/**
 * A unit uses a key (ExecKeyItem): one use of item `index` (if given) opens every closed door beside
 * it and the closed chest it stands on, whose item or gold it gets.
 */
export function openWithKey(state: PlayState, unitId: string, index: number | null, usesOf: (item: string) => number | null = () => null): { state: PlayState; found: Found | null } {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return { state, found: null };
  const chest = closedPlace(state, 'chest', unit.at[0], unit.at[1]);
  const spent = index === null ? state : spendUses(state, unitId, index, 1);
  return open(spent, [...doorsBeside(state, unit.at), ...(chest ? [chest] : [])], unitId, chest, usesOf);
}

/**
 * A door or chest at one square opens for a unit (ActionPick, the Unlock staff: StartAvailableDoorTileEvent
 * and StartAvailableChestTileEvent there): a chest's item or gold goes to the unit.
 */
export function openAt(state: PlayState, unitId: string, at: readonly [number, number], usesOf: (item: string) => number | null = () => null): { state: PlayState; found: Found | null } {
  const door = closedPlace(state, 'door', at[0], at[1]);
  const chest = closedPlace(state, 'chest', at[0], at[1]);
  return open(state, [...(door ? [door] : []), ...(chest ? [chest] : [])], unitId, chest, usesOf);
}

/** A unit visits the village or house it stands on: what's said there, and its item or gold. */
export function visitPlace(state: PlayState, unitId: string, usesOf: (item: string) => number | null = () => null): { state: PlayState; found: Found | null } {
  const unit = state.units.find((u) => u.id === unitId);
  const place = unit && closedPlace(state, ['village', 'house'], unit.at[0], unit.at[1]);
  return place ? open(state, [place], unitId, place, usesOf) : { state, found: null };
}

export function unitAt(state: PlayState, x: number, y: number): PlayUnit | undefined {
  return state.units.find((u) => u.at[0] === x && u.at[1] === y);
}

/** Puts a unit on a square. Callers check the destination is in range. */
export function moveUnit(state: PlayState, id: string, to: readonly [number, number]): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, at: [to[0], to[1]] } : u)) };
}

/** Marks a unit as having acted this turn. */
export function finishAction(state: PlayState, id: string): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, moved: true } : u)) };
}

/** Applies a fight's result: both units' HP, fallen units removed, and the attacker done for the turn. */
export function applyBattle(state: PlayState, attacker: string, defender: string, attackerHp: number, defenderHp: number): PlayState {
  const all = state.units.map((u) => (u.id === attacker ? { ...u, hp: attackerHp, moved: true } : u.id === defender ? { ...u, hp: defenderHp } : u));
  return { ...state, units: all.filter((u) => u.hp > 0), fallen: [...state.fallen, ...all.filter((u) => u.hp <= 0)] };
}

/** Spends `count` uses of a unit's item `index`; an item with none left is gone, as FE8 removes a broken weapon. */
export function spendUses(state: PlayState, id: string, index: number, count: number): PlayState {
  if (count <= 0) return state;
  return {
    ...state,
    units: state.units.map((u) => {
      const left = u.uses[index];
      if (u.id !== id || left === null || left === undefined) return u;
      if (left - count > 0) return { ...u, uses: u.uses.map((n, i) => (i === index ? left - count : n)) };
      return { ...u, items: u.items.filter((_, i) => i !== index), uses: u.uses.filter((_, i) => i !== index) };
    }),
  };
}

/** Moves a unit's item `index` to the top of its items, as FE8's Equip does, so it fights with it first. */
export function equipItem(state: PlayState, id: string, index: number): PlayState {
  const move = <T>(list: readonly T[]) => [list[index]!, ...list.filter((_, i) => i !== index)];
  return { ...state, units: state.units.map((u) => (u.id === id && index > 0 && index < u.items.length ? { ...u, items: move(u.items), uses: move(u.uses) } : u)) };
}

/**
 * Trades item `index` of unit `a` with slot `slot` of unit `b`, as FE8's trade menu does: two items
 * swap; an item put on an empty slot (past the last item) moves to the end of the other's items.
 */
export function tradeItems(state: PlayState, a: string, index: number, b: string, slot: number): PlayState {
  const ua = state.units.find((u) => u.id === a);
  const ub = state.units.find((u) => u.id === b);
  if (!ua || !ub || index >= ua.items.length) return state;
  const item = ua.items[index]!;
  const uses = ua.uses[index] ?? null;
  if (slot < ub.items.length) {
    const other = ub.items[slot]!;
    const otherUses = ub.uses[slot] ?? null;
    const put = (u: PlayUnit, i: number, name: string, n: number | null): PlayUnit => ({ ...u, items: u.items.map((x, k) => (k === i ? name : x)), uses: u.uses.map((x, k) => (k === i ? n : x)) });
    return { ...state, units: state.units.map((u) => (u.id === a ? put(u, index, other, otherUses) : u.id === b ? put(u, slot, item, uses) : u)) };
  }
  return {
    ...state,
    units: state.units.map((u) =>
      u.id === a
        ? { ...u, items: u.items.filter((_, k) => k !== index), uses: u.uses.filter((_, k) => k !== index) }
        : u.id === b
          ? { ...u, items: [...u.items, item], uses: [...u.uses, uses] }
          : u,
    ),
  };
}

/**
 * Unit `thief` steals item `index` of unit `target` (ActionSteal, AiStartStealAction): the item, with
 * its uses, leaves the target's items and goes to the end of the thief's.
 */
export function stealItem(state: PlayState, thief: string, target: string, index: number): PlayState {
  const from = state.units.find((u) => u.id === target);
  if (!from || index >= from.items.length || !state.units.some((u) => u.id === thief)) return state;
  const item = from.items[index]!;
  const uses = from.uses[index] ?? null;
  return {
    ...state,
    units: state.units.map((u) =>
      u.id === target
        ? { ...u, items: u.items.filter((_, i) => i !== index), uses: u.uses.filter((_, i) => i !== index) }
        : u.id === thief
          ? { ...u, items: [...u.items, item], uses: [...u.uses, uses] }
          : u,
    ),
  };
}

/** Drops a unit's item `index`. */
export function discardItem(state: PlayState, id: string, index: number): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, items: u.items.filter((_, i) => i !== index), uses: u.uses.filter((_, i) => i !== index) } : u)) };
}

/** A unit gets back up to `amount` HP, not past its maximum. */
export function healUnit(state: PlayState, id: string, amount: number): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, hp: Math.min(u.stats.hp, u.hp + amount) } : u)) };
}

/** Uses a healing item: the unit gets back up to `heal` HP and the item loses a use. */
export function useHealItem(state: PlayState, id: string, index: number, heal: number): PlayState {
  return spendUses(healUnit(state, id, heal), id, index, 1);
}

/**
 * Uses a stat booster: the unit's stats become `stats` (already cut to its caps), its current HP rising
 * with its maximum, and its movement bonus `movBonus`; the item loses a use (ApplyStatBoostItem).
 */
export function boostUnit(state: PlayState, id: string, index: number, stats: Stats, movBonus: number): PlayState {
  const boosted = { ...state, units: state.units.map((u) => (u.id === id ? { ...u, stats, hp: u.hp + (stats.hp - u.stats.hp), movBonus } : u)) };
  return spendUses(boosted, id, index, 1);
}

/** A unit's experience after a fight: its new level and experience, and any level-up's gains (max HP rises; current HP stays). */
export function applyExp(state: PlayState, id: string, result: ExpResult): PlayState {
  const up = result.levelUp;
  return {
    ...state,
    units: state.units.map((u) =>
      u.id !== id
        ? u
        : {
            ...u,
            level: result.level,
            exp: result.exp,
            stats: up
              ? { ...u.stats, hp: u.stats.hp + up.hp, str: u.stats.str + up.str, skl: u.stats.skl + up.skl, spd: u.stats.spd + up.spd, def: u.stats.def + up.def, res: u.stats.res + up.res, lck: u.stats.lck + up.lck }
              : u.stats,
          },
    ),
  };
}

/**
 * Whether the chapter is over (decision 26): lost if a Must survive unit has fallen or no player unit
 * is left; won by its goal (decision 36): Rout once no enemy is left, Seize once the lord has seized,
 * Defeat boss once the boss has fallen, Survive once the turn after the last has begun. Checked after
 * each battle, action and new turn.
 */
export function outcomeOf(state: PlayState): Outcome | null {
  const lost = state.fallen.find((u) => u.mustSurvive);
  if (lost) return { result: 'defeat', fallen: lost };
  if (!state.units.some((u) => u.team === 'player')) return { result: 'defeat', fallen: null };
  const goal = state.goal ?? { kind: 'rout' };
  const won =
    goal.kind === 'seize'
      ? !!state.seized
      : goal.kind === 'boss'
        ? state.fallen.some((u) => u.id === goal.unit)
        : goal.kind === 'survive'
          ? state.turn > goal.turns
          : !state.units.some((u) => u.team === 'enemy');
  return won ? { result: 'victory' } : null;
}

/** The lord seizes: the unit is done and the chapter is won. */
export function seize(state: PlayState, id: string): PlayState {
  return { ...finishAction(state, id), seized: true };
}

/** A unit gets a status, lasting STATUS_TURNS of its own phases (SetUnitStatus). */
export function setStatus(state: PlayState, id: string, kind: StatusKind): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, status: { kind, turns: STATUS_TURNS } } : u)) };
}

/** Restore: the unit's status goes (ExecRestore). */
export function clearStatus(state: PlayState, id: string): PlayState {
  return {
    ...state,
    units: state.units.map((u) => {
      if (u.id !== id || !u.status) return u;
      const { status: _gone, ...rest } = u;
      return rest;
    }),
  };
}

/** Barrier: the unit's Res is raised by 7 (ExecBarrierStaff). */
export function setBarrier(state: PlayState, id: string): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, barrier: 7 } : u)) };
}

/**
 * The start of a team's phase (TickActiveFactionTurn): each of its units' Barrier bonus drops a point,
 * and each status has a phase less left, going at none.
 */
export function tickStatuses(state: PlayState, team: PlayUnit['team']): PlayState {
  return {
    ...state,
    units: state.units.map((unit) => {
      if (unit.team !== team) return unit;
      const u = unit.barrier ? { ...unit, barrier: unit.barrier - 1 } : unit;
      if (!u.status) return u;
      const turns = u.status.turns - 1;
      if (turns > 0) return { ...u, status: { ...u.status, turns } };
      const { status: _gone, ...rest } = u;
      return rest;
    }),
  };
}

/** Asleep or berserk units don't act in their side's phase (BuildAiUnitList; the player can't select them). */
export function cannotAct(unit: PlayUnit): boolean {
  return unit.status?.kind === 'sleep' || unit.status?.kind === 'berserk';
}

/** Every unit ready to act again, as at the start of each phase in FE. */
export function readyAll(state: PlayState): PlayState {
  return { ...state, units: state.units.map((u) => (u.moved ? { ...u, moved: false } : u)) };
}

/** A new turn: the turn number goes up and every unit is ready again. */
export function endTurn(state: PlayState): PlayState {
  return { ...readyAll(state), turn: state.turn + 1 };
}
