// A test-play session: unit positions and turns, built from one chapter of the project.
// The project is never changed by playing; leaving play discards the session.

import type { ProjectChapter, Team } from './project';

export interface PlayUnit {
  readonly id: string;
  readonly class: string;
  readonly team: Team;
  readonly at: readonly [number, number];
  /** Item names, as in the project. */
  readonly items: readonly string[];
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

export function startPlay(chapter: ProjectChapter): PlayState {
  return {
    turn: 1,
    units: chapter.units.map((u) => ({ id: u.id, class: u.class, team: u.team, at: [u.at[0], u.at[1]], items: [...(u.items ?? [])], moved: false })),
  };
}

export function unitAt(state: PlayState, x: number, y: number): PlayUnit | undefined {
  return state.units.find((u) => u.at[0] === x && u.at[1] === y);
}

/** Moves a unit and marks it as having acted. Callers check the destination is in range. */
export function moveUnit(state: PlayState, id: string, to: readonly [number, number]): PlayState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, at: [to[0], to[1]], moved: true } : u)) };
}

/** Ends the player's turn. Enemy and ally phases come later; for now every unit is ready again. */
export function endTurn(state: PlayState): PlayState {
  return { turn: state.turn + 1, units: state.units.map((u) => ({ ...u, moved: false })) };
}
