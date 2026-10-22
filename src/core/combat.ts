// Combat: stats at a level, the battle forecast and the blows of one fight.
// Formulas follow Endless Chronicle's (index.html, its forecast function) with its own additions
// left out, plus FE8's weight rule, which EC skips: weapon weight above Con slows the unit.
// Not yet: brave weapons, effective damage, reaver weapons, class crit bonuses, weapon uses, experience.

export interface Stats {
  readonly hp: number;
  readonly str: number;
  readonly skl: number;
  readonly spd: number;
  readonly def: number;
  readonly res: number;
  readonly lck: number;
  readonly con: number;
}

/** Stats at `level` with average growth: each growth adds growth × (level − 1) ÷ 100, rounded down. */
export function statsAtLevel(base: Stats, growths: Stats, level: number): Stats {
  const up = (k: keyof Stats) => base[k] + Math.floor((growths[k] * Math.max(0, level - 1)) / 100);
  return { hp: up('hp'), str: up('str'), skl: up('skl'), spd: up('spd'), def: up('def'), res: up('res'), lck: up('lck'), con: base.con };
}

/**
 * An FE8 character's stats at a level (decision 29): the class's bases plus the character's own,
 * raised by the character's growths for each level above its base level, as FE8 levels a player unit.
 */
export function characterStatsAtLevel(classBase: Stats, personalBase: Stats, growths: Stats, baseLevel: number, level: number): Stats {
  const base: Stats = {
    hp: classBase.hp + personalBase.hp,
    str: classBase.str + personalBase.str,
    skl: classBase.skl + personalBase.skl,
    spd: classBase.spd + personalBase.spd,
    def: classBase.def + personalBase.def,
    res: classBase.res + personalBase.res,
    lck: classBase.lck + personalBase.lck,
    con: classBase.con + personalBase.con,
  };
  return statsAtLevel(base, growths, level - Math.max(1, baseLevel) + 1);
}

/** Stats with a unit's own adjustments added (decision 25); HP stays at least 1 and the rest at least 0. */
export function withBonus(stats: Stats, bonus: Partial<Stats> | undefined): Stats {
  if (!bonus) return stats;
  const add = (k: keyof Stats, min: number) => Math.max(min, stats[k] + (bonus[k] ?? 0));
  return { hp: add('hp', 1), str: add('str', 0), skl: add('skl', 0), spd: add('spd', 0), def: add('def', 0), res: add('res', 0), lck: add('lck', 0), con: add('con', 0) };
}

export type WeaponKind = 'sword' | 'lance' | 'axe' | 'bow' | 'staff' | 'anima' | 'light' | 'dark' | 'other';

export interface Weapon {
  readonly name: string;
  readonly kind: WeaponKind;
  /** Targets Res instead of Def. */
  readonly magic: boolean;
  readonly might: number;
  readonly hit: number;
  readonly crit: number;
  readonly weight: number;
  readonly minRange: number;
  readonly maxRange: number;
}

export interface Combatant {
  readonly stats: Stats;
  readonly hp: number;
  /** The weapon used in this fight, or null if the unit can't fight back. */
  readonly weapon: Weapon | null;
  /** Bonuses from the terrain the unit stands on. */
  readonly terrain: { readonly avoid: number; readonly def: number; readonly res: number };
}

export interface SideForecast {
  readonly canAttack: boolean;
  readonly damage: number;
  readonly hit: number;
  readonly crit: number;
  readonly doubles: boolean;
  readonly attackSpeed: number;
}

export interface Forecast {
  readonly attacker: SideForecast;
  readonly defender: SideForecast;
}

const BEATS: Partial<Record<WeaponKind, WeaponKind>> = { sword: 'axe', axe: 'lance', lance: 'sword', anima: 'light', light: 'dark', dark: 'anima' };

/** +1 if `a` has the weapon triangle advantage over `b`, -1 if disadvantage, 0 otherwise. */
export function triangle(a: Weapon | null, b: Weapon | null): -1 | 0 | 1 {
  if (!a || !b) return 0;
  if (BEATS[a.kind] === b.kind) return 1;
  if (BEATS[b.kind] === a.kind) return -1;
  return 0;
}

export function attackSpeed(c: Combatant): number {
  return c.stats.spd - Math.max(0, (c.weapon?.weight ?? 0) - c.stats.con);
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

function side(x: Combatant, y: Combatant, distance: number): SideForecast {
  const w = x.weapon;
  const canAttack = !!w && w.kind !== 'staff' && distance >= w.minRange && distance <= w.maxRange;
  const tri = triangle(w, y.weapon);
  const as = attackSpeed(x);
  if (!w) return { canAttack: false, damage: 0, hit: 0, crit: 0, doubles: false, attackSpeed: as };
  const protection = w.magic ? y.stats.res + y.terrain.res : y.stats.def + y.terrain.def;
  return {
    canAttack,
    damage: Math.max(0, x.stats.str + w.might + tri - protection),
    hit: clamp100(w.hit + x.stats.skl * 2 + Math.floor(x.stats.lck / 2) + tri * 15 - (attackSpeed(y) * 2 + y.stats.lck + y.terrain.avoid)),
    crit: clamp100(w.crit + Math.floor(x.stats.skl / 2) - y.stats.lck),
    doubles: as - attackSpeed(y) >= 4,
    attackSpeed: as,
  };
}

/** What the battle forecast shows: each side's damage, hit, crit and whether it strikes twice. */
export function forecast(attacker: Combatant, defender: Combatant, distance: number): Forecast {
  return { attacker: side(attacker, defender, distance), defender: side(defender, attacker, distance) };
}

export interface Strike {
  readonly by: 'attacker' | 'defender';
  readonly hit: boolean;
  readonly crit: boolean;
  readonly damage: number;
  /** HP of both after this blow. */
  readonly attackerHp: number;
  readonly defenderHp: number;
}

/** FE8's "true hit": two random numbers 0 to 99, averaged; the blow lands if that is below the hit chance. */
export function rollHit(hit: number, rn: () => number): boolean {
  return Math.floor((rn() + rn()) / 2) < hit;
}

/**
 * The blows of one fight, in FE's order: attacker, defender's counter, then a second blow from whoever
 * doubles. Stops when a unit falls. `rn` returns a random whole number from 0 to 99.
 */
export function resolveBattle(attacker: Combatant, defender: Combatant, f: Forecast, rn: () => number): Strike[] {
  const strikes: Strike[] = [];
  let hpA = attacker.hp;
  let hpD = defender.hp;
  const order: ('attacker' | 'defender')[] = ['attacker', 'defender'];
  if (f.attacker.doubles) order.push('attacker');
  else if (f.defender.doubles) order.push('defender');
  for (const by of order) {
    if (hpA <= 0 || hpD <= 0) break;
    const s = by === 'attacker' ? f.attacker : f.defender;
    if (!s.canAttack) continue;
    const hit = rollHit(s.hit, rn);
    const crit = hit && rn() < s.crit;
    const damage = hit ? s.damage * (crit ? 3 : 1) : 0;
    if (by === 'attacker') hpD = Math.max(0, hpD - damage);
    else hpA = Math.max(0, hpA - damage);
    strikes.push({ by, hit, crit, damage, attackerHp: hpA, defenderHp: hpD });
  }
  return strikes;
}

/** A seedable random number generator returning whole numbers 0 to 99 (mulberry32). */
export function randomNumbers(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * 100);
  };
}
