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
 * After a fight that gave experience: the experience bar opens, fills a point a game frame, holds and
 * closes, and then, if the unit went up a level, the level-up window shows. In frames, as FE8's
 * ProcScr_MapAnimExpBar runs: a frame's wait, 7 frames opening, 20 still and 2 more, then a point a
 * frame; 20 still after the last; closed, 8 more before the level-up. Times in ms.
 */
const FRAME_MS = 1000 / 60;
export const EXP_MS_PER_POINT = FRAME_MS;
/** The first point is added on frame 30. */
const EXP_IN_MS = 29 * FRAME_MS;
const EXP_HOLD_MS = 21 * FRAME_MS;
const EXP_GAP_MS = 8 * FRAME_MS;

/**
 * FE8's map level-up (ProcScr_ManimLevelUp), in frames: "LEVEL UP" over the unit (frames 2 to 71);
 * the box scrolling up from the bottom 8 pixels a frame (from frame 74, at y 144, until y 48); after 30
 * still frames a label for each of `labels` gains, 21 frames apart, the level's first; 60 frames
 * after the last, the labels go and the box scrolls back down; 4 more frames and it's over.
 */
const LABELS_FROM = 116;
const LABEL_EVERY = 21;
const labelsEnd = (labels: number) => LABELS_FROM + LABEL_EVERY * labels + 60;
export function levelUpFrames(labels: number): number {
  return labelsEnd(labels) + 16;
}

export interface LevelUpFrame {
  /** "LEVEL UP" over the unit, the box, or nothing. */
  readonly stage: 'text' | 'box' | null;
  /** Where the box's top is on the screen. */
  readonly top: number;
  /** How many gain labels show (the stats are written with their gains from then on). */
  readonly labels: number;
}

/** The level-up `frame` frames in, with `labels` gains to show. */
export function levelUpAt(frame: number, labels: number): LevelUpFrame {
  const f = Math.floor(frame);
  if (f >= 2 && f < 72) return { stage: 'text', top: 144, labels: 0 };
  const end = labelsEnd(labels);
  // The scroll down ends on the 12th frame after, when the box is cleared.
  if (f < 74 || f >= end + 12) return { stage: null, top: 144, labels: 0 };
  const top = f <= 86 ? 144 - 8 * (f - 74) : f <= end ? 48 : 48 + 8 * (f - end);
  const shown = f >= end ? 0 : Math.max(0, Math.min(labels, Math.floor((f - LABELS_FROM) / LABEL_EVERY) + 1));
  return { stage: 'box', top, labels: shown };
}

export interface ExpFrame {
  /** The bar shows, then nothing for a moment, then the level-up window if any. */
  readonly phase: 'bar' | 'gap' | 'levelUp';
  /** The bar's experience, 0 to 99 as it fills, starting again from 0 past a level. */
  readonly exp: number;
  /** Frames since the display began, for the bar's opening; for the level-up, since it began. */
  readonly frame: number;
}

/** When the bar phase ends. */
export function expBarEnd(gain: number): number {
  return EXP_IN_MS + gain * EXP_MS_PER_POINT + EXP_HOLD_MS;
}

/** When the level-up window shows. */
export function levelUpStart(gain: number): number {
  return expBarEnd(gain) + EXP_GAP_MS;
}

/**
 * What shows `ms` into the experience display for a gain of `gain` from `exp`, or null once it's over.
 * `levelUpLabels` is the number of gain labels the level-up shows (0 without a level-up).
 */
export function expFrame(exp: number, gain: number, levelUpLabels: number, ms: number): ExpFrame | null {
  const t = Math.max(0, ms);
  const frame = Math.floor(t / FRAME_MS);
  const after = (exp + gain) % 100;
  if (t < expBarEnd(gain)) {
    const filled = Math.min(gain, Math.max(0, Math.floor((t - EXP_IN_MS) / EXP_MS_PER_POINT)));
    return { phase: 'bar', exp: (exp + filled) % 100, frame };
  }
  const up = levelUpStart(gain);
  if (t < up) return { phase: 'gap', exp: after, frame };
  if (levelUpLabels && t < up + levelUpFrames(levelUpLabels) * FRAME_MS) return { phase: 'levelUp', exp: after, frame: Math.floor((t - up) / FRAME_MS) };
  return null;
}
