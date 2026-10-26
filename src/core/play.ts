// A test-play session: unit positions and turns, built from one chapter of the project.
// The project is never changed by playing; leaving play discards the session.

import type { Stats } from './combat';
import type { ExpResult } from './experience';
import { DEFAULT_BEHAVIOUR, type Behaviour, type ProjectChapter, type ProjectUnit, type Team } from './project';

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
}

export interface PlayState {
  readonly turn: number;
  readonly units: readonly PlayUnit[];
  /** Units that have fallen, in order. */
  readonly fallen: readonly PlayUnit[];
}

export type Outcome = { readonly result: 'victory' } | { readonly result: 'defeat'; readonly fallen: PlayUnit | null };

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
): PlayState {
  return {
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
  };
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
 * is left, won (Rout) once no enemy is left. Checked after each battle.
 */
export function outcomeOf(state: PlayState): Outcome | null {
  const lost = state.fallen.find((u) => u.mustSurvive);
  if (lost) return { result: 'defeat', fallen: lost };
  if (!state.units.some((u) => u.team === 'player')) return { result: 'defeat', fallen: null };
  if (!state.units.some((u) => u.team === 'enemy')) return { result: 'victory' };
  return null;
}

/** Every unit ready to act again, as at the start of each phase in FE. */
export function readyAll(state: PlayState): PlayState {
  return { ...state, units: state.units.map((u) => (u.moved ? { ...u, moved: false } : u)) };
}

/** A new turn: the turn number goes up and every unit is ready again. */
export function endTurn(state: PlayState): PlayState {
  return { ...readyAll(state), turn: state.turn + 1 };
}
