import { describe, expect, it } from 'vitest';
import { attackSpeed, forecast, randomNumbers, resolveBattle, rollHit, statsAtLevel, triangle, type Combatant, type Stats, type Weapon } from './combat';

const stats = (s: Partial<Stats>): Stats => ({ hp: 20, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 4, con: 7, ...s });
const weapon = (w: Partial<Weapon>): Weapon => ({ name: 'w', kind: 'sword', magic: false, might: 5, hit: 90, crit: 0, weight: 5, minRange: 1, maxRange: 1, ...w });
const plain = { avoid: 0, def: 0, res: 0 };
const unit = (s: Partial<Stats>, w: Partial<Weapon> | null, terrain = plain): Combatant => ({ stats: stats(s), hp: s.hp ?? 20, weapon: w ? weapon(w) : null, terrain });

describe('statsAtLevel', () => {
  it('adds average growth for each level above 1, rounded down', () => {
    const base = stats({ hp: 18, str: 4, lck: 0, con: 6 });
    const growths = stats({ hp: 80, str: 45, skl: 0, spd: 0, def: 0, res: 0, lck: 30, con: 0 });
    expect(statsAtLevel(base, growths, 1)).toEqual(base);
    // Level 5: four level-ups. HP 18 + 3.2 -> 21, Str 4 + 1.8 -> 5, Lck 0 + 1.2 -> 1.
    expect(statsAtLevel(base, growths, 5)).toMatchObject({ hp: 21, str: 5, lck: 1, con: 6 });
  });
});

describe('forecast', () => {
  it('works out damage, hit and crit', () => {
    // Attacker: Str 6, Skl 8, Lck 4, Iron Sword (Mt 5, Hit 90, Crit 0). Defender: Def 4, Spd 5, Lck 2, on 10-avoid terrain.
    const a = unit({ str: 6, skl: 8, lck: 4, spd: 7 }, { might: 5, hit: 90, crit: 0, weight: 5 });
    const d = unit({ def: 4, spd: 5, lck: 2 }, null, { avoid: 10, def: 1, res: 0 });
    const f = forecast(a, d, 1).attacker;
    expect(f.damage).toBe(6 + 5 - (4 + 1));
    expect(f.hit).toBe(90 + 16 + 2 - (5 * 2 + 2 + 10));
    expect(f.crit).toBe(0 + 4 - 2);
    expect(forecast(a, d, 1).defender.canAttack).toBe(false);
  });

  it('applies the weapon triangle', () => {
    expect(triangle(weapon({ kind: 'sword' }), weapon({ kind: 'axe' }))).toBe(1);
    expect(triangle(weapon({ kind: 'sword' }), weapon({ kind: 'lance' }))).toBe(-1);
    expect(triangle(weapon({ kind: 'anima' }), weapon({ kind: 'light' }))).toBe(1);
    expect(triangle(weapon({ kind: 'bow' }), weapon({ kind: 'axe' }))).toBe(0);
    // Hit 60 keeps the numbers under the 100 cap.
    const sword = unit({}, { kind: 'sword', hit: 60 });
    const axe = unit({}, { kind: 'axe' });
    const even = forecast(sword, unit({}, { kind: 'bow', minRange: 1 }), 1).attacker;
    const ahead = forecast(sword, axe, 1).attacker;
    expect(ahead.damage - even.damage).toBe(1);
    expect(ahead.hit - even.hit).toBe(15);
  });

  it('uses Res against magic', () => {
    const f = forecast(unit({ str: 5 }, { kind: 'anima', magic: true, might: 5 }), unit({ def: 9, res: 2 }, null), 1);
    expect(f.attacker.damage).toBe(8);
  });

  it('slows units whose weapon is heavier than their Con, and doubles at 4 or more', () => {
    const heavy = unit({ spd: 10, con: 5 }, { weight: 9 });
    expect(attackSpeed(heavy)).toBe(6);
    const target = unit({ spd: 2 }, null);
    expect(forecast(heavy, target, 1).attacker.doubles).toBe(true);
    expect(forecast(unit({ spd: 5 }, {}), unit({ spd: 2 }, null), 1).attacker.doubles).toBe(false);
  });

  it('only counters within the weapon range', () => {
    const bow = unit({}, { kind: 'bow', minRange: 2, maxRange: 2 });
    const sword = unit({}, { kind: 'sword' });
    expect(forecast(bow, sword, 2).defender.canAttack).toBe(false);
    expect(forecast(sword, bow, 1).defender.canAttack).toBe(false);
  });
});

describe('resolveBattle', () => {
  const seq = (...ns: number[]) => {
    let i = 0;
    return () => ns[i++ % ns.length]!;
  };

  it('rolls true hit from two averaged numbers', () => {
    expect(rollHit(50, seq(40, 59))).toBe(true); // average 49.5 -> 49
    expect(rollHit(50, seq(40, 60))).toBe(false); // average 50
  });

  it('strikes attacker, counter, then the double, and triples crits', () => {
    const a = unit({ hp: 20, str: 10, spd: 10, skl: 0, lck: 0 }, { might: 0, hit: 100, crit: 100 });
    const d = unit({ hp: 40, str: 5, spd: 2, def: 0, skl: 0, lck: 0 }, { might: 0, hit: 100, crit: 0 });
    const f = forecast(a, d, 1);
    const strikes = resolveBattle(a, d, f, seq(0));
    expect(strikes.map((s) => [s.by, s.hit, s.crit, s.damage, s.attackerHp, s.defenderHp])).toEqual([
      ['attacker', true, true, 30, 20, 10],
      ['defender', true, false, 2, 18, 10],
      ['attacker', true, true, 30, 18, 0],
    ]);
  });

  it('stops when a unit falls and skips sides that cannot attack', () => {
    const a = unit({ hp: 20, str: 30 }, { hit: 100 });
    const d = unit({ hp: 10, def: 0 }, null);
    const strikes = resolveBattle(a, d, forecast(a, d, 1), seq(0, 0, 99));
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({ by: 'attacker', defenderHp: 0 });
  });

  it('gives a repeatable stream of 0 to 99 for a seed', () => {
    const a = randomNumbers(42);
    const b = randomNumbers(42);
    const xs = Array.from({ length: 200 }, () => a());
    expect(xs).toEqual(Array.from({ length: 200 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(99);
  });
});
