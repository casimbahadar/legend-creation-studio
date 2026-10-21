// A test-play session: unit positions and turns, built from one chapter of the project.
// The project is never changed by playing; leaving play discards the session.

import type { Stats } from './combat';
import type { ProjectChapter, ProjectUnit, Team } from './project';

export interface PlayUnit {
  readonly id: string;
  readonly class: string;
  readonly team: Team;
  readonly at: readonly [number, number];
  /** Item names, as in the project. */
  readonly items: readonly string[];
  readonly level: number;
  readonly stats: Stats;
  /** Current HP; the unit falls at 0. */
  readonly hp: number;
  /** Has acted this turn. */
  readonly moved: boolean;
}

export interface PlayState {
  readonly turn: number;
  readonly units: readonly PlayUnit[];
}

/** Player and ally units are on one side; enemies on the other. */
export function areFoes(a: Team, b: Team): boolean {
  return (a === 'enemy') !== (b === 'enemy');
}

/** Starts a session from a chapter; `statsOf` gives each unit's stats (from its class and level). */
export function startPlay(chapter: ProjectChapter, statsOf: (unit: ProjectUnit) => Stats): PlayState {
  return {
    turn: 1,
    units: chapter.units.map((u) => {
      const stats = statsOf(u);
      return { id: u.id, class: u.class, team: u.team, at: [u.at[0], u.at[1]], items: [...(u.items ?? [])], level: u.level, stats, hp: stats.hp, moved: false };
    }),
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
  const units = state.units
    .map((u) => (u.id === attacker ? { ...u, hp: attackerHp, moved: true } : u.id === defender ? { ...u, hp: defenderHp } : u))
    .filter((u) => u.hp > 0);
  return { ...state, units };
}

/** Ends the player's turn. Enemy and ally phases come later; for now every unit is ready again. */
export function endTurn(state: PlayState): PlayState {
  return { turn: state.turn + 1, units: state.units.map((u) => ({ ...u, moved: false })) };
}
