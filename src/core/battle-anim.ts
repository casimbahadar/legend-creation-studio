// Timing for a battle shown on the map, FE's "animations off" style: for each blow the striker lunges
// toward its target and back, the blow lands at the furthest point, and its result shows until the next.

import type { Strike } from './combat';

/** One blow: lunge out, land, come back, then a pause showing the result. */
export const STRIKE_MS = 650;
const LUNGE_MS = 120;
/** A pause after the last blow before the battle closes. */
export const END_PAUSE_MS = 400;

export interface BattleFrame {
  /** Which blow is playing, or -1 once all have played. */
  readonly index: number;
  /** How far the striker has lunged toward its target, 0 to 1. */
  readonly lunge: number;
  /** The blow whose result is showing, if any. */
  readonly landed: Strike | null;
  readonly attackerHp: number;
  readonly defenderHp: number;
  readonly done: boolean;
}

export function battleFrame(strikes: readonly Strike[], start: { attackerHp: number; defenderHp: number }, ms: number): BattleFrame {
  const t = Math.max(0, ms);
  const i = Math.floor(t / STRIKE_MS);
  if (i >= strikes.length) {
    const last = strikes[strikes.length - 1];
    return {
      index: -1,
      lunge: 0,
      landed: last ?? null,
      attackerHp: last?.attackerHp ?? start.attackerHp,
      defenderHp: last?.defenderHp ?? start.defenderHp,
      done: t >= strikes.length * STRIKE_MS + END_PAUSE_MS,
    };
  }
  const local = t - i * STRIKE_MS;
  const strike = strikes[i]!;
  const before = i > 0 ? strikes[i - 1]! : null;
  const landed = local >= LUNGE_MS;
  const lunge = local < LUNGE_MS ? local / LUNGE_MS : local < 2 * LUNGE_MS ? 1 - (local - LUNGE_MS) / LUNGE_MS : 0;
  const hp = landed ? strike : (before ?? { attackerHp: start.attackerHp, defenderHp: start.defenderHp });
  return { index: i, lunge, landed: landed ? strike : before, attackerHp: hp.attackerHp, defenderHp: hp.defenderHp, done: false };
}

/**
 * After a fight that gave experience: the experience window fills its bar a point a game frame, as
 * FE8's does, holds, and then, if the unit went up a level, the level-up window shows. Times in ms.
 */
export const EXP_MS_PER_POINT = 1000 / 60;
const EXP_IN_MS = 250;
const EXP_HOLD_MS = 450;
export const LEVEL_UP_MS = 2600;

export interface ExpFrame {
  readonly phase: 'bar' | 'levelUp';
  /** The bar's experience, 0 to 99 as it fills, starting again from 0 past a level. */
  readonly exp: number;
}

/** When the bar phase ends. */
export function expBarEnd(gain: number): number {
  return EXP_IN_MS + gain * EXP_MS_PER_POINT + EXP_HOLD_MS;
}

/** What shows `ms` into the experience display for a gain of `gain` from `exp`, or null once it's over. */
export function expFrame(exp: number, gain: number, levelUp: boolean, ms: number): ExpFrame | null {
  const t = Math.max(0, ms);
  const barEnd = expBarEnd(gain);
  if (t < barEnd) {
    const filled = Math.min(gain, Math.max(0, Math.floor((t - EXP_IN_MS) / EXP_MS_PER_POINT)));
    const total = exp + filled;
    return { phase: 'bar', exp: total % 100 };
  }
  if (levelUp && t < barEnd + LEVEL_UP_MS) return { phase: 'levelUp', exp: (exp + gain) % 100 };
  return null;
}
