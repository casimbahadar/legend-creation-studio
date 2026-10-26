import { describe, expect, it } from 'vitest';
import { battleFrame, END_PAUSE_MS, EXP_MS_PER_POINT, expBarEnd, expFrame, levelUpAt, levelUpFrames, levelUpStart, STRIKE_MS } from './battle-anim';
import type { Strike } from './combat';

const strikes: Strike[] = [
  { by: 'attacker', hit: true, crit: false, damage: 6, attackerHp: 20, defenderHp: 14, used: true },
  { by: 'defender', hit: false, crit: false, damage: 0, attackerHp: 20, defenderHp: 14, used: false },
];
const start = { attackerHp: 20, defenderHp: 20 };

describe('battleFrame', () => {
  it('lunges out and back, landing the blow at the furthest point', () => {
    expect(battleFrame(strikes, start, 0)).toMatchObject({ index: 0, lunge: 0, landed: null, defenderHp: 20 });
    expect(battleFrame(strikes, start, 60)).toMatchObject({ lunge: 0.5, defenderHp: 20 });
    expect(battleFrame(strikes, start, 120)).toMatchObject({ lunge: 1, landed: strikes[0], defenderHp: 14 });
    expect(battleFrame(strikes, start, 300)).toMatchObject({ lunge: 0, landed: strikes[0] });
  });

  it('keeps the last result showing until the next blow lands', () => {
    expect(battleFrame(strikes, start, STRIKE_MS + 10)).toMatchObject({ index: 1, landed: strikes[0] });
    expect(battleFrame(strikes, start, STRIKE_MS + 130)).toMatchObject({ index: 1, landed: strikes[1] });
  });

  it('finishes after the last blow and a pause', () => {
    const end = 2 * STRIKE_MS;
    expect(battleFrame(strikes, start, end)).toMatchObject({ index: -1, done: false, defenderHp: 14 });
    expect(battleFrame(strikes, start, end + END_PAUSE_MS).done).toBe(true);
    expect(battleFrame([], start, END_PAUSE_MS)).toMatchObject({ done: true, attackerHp: 20, defenderHp: 20 });
  });
});

describe('expFrame', () => {
  const at = (frames: number) => frames * EXP_MS_PER_POINT + 0.5;
  it('fills the bar a point a frame from frame 30, past 100 starting again, then shows the level-up', () => {
    expect(expFrame(90, 30, 3, 0)).toEqual({ phase: 'bar', exp: 90, frame: 0 });
    expect(expFrame(90, 30, 3, at(29))).toMatchObject({ phase: 'bar', exp: 90 });
    expect(expFrame(90, 30, 3, at(30))).toMatchObject({ phase: 'bar', exp: 91 });
    expect(expFrame(90, 30, 3, at(40))).toMatchObject({ phase: 'bar', exp: 1 });
    expect(expFrame(90, 30, 3, expBarEnd(30) - 1)).toMatchObject({ phase: 'bar', exp: 20 });
    expect(expFrame(90, 30, 3, expBarEnd(30))).toMatchObject({ phase: 'gap', exp: 20 });
    expect(expFrame(90, 30, 3, levelUpStart(30))).toMatchObject({ phase: 'levelUp', exp: 20 });
    expect(expFrame(90, 30, 3, levelUpStart(30) + 10 * EXP_MS_PER_POINT + 1)).toMatchObject({ phase: 'levelUp', frame: 10 });
    expect(expFrame(90, 30, 3, levelUpStart(30) + levelUpFrames(3) * EXP_MS_PER_POINT)).toBeNull();
  });

  it('ends after the bar without a level-up', () => {
    expect(expFrame(10, 20, 0, expBarEnd(20) - 1)).toMatchObject({ phase: 'bar', exp: 30 });
    expect(expFrame(10, 20, 0, levelUpStart(20))).toBeNull();
  });
});

describe('levelUpAt', () => {
  it('shows LEVEL UP, scrolls the box in, adds a label every 21 frames and scrolls it out', () => {
    expect(levelUpAt(0, 3).stage).toBeNull();
    expect(levelUpAt(2, 3).stage).toBe('text');
    expect(levelUpAt(71, 3).stage).toBe('text');
    expect(levelUpAt(72, 3).stage).toBeNull();
    expect(levelUpAt(74, 3)).toEqual({ stage: 'box', top: 144, labels: 0 });
    expect(levelUpAt(80, 3).top).toBe(96);
    expect(levelUpAt(86, 3).top).toBe(48);
    expect(levelUpAt(115, 3).labels).toBe(0);
    expect(levelUpAt(116, 3).labels).toBe(1);
    expect(levelUpAt(137, 3).labels).toBe(2);
    expect(levelUpAt(158, 3)).toEqual({ stage: 'box', top: 48, labels: 3 });
    // 60 frames after the last label's 21: the labels go and the box goes back down.
    expect(levelUpAt(239, 3)).toEqual({ stage: 'box', top: 48, labels: 0 });
    expect(levelUpAt(240, 3).top).toBe(56);
    expect(levelUpAt(250, 3).top).toBe(136);
    expect(levelUpAt(251, 3).stage).toBeNull();
    expect(levelUpFrames(3)).toBe(255);
  });
});

