// Experience and level-ups in play, by FE8's rules (fireemblem8u decompilation, src/bmbattle.c:
// GetBattleUnitExpGain, GetUnitRoundExp, GetUnitKillExpBonus, CheckBattleUnitLevelUp, GetStatIncrease,
// CheckBattleUnitStatCaps). Only player units gain experience; at 100 a unit goes up a level, each stat
// rising by its growth rate's chance, and at the class's last level experience stops.
// Not yet: the Assassin's doubled experience for a Silencer kill, monsters' special cases.

import { hpCapFor, LUCK_CAP, type Stats } from './combat';

/** What decides a unit's experience: its level and class, from the ROM. */
export interface ExpProfile {
  readonly level: number;
  /** Promoted classes count 20 levels higher. */
  readonly promoted: boolean;
  /** The class's relative power (classRelativePower). */
  readonly power: number;
  /** A promoted class's power for its first 20 levels: its `promotion` class's power, or 0 if it has none. */
  readonly promotionPower: number;
  /** Bosses give 40 more for a kill, thieves 20. */
  readonly boss: boolean;
  readonly thief: boolean;
}

const expLevel = (u: ExpProfile) => u.level + (u.promoted ? 20 : 0);

/** GetUnitPowerLevel. */
export function powerLevel(u: ExpProfile): number {
  return u.level * u.power + (u.promoted && u.promotionPower ? 20 * u.promotionPower : 0);
}

/** GetUnitRoundExp: experience for a fight that did damage, before any kill bonus. */
export function roundExp(actor: ExpProfile, target: ExpProfile): number {
  return Math.trunc(Math.max(0, 31 - (expLevel(actor) - expLevel(target))) / Math.max(1, actor.power));
}

/**
 * GetUnitKillExpBonus for the chapters before the routes split (chapter mode 1, where the patch puts
 * the chapter): 20, plus the target's power level less the actor's (only half the actor's when the
 * target is no stronger), plus the boss and thief bonuses; never below 0.
 */
export function killExp(actor: ExpProfile, target: ExpProfile): number {
  const t = powerLevel(target);
  const a = powerLevel(actor);
  const bonus = 20 + (t <= a ? t - Math.trunc(a / 2) : t - a) + (target.thief ? 20 : 0) + (target.boss ? 40 : 0);
  return Math.max(0, bonus);
}

/**
 * GetBattleUnitExpGain: 1 if the actor's blows did no damage, otherwise the round's experience plus
 * the kill bonus if the target fell, from 1 to 100. A unit that fell gains nothing.
 */
export function expGain(actor: ExpProfile, target: ExpProfile, dealtDamage: boolean, actorFell: boolean, targetFell: boolean): number {
  if (actorFell) return 0;
  if (!dealtDamage) return 1;
  const exp = roundExp(actor, target) + (targetFell ? killExp(actor, target) : 0);
  return Math.max(1, Math.min(100, exp));
}

export type StatGains = Omit<Stats, 'con'>;

const GROWN = ['hp', 'str', 'skl', 'spd', 'def', 'res', 'lck'] as const;
/** HP can't pass 60 for player units (hpCapFor); luck can't pass 30 for anyone. */
const PLAYER_HP_CAP = hpCapFor('player');

/** GetStatIncrease: 1 for each full 100 of growth, and the rest as a percent chance. `rn` gives 0 to 99. */
function statIncrease(growth: number, rn: () => number): number {
  let up = 0;
  let g = growth;
  while (g > 100) {
    up++;
    g -= 100;
  }
  return up + (rn() < g ? 1 : 0);
}

/**
 * A level-up's stat gains, rolled as CheckBattleUnitLevelUp rolls them: every stat once; if none rose,
 * up to twice more through the stats in order until one does. Then each gain is cut so the stat
 * stays at or under its cap (`caps` holds the class's maximums; HP and luck use the fixed caps).
 */
export function rollLevelUp(stats: Stats, growths: Stats, caps: Stats, rn: () => number): StatGains {
  const gains: Record<(typeof GROWN)[number], number> = { hp: 0, str: 0, skl: 0, spd: 0, def: 0, res: 0, lck: 0 };
  for (const k of GROWN) gains[k] = statIncrease(growths[k], rn);
  if (GROWN.every((k) => gains[k] === 0)) {
    retry: for (let i = 0; i < 2; i++) {
      for (const k of GROWN) {
        gains[k] = statIncrease(growths[k], rn);
        if (gains[k]) break retry;
      }
    }
  }
  const cap = (k: (typeof GROWN)[number]) => (k === 'hp' ? PLAYER_HP_CAP : k === 'lck' ? LUCK_CAP : caps[k]);
  for (const k of GROWN) if (stats[k] + gains[k] > cap(k)) gains[k] = cap(k) - stats[k];
  return gains;
}

export interface ExpResult {
  /** Experience shown as gained: what was added, less any left over at the last level. */
  readonly gain: number;
  readonly exp: number | null;
  readonly level: number;
  /** Set when the unit went up a level. */
  readonly levelUp: StatGains | null;
}

/**
 * Adds `gain` to a unit's experience (null: it gains none), going up a level at 100 and stopping at
 * `maxLevel`, as CheckBattleUnitLevelUp does. `rollGains` rolls the level-up's stats.
 */
export function addExp(level: number, exp: number | null, gain: number, maxLevel: number, rollGains: () => StatGains): ExpResult {
  if (exp === null || gain <= 0) return { gain: 0, exp, level, levelUp: null };
  const total = exp + gain;
  if (total < 100) return { gain, exp: total, level, levelUp: null };
  const next = level + 1;
  const left = total - 100;
  const atMax = next >= maxLevel;
  return { gain: atMax ? gain - left : gain, exp: atMax ? null : left, level: next, levelUp: rollGains() };
}

/** A unit's experience when play starts: 0, or none for a unit already at its last level. */
export function startingExp(level: number, maxLevel: number): number | null {
  return level >= maxLevel ? null : 0;
}

/** GetBattleUnitStaffExp for a heal: 10 plus the staff's price a use / 20, halved for promoted units, at most 100. */
export function staffExp(promoted: boolean, costPerUse: number): number {
  const exp = 10 + Math.trunc(costPerUse / 20);
  return Math.min(100, promoted ? Math.trunc(exp / 2) : exp);
}
