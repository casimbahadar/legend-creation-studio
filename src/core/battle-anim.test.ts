import { describe, expect, it } from 'vitest';
import { battleFrame, END_PAUSE_MS, EXP_MS_PER_POINT, expBarEnd, expFrame, LEVEL_UP_MS, levelUpStart, STRIKE_MS } from './battle-anim';
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
    expect(expFrame(90, 30, true, 0)).toEqual({ phase: 'bar', exp: 90, frame: 0 });
    expect(expFrame(90, 30, true, at(29))).toMatchObject({ phase: 'bar', exp: 90 });
    expect(expFrame(90, 30, true, at(30))).toMatchObject({ phase: 'bar', exp: 91 });
    expect(expFrame(90, 30, true, at(40))).toMatchObject({ phase: 'bar', exp: 1 });
    expect(expFrame(90, 30, true, expBarEnd(30) - 1)).toMatchObject({ phase: 'bar', exp: 20 });
    expect(expFrame(90, 30, true, expBarEnd(30))).toMatchObject({ phase: 'gap', exp: 20 });
    expect(expFrame(90, 30, true, levelUpStart(30))).toMatchObject({ phase: 'levelUp', exp: 20 });
    expect(expFrame(90, 30, true, levelUpStart(30) + LEVEL_UP_MS)).toBeNull();
  });

  it('ends after the bar without a level-up', () => {
    expect(expFrame(10, 20, false, expBarEnd(20) - 1)).toMatchObject({ phase: 'bar', exp: 30 });
    expect(expFrame(10, 20, false, levelUpStart(20))).toBeNull();
  });
});
