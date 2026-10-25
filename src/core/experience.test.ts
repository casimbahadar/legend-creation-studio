import { describe, expect, it } from 'vitest';
import type { Stats } from './combat';
import { addExp, expGain, killExp, powerLevel, rollLevelUp, roundExp, startingExp, type ExpProfile } from './experience';

const unit = (level: number, more: Partial<ExpProfile> = {}): ExpProfile => ({ level, promoted: false, power: 3, promotionPower: 0, boss: false, thief: false, ...more });
const stats = (v: number): Stats => ({ hp: v, str: v, skl: v, spd: v, def: v, res: v, lck: v, con: v });
/** Random numbers from a list, then 99s. */
const numbers = (...list: number[]) => () => list.shift() ?? 99;

describe('experience', () => {
  it('gives a round 31 less the level gap, divided by the class power', () => {
    expect(roundExp(unit(1), unit(1))).toBe(10);
    expect(roundExp(unit(5), unit(1))).toBe(9); // (31 - 4) / 3
    expect(roundExp(unit(1), unit(3, { promoted: true }))).toBe(17); // 31 + 22 = 53, / 3
    expect(roundExp(unit(20, { promoted: true }), unit(1))).toBe(0);
  });

  it('adds a kill bonus by power level, halving the killer\'s against a weaker target', () => {
    expect(powerLevel(unit(4))).toBe(12);
    expect(powerLevel(unit(2, { promoted: true, power: 4, promotionPower: 3 }))).toBe(8 + 60);
    expect(killExp(unit(1), unit(2))).toBe(20 + 6 - 3);
    expect(killExp(unit(5), unit(1))).toBe(20 + 3 - 7);
    expect(killExp(unit(1), unit(1, { boss: true }))).toBe(20 + 3 - 1 + 40);
    expect(killExp(unit(1), unit(1, { thief: true }))).toBe(20 + 3 - 1 + 20);
    expect(killExp(unit(20, { promoted: true, power: 5, promotionPower: 3 }), unit(1))).toBe(0);
  });

  it('gives 1 for no damage, nothing to a unit that fell, and 1 to 100 otherwise', () => {
    expect(expGain(unit(1), unit(1), false, false, false)).toBe(1);
    expect(expGain(unit(1), unit(1), true, true, false)).toBe(0);
    expect(expGain(unit(1), unit(2), true, false, true)).toBe(10 + 23);
    expect(expGain(unit(1), unit(10, { boss: true, power: 5 }), true, false, true)).toBe(100);
    expect(expGain(unit(20, { promoted: true }), unit(1), true, false, false)).toBe(1);
  });

  it('rolls each stat against its growth, a full 100 always counting', () => {
    const growths = { ...stats(50), hp: 150, str: 0 };
    // hp: 150 = 1 sure + 50% (rolls 10: yes); str 0: no; the rest roll 60 against 50: no, but lck rolls 0.
    const gains = rollLevelUp(stats(5), growths, stats(20), numbers(10, 0, 60, 60, 60, 60, 0));
    expect(gains).toEqual({ hp: 2, str: 0, skl: 0, spd: 0, def: 0, res: 0, lck: 1 });
  });

  it('rolls twice more through the stats when nothing rose, stopping at the first that does', () => {
    const gains = rollLevelUp(stats(5), stats(50), stats(20), numbers(...Array(7).fill(99), 99, 99, 10, 0));
    expect(gains).toEqual({ hp: 0, str: 0, skl: 1, spd: 0, def: 0, res: 0, lck: 0 });
  });

  it('keeps stats at their caps', () => {
    const gains = rollLevelUp({ ...stats(20), hp: 60, lck: 30 }, stats(100), { ...stats(20), skl: 25 }, numbers());
    expect(gains).toEqual({ hp: 0, str: 0, skl: 1, spd: 0, def: 0, res: 0, lck: 0 });
  });

  it('goes up a level at 100 and stops at the last level', () => {
    const up = { hp: 1, str: 0, skl: 0, spd: 0, def: 0, res: 0, lck: 0 };
    expect(addExp(3, 50, 30, 20, () => up)).toEqual({ gain: 30, exp: 80, level: 3, levelUp: null });
    expect(addExp(3, 90, 30, 20, () => up)).toEqual({ gain: 30, exp: 20, level: 4, levelUp: up });
    expect(addExp(19, 90, 30, 20, () => up)).toEqual({ gain: 10, exp: null, level: 20, levelUp: up });
    expect(addExp(20, null, 30, 20, () => up)).toEqual({ gain: 0, exp: null, level: 20, levelUp: null });
    expect(startingExp(20, 20)).toBeNull();
    expect(startingExp(10, 10)).toBeNull();
    expect(startingExp(9, 10)).toBe(0);
    expect(startingExp(1, 20)).toBe(0);
  });
});
