// What a computer-controlled unit does on its turn: FE8's AI (decision 37), ported from the fireemblem8u
// decompilation (src/cp_*.c) for the AI settings the patch writes for each behaviour (decision 23):
// Charge is AI1 0x00 and AI2 0x00, Attack in range AI1 0x00 and AI2 0x03, Hold AI1 0x03 and AI2 0x03,
// with AI3 and AI4 0 (healing thresholds 0, combat weights 0, no "stay" flag).
//
// Each unit decides in FE8's order (AiDecideMain): heal or retreat (DecideHealOrEscape), then its AI1
// script (the standard action: a staff, else an attack; Hold's only from where it stands), then its AI2
// script (Charge moves toward the nearest enemy; the others don't move). The phase's units act in
// FE8's order (cp_order.c). FE8's quirks are kept, as the patched game has them: the danger map never
// resets its weapon between foes; the combat score's class bonus reads past its table (always 1); one
// friend-zone offset is wrong; only player units count as healers to head for; a thief heading for a heal
// point never attacks on arrival.
// Not yet: special items (keys, torches), staves other than Heal, Mend, Recover, Physic and Fortify.

import { simulateAllHits, type Forecast } from './combat';
import { shortestRoute, type MoveSearch } from './movement';
import { areFoes, UNIT_ITEM_COUNT, type PlayState, type PlayUnit } from './play';

/** A usable weapon or staff in a unit's items. */
export interface AiItem {
  /** Its index in the unit's items. */
  readonly item: number;
  readonly staff: boolean;
  readonly might: number;
  readonly min: number;
  readonly max: number;
}

/**
 * A healing staff: its item, how much it heals, how far it reaches (1, or Physic's and Fortify's range)
 * and its rank. Physic heals one ally in reach, Fortify every hurt one.
 */
export interface AiStaff {
  readonly item: number;
  readonly heal: number;
  readonly physic: boolean;
  readonly fortify?: boolean;
  readonly reach: number;
  readonly rank: number;
}

export interface AiRules {
  readonly width: number;
  readonly height?: number;
  /** Where the unit can go this turn (units block as in FE8); with `mov`, as if it had that much movement. */
  searchOf(unit: PlayUnit, state: PlayState, mov?: number): MoveSearch;
  /** Movement cost from cell `from` to every cell, with the unit's terrain costs and no units in the way, up to 124. */
  costMapFrom(unit: PlayUnit, from: number): ReadonlyMap<number, number>;
  /** The unit's usable weapons and staves, in item order. */
  aiItems(unit: PlayUnit): readonly AiItem[];
  /** The forecast for the unit attacking `target` from `at` with its item `item`. */
  forecastWith(unit: PlayUnit, at: readonly [number, number], item: number, target: PlayUnit, state: PlayState): Forecast;
  /** The unit's class's avoid + defence + resistance bonus on cell `cell`. */
  terrainScore(unit: PlayUnit, cell: number): number;
  /** The terrain id of cell `cell`. */
  terrainAt(cell: number): number;
  /** Whether the unit's class or character is a lord (CA_LORD). */
  isLord(unit: PlayUnit): boolean;
  /** Whether a player unit carries a usable magic weapon (marks it for healers, as FE8 does). */
  carriesMagic?(unit: PlayUnit): boolean;
  /** The unit's healing staves, in item order. */
  healStaves?(unit: PlayUnit): readonly AiStaff[];
  /** The unit's first Vulnerary or Elixir and what it heals, if it has one (AiTryHealSelf). */
  selfHealItem?(unit: PlayUnit): { readonly item: number; readonly heal: number } | null;
  /** Each staff the player can heal with from where the unit stands (the player's Staff menu). */
  staffChoices?(unit: PlayUnit, state: PlayState): StaffChoice[];
  /** Whether the unit's class can steal (CA_STEAL). */
  steals?(unit: PlayUnit): boolean;
  /** Where the unit's item `index` is in FE8's list of items the computer steals (gAiStealPriorityItemList), 0 first; null if not listed. */
  stealRank?(unit: PlayUnit, index: number): number | null;
}

/** A staff the player can heal with: its item index, the allies it reaches and how much it heals; Fortify heals them all. */
export interface StaffChoice {
  readonly item: number;
  readonly targets: readonly string[];
  readonly heal: number;
  readonly fortify?: boolean;
}

/**
 * A heal the computer chose: whom, with which item, for how much. With Fortify, `target` is the healer
 * itself and `fortify` lists the allies it heals.
 */
export interface PlannedHeal {
  readonly target: string;
  readonly item: number;
  readonly heal: number;
  readonly fortify?: readonly string[];
}

export interface Plan {
  /** Cell to move to (its own cell to stay). */
  readonly to: number;
  /** Route there, start first; just the start when staying. */
  readonly route: readonly number[];
  /** Foe to attack from there, if any, with its item `attackItem`. */
  readonly attack: string | null;
  readonly attackItem?: number;
  /** Or an ally to heal from there. */
  readonly heal?: PlannedHeal;
  /** Or a healing item to use on itself there. */
  readonly useItem?: { readonly item: number; readonly heal: number };
  /** Or a foe beside it to steal item `item` from there. */
  readonly steal?: PlannedSteal;
}

/** A steal the computer chose: from whom, and which of their items (its index). */
export interface PlannedSteal {
  readonly target: string;
  readonly item: number;
}

const FORT = 0x0a;
/** Movement maps count cells costing up to this (MAP_MOVEMENT_MAX). */
const MOVEMENT_MAX = 120;

/**
 * Whether a computer-controlled unit is set on healing itself (AiUpdateGetUnitIsHealing with
 * gAI3HealingThresholdTable's first thresholds): it starts under half its HP and keeps on until full.
 */
export function isHealing(unit: PlayUnit): boolean {
  const percent = Math.trunc((unit.hp * 100) / Math.max(1, unit.stats.hp));
  return unit.healing ? percent < 100 : percent < 50;
}

const TEAM_ORDER = { player: 0, ally: 1, enemy: 2 } as const;

/** Units in FE8's unit order: player, then green, then enemy units, each in the order they were placed. */
const inGameOrder = (units: readonly PlayUnit[]) => [...units].sort((a, b) => TEAM_ORDER[a.team] - TEAM_ORDER[b.team]);

/**
 * The order a phase's units act in (BuildAiUnitList, GetUnitAiPriority, SortAiUnitList): by priority,
 * lowest first, ties keeping their order. Priority is the unit's movement, plus, unless it is set on
 * healing: 60 for a unit that can steal; else 87 for a lord; else 72 if it has a usable staff (the
 * first usable item that is one), 40 for a ranged weapon, 20 for only melee ones, 87 with neither.
 */
export function phaseOrder(units: readonly PlayUnit[], state: PlayState, rules: AiRules): string[] {
  const priority = (u: PlayUnit) => {
    const mov = rules.searchOf(u, state).mov;
    if (u.healing) return mov;
    if (rules.steals?.(u)) return mov + 60;
    if (rules.isLord(u)) return mov + 87;
    const items = rules.aiItems(u);
    // GetUnitBattleAiPriority returns 72 at the first usable staff it meets, whatever came before.
    if (items.some((i) => i.staff)) return mov + 72;
    if (items.some((i) => !i.staff && i.max > 1)) return mov + 40;
    if (items.some((i) => !i.staff)) return mov + 20;
    return mov + 87;
  };
  return units
    .map((u, i) => ({ u, i, p: priority(u) }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.u.id);
}

/** What a decision sees: the unit, the map and the other units, and its danger map. */
interface Ctx {
  readonly unit: PlayUnit;
  readonly state: PlayState;
  readonly rules: AiRules;
  readonly w: number;
  readonly h: number;
  readonly at: number;
  readonly occupant: ReadonlyMap<number, PlayUnit>;
  readonly danger: Uint8Array;
  readonly search: MoveSearch;
}

const cellOf = (w: number, u: PlayUnit) => u.at[1] * w + u.at[0];
const xy = (w: number, k: number) => [k % w, Math.floor(k / w)] as const;
const distance = (w: number, a: number, b: number) => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
/** Every cell of the map from the bottom right, as FE8 scans its maps. */
function* scan(w: number, h: number) {
  for (let k = w * h - 1; k >= 0; k--) yield k;
}
const allied = (a: PlayUnit, b: PlayUnit) => !areFoes(a.team, b.team);

/**
 * FE8's danger map for `unit` (AiFillDangerMap): for each foe, in the game's unit order, (power +
 * might) / 2 is added to every square its weapon could reach this turn, wrapping as the game's bytes
 * do. As in the game, the weapon and might are never reset between foes: each foe counts with the
 * strongest weapon seen so far, and only if the two could meet (AiCouldReachByBirdsEyeDistance).
 */
export function dangerMap(unit: PlayUnit, state: PlayState, rules: AiRules, mov: number): Uint8Array {
  const w = rules.width;
  const h = rules.height ?? 0;
  const danger = new Uint8Array(w * h);
  if (!h) return danger;
  let weapon: AiItem | null = null;
  let might = 0;
  for (const foe of inGameOrder(state.units).filter((o) => areFoes(o.team, unit.team))) {
    for (const wpn of rules.aiItems(foe)) {
      if (!wpn.staff && wpn.might > might) {
        weapon = wpn;
        might = wpn.might;
      }
    }
    if (!weapon) continue;
    const search = rules.searchOf(foe, state);
    if (distance(w, cellOf(w, unit), cellOf(w, foe)) > mov + search.mov + weapon.max) continue;
    const inRange = new Uint8Array(w * h);
    for (const k of search.reached.keys()) {
      const [x0, y0] = xy(w, k);
      for (let y = Math.max(0, y0 - weapon.max); y <= Math.min(h - 1, y0 + weapon.max); y++) {
        for (let x = Math.max(0, x0 - weapon.max); x <= Math.min(w - 1, x0 + weapon.max); x++) {
          const d = Math.abs(x - x0) + Math.abs(y - y0);
          if (d >= weapon.min && d <= weapon.max) inRange[y * w + x] = 1;
        }
      }
    }
    const add = (foe.stats.str + might) >> 1;
    for (let k = 0; k < inRange.length; k++) if (inRange[k]) danger[k] = (danger[k]! + add) & 0xff;
  }
  return danger;
}

/**
 * The reachable square FE8 rates safest (AiFindSafestReachableLocation): the least danger, ties going
 * to the topmost, then leftmost square, as the game's scan from the bottom right leaves them.
 */
export function safestStop(stops: Iterable<number>, danger: Uint8Array): number | null {
  let best: number | null = null;
  for (const k of stops) {
    if (best === null || danger[k]! < danger[best]! || (danger[k] === danger[best] && k < best)) best = k;
  }
  return best;
}

/** The 24 squares within 3 of a square, in FE8's order (sRange3OffsetLut). */
const RANGE3: readonly (readonly [number, number])[] = [
  [0, -3], [-1, -2], [0, -2], [1, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
  [-3, 0], [-2, 0], [-1, 0], [1, 0], [2, 0], [3, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-1, 2], [0, 2], [1, 2], [0, 3],
];
/** The combat score's friend zone (sFriendZoneRangeScoreLut): RANGE3 but for (-1, -2), which the game has as (-3, +1). */
const FRIEND_ZONE = RANGE3.map(([x, y]) => (x === -1 && y === -2 ? ([-3, 1] as const) : ([x, y] as const)));

function unitAtOffset(c: Ctx, k: number, dx: number, dy: number): PlayUnit | undefined {
  const [x, y] = xy(c.w, k);
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= c.w || ny >= c.h) return undefined;
  return c.occupant.get(ny * c.w + nx);
}

/** AiGetFriendZoneCombatPositionScoreComponent: +5 for each ally within 3 squares, -5 for each other unit. */
function friendZonePosition(c: Ctx, k: number): number {
  let score = 0;
  for (const [dx, dy] of RANGE3) {
    const o = unitAtOffset(c, k, dx, dy);
    if (o) score += allied(c.unit, o) ? 5 : -5;
  }
  return score;
}

/** Whether a unit may stand on cell `k` (free, or its own). */
const free = (c: Ctx, k: number) => {
  const o = c.occupant.get(k);
  return !o || o.id === c.unit.id;
};

/** The unit's first usable weapon (GetUnitEquippedWeapon). */
const equipped = (rules: AiRules, u: PlayUnit) => rules.aiItems(u).find((i) => !i.staff) ?? null;

/** AiGetCombatPositionScore, comparable between squares (the game adds 0x7FFFFFFF to it). */
function positionScore(c: Ctx, k: number, target: PlayUnit, cost: number): number {
  const weapon = equipped(c.rules, target);
  const d = distance(c.w, k, cellOf(c.w, target));
  const outOfReach = weapon && (d > weapon.max || d < weapon.min) ? 50 : 0;
  return outOfReach + c.rules.terrainScore(c.unit, k) + friendZonePosition(c, k) - cost - Math.floor(c.danger[k]! / 8);
}

/** AiComputeCombatScore with the first coefficient table (gAiCombatScoreCoefficientTable[0]). */
function combatScore(c: Ctx, k: number, f: Forecast, after: { attackerHp: number; defenderHp: number }): number {
  const dealt = after.defenderHp === 0 ? 50 : Math.min(40, 2 * Math.trunc((Math.max(0, f.attacker.damage) * f.attacker.hit) / 100));
  let friends = 0;
  for (const [dx, dy] of FRIEND_ZONE) {
    const o = unitAtOffset(c, k, dx, dy);
    if (o && allied(c.unit, o)) friends += 4 - (Math.abs(dx) + Math.abs(dy));
  }
  const taken = f.defender.canAttack ? Math.min(40, Math.trunc((Math.max(0, f.defender.damage) * f.defender.hit) / 100)) : -10;
  const score =
    dealt +
    Math.max(0, 20 - after.defenderHp) +
    Math.min(10, friends) +
    // AiGetTargetClassCombatScoreComponent: FE8's class rank lists are empty, so the rank is 9, one past
    // the bonus table, which reads the next coefficient table's first byte: 1.
    1 +
    c.state.turn -
    taken -
    Math.min(20, Math.floor(c.danger[k]! / 8)) -
    Math.max(0, 20 - after.attackerHp);
  return score > 0 ? score * 40 : dealt;
}

/** The unit's movement map: every cell it can reach with its cost (allies' too), or its own when it stays. */
function reached(c: Ctx, stay: boolean): ReadonlyMap<number, number> {
  return stay ? new Map([[c.at, 0]]) : c.search.reached;
}

/**
 * AiAttemptOffensiveAction: for each usable weapon, in item order, and each foe in the game's unit
 * order it could reach, the best square to attack it from (AiSimulateBestBattleAgainstTarget: the
 * highest position score, ties to the last in the game's scan), then the fight's score; the highest
 * score wins, ties to the last.
 */
function tryAttack(c: Ctx, stay: boolean): Plan | null {
  const reach = reached(c, stay);
  let best: { score: number; to: number; target: PlayUnit; item: number } | null = null;
  const foes = inGameOrder(c.state.units).filter((o) => areFoes(o.team, c.unit.team));
  for (const weapon of c.rules.aiItems(c.unit)) {
    if (weapon.staff) continue;
    for (const target of foes) {
      const t = cellOf(c.w, target);
      if (distance(c.w, c.at, t) > c.search.mov + weapon.max) continue;
      let to: number | null = null;
      let posBest = -Infinity;
      for (const k of scan(c.w, c.h)) {
        const cost = reach.get(k);
        if (cost === undefined || !free(c, k)) continue;
        const d = distance(c.w, k, t);
        if (d < weapon.min || d > weapon.max) continue;
        const score = positionScore(c, k, target, cost);
        if (score > posBest) {
          posBest = score;
          to = k;
        }
      }
      if (to === null) continue;
      const f = c.rules.forecastWith(c.unit, xy(c.w, to), weapon.item, target, c.state);
      const score = combatScore(c, to, f, simulateAllHits(f, c.unit.hp, target.hp));
      if (!best || score >= best.score) best = { score, to, target, item: weapon.item };
    }
  }
  if (!best) return null;
  return { to: best.to, route: shortestRoute(c.search, best.to) ?? [c.at], attack: best.target.id, attackItem: best.item };
}

/** Whether `target` is one a healer of the unit's side tends to (AI_UNIT_FLAG_0). */
function wantsHealing(c: Ctx, target: PlayUnit): boolean {
  if (target.team === 'player' && c.unit.team !== 'player') return c.rules.carriesMagic?.(target) ?? false;
  return !!target.healing;
}

/** Whether cell `k` is beside a reached cell (MarkMovementMapEdges marks such cells as reachable for targeting). */
function besideReached(c: Ctx, k: number, reach: ReadonlyMap<number, number>): boolean {
  const [x, y] = xy(c.w, k);
  return (x > 0 && reach.has(k - 1)) || (x < c.w - 1 && reach.has(k + 1)) || (y > 0 && reach.has(k - c.w)) || (y < c.h - 1 && reach.has(k + c.w));
}

/** The 4 squares beside a square, in the order FE8 looks at them. */
const BESIDE = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The squares beside cell `k` that are on the map, in FE8's order. */
function* beside(c: Ctx, k: number) {
  const [x, y] = xy(c.w, k);
  for (const [dx, dy] of BESIDE) {
    if (x + dx >= 0 && y + dy >= 0 && x + dx < c.w && y + dy < c.h) yield (y + dy) * c.w + x + dx;
  }
}

/** GetAiSafestAccessibleAdjacentPosition: of the 4 squares beside `k`, the first best by terrain, friends and danger. */
function safestBeside(c: Ctx, k: number, reach: ReadonlyMap<number, number>): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const n of beside(c, k)) {
    if (!reach.has(n) || !free(c, n)) continue;
    const score = c.rules.terrainScore(c.unit, n) + friendZonePosition(c, n) - Math.floor(c.danger[n]! / 8);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/**
 * How many of the unit's side are set on healing (sub_803C364): the units numbered after its phase's
 * first, which for the green phase reaches into the first 63 enemy units.
 */
function sideHealing(c: Ctx): number {
  const units = inGameOrder(c.state.units);
  const side = units.filter((u) => u.team === c.unit.team);
  const more = c.unit.team === 'ally' ? units.filter((u) => u.team === 'enemy').slice(0, 63) : [];
  return [...side, ...more].filter((u) => u.healing).length;
}

/**
 * AiStaffFortify: with more than two of its side set on healing, the square it can reach with the most
 * allies set on healing within the staff's reach, counting itself where it stands now; the first such
 * square in the game's scan, and only if it reaches two or more. It heals the hurt allies there.
 */
function fortifyFrom(c: Ctx, staff: AiStaff, stay: boolean): { to: number; healed: string[] } | null {
  if (sideHealing(c) <= 2) return null;
  const reach = reached(c, stay);
  let best = 0;
  let to: number | null = null;
  for (const k of scan(c.w, c.h)) {
    if (!reach.has(k) || !free(c, k)) continue;
    const count = c.state.units.filter((u) => allied(c.unit, u) && wantsHealing(c, u) && distance(c.w, k, cellOf(c.w, u)) <= staff.reach).length;
    if (count > best) {
      best = count;
      to = k;
    }
  }
  if (to === null || best <= 1) return null;
  // ExecFortify (MakeTargetListForRangedHeal): every hurt ally in reach of the square, not the healer.
  const healed = c.state.units.filter((u) => u.id !== c.unit.id && allied(c.unit, u) && u.hp < u.stats.hp && distance(c.w, to!, cellOf(c.w, u)) <= staff.reach);
  return { to, healed: healed.map((u) => u.id) };
}

/**
 * AiTryDoStaff with healing staves (AiStaffHealMendRecover, AiStaffPhysicRescue, AiStaffFortify): the
 * ally set on healing with the lowest HP share (ties to the last found), from the safest square to
 * heal it from; or Fortify's (fortifyFrom). Each staff, in item order, can replace the one before if
 * its rank is no lower.
 */
function tryStaff(c: Ctx, stay: boolean): Plan | null {
  const staves = c.rules.healStaves?.(c.unit) ?? [];
  const reach = reached(c, stay);
  let plan: Plan | null = null;
  let rank = 0;
  for (const staff of staves) {
    if (staff.rank < rank) continue;
    let lowest = 100;
    let found: { to: number; target: PlayUnit; fortify?: string[] } | null = null;
    const pct = (u: PlayUnit) => Math.trunc((u.hp * 100) / Math.max(1, u.stats.hp));
    if (staff.fortify) {
      const f = fortifyFrom(c, staff, stay);
      if (f) found = { to: f.to, target: c.unit, fortify: f.healed };
    } else if (!staff.physic) {
      // The squares it can reach and their edges (MarkMovementMapEdges): a target beside one.
      for (const k of scan(c.w, c.h)) {
        const target = c.occupant.get(k);
        if (!target || target.id === c.unit.id || !allied(c.unit, target) || !wantsHealing(c, target)) continue;
        if (!reach.has(k) && !besideReached(c, k, reach)) continue;
        if (pct(target) > lowest) continue;
        const to = safestBeside(c, k, reach);
        if (to === null) continue;
        lowest = pct(target);
        found = { to, target };
      }
    } else {
      for (const target of inGameOrder(c.state.units)) {
        if (target.id === c.unit.id || !allied(c.unit, target) || !wantsHealing(c, target)) continue;
        const t = cellOf(c.w, target);
        if (distance(c.w, c.at, t) > staff.reach + c.search.mov) continue;
        // sub_803C284: the best square within the staff's reach of the target, the first best found.
        let to: number | null = null;
        let bestScore = -Infinity;
        for (const k of scan(c.w, c.h)) {
          if (!reach.has(k) || !free(c, k) || distance(c.w, k, t) > staff.reach) continue;
          const score = c.rules.terrainScore(c.unit, k) + friendZonePosition(c, k) - Math.floor(c.danger[k]! / 8);
          if (score > bestScore) {
            bestScore = score;
            to = k;
          }
        }
        if (to === null || pct(target) > lowest) continue;
        lowest = pct(target);
        found = { to, target };
      }
    }
    if (found) {
      const heal: PlannedHeal = { target: found.target.id, item: staff.item, heal: staff.heal, ...(found.fortify ? { fortify: found.fortify } : {}) };
      plan = { to: found.to, route: shortestRoute(c.search, found.to) ?? [c.at], attack: null, heal };
    }
    if (plan) rank = staff.rank;
  }
  return plan;
}

/**
 * AiFindBestAdjacentPositionByFunc with AiAttemptStealAction_GetMovementAt: of the 4 squares beside
 * `k`, the free one the unit can reach for the least movement, the first of equals.
 */
function cheapestBeside(c: Ctx, k: number): number | null {
  let best: number | null = null;
  let least = 0xff;
  for (const n of beside(c, k)) {
    const cost = c.search.reached.get(n);
    if (cost === undefined || cost >= MOVEMENT_MAX || !free(c, n) || least <= cost) continue;
    least = cost;
    best = n;
  }
  return best;
}

/**
 * AiAttemptStealActionWithinMovement, which AiAttemptOffensiveAction tries before attacking for a unit
 * that can steal and carries fewer than 5 items. It looks with the unit's whole movement, even when it
 * holds its square. Of the units not on its side beside a square it can reach, no faster than it (Spd),
 * it takes the one carrying the item highest in FE8's steal list, ties going to the last in the game's
 * scan, from the cheapest free square beside it. The item is the target's highest listed one, the last
 * of equals (AiGetUnitStealItemSlot); only listed items are taken.
 */
function trySteal(c: Ctx): Plan | null {
  const { unit, rules } = c;
  if (!rules.steals?.(unit) || unit.items.length >= UNIT_ITEM_COUNT) return null;
  const rankOf = (u: PlayUnit, i: number) => rules.stealRank?.(u, i) ?? 0xff;
  let rank = 0xff;
  let found: { to: number; steal: PlannedSteal } | null = null;
  for (const k of scan(c.w, c.h)) {
    const target = c.occupant.get(k);
    if (!target || allied(unit, target)) continue;
    // MarkMovementMapEdges marks the squares beside the reachable ones, where foes stand.
    if (!c.search.reached.has(k) && !besideReached(c, k, c.search.reached)) continue;
    const to = cheapestBeside(c, k);
    if (to === null || unit.stats.spd < target.stats.spd || !target.items.length) continue;
    let item = 0;
    let itemRank = 0xff;
    target.items.forEach((_, i) => {
      if (itemRank < rankOf(target, i)) return;
      itemRank = rankOf(target, i);
      item = i;
    });
    if (rank < itemRank) continue;
    rank = itemRank;
    found = { to, steal: { target: target.id, item } };
  }
  if (rank === 0xff || !found) return null;
  return { to: found.to, route: shortestRoute(c.search, found.to) ?? [c.at], attack: null, steal: found.steal };
}

/** Units within 3 squares of cell `k` that aren't the unit's allies (AiCountNearbyEnemyUnits). */
function nearbyFoes(c: Ctx, k: number): number {
  return RANGE3.filter(([dx, dy]) => {
    const o = unitAtOffset(c, k, dx, dy);
    return o && !allied(c.unit, o);
  }).length;
}

/**
 * AiTryMoveTowards: toward cell `goal`, the reachable free square with the lowest movement cost to
 * the goal (counted from the goal with the unit's terrain costs and no units in the way), no worse
 * than where it stands, ties to the last found; squares more dangerous than `maxDanger` are left out,
 * and with `maxDanger` 0, any dangerous one for a unit slower than the fastest player unit.
 */
function tryMoveTowards(c: Ctx, goal: number, maxDanger: number, fastestPlayer: number): number | null {
  if (goal === c.at) return c.at;
  const toGoal = c.rules.costMapFrom(c.unit, goal);
  const costTo = (k: number) => {
    const v = toGoal.get(k);
    return v === undefined || v > 124 ? 255 : v;
  };
  let bestRange = costTo(c.at);
  let to: number | null = null;
  for (const k of scan(c.w, c.h)) {
    if (!c.search.stops.has(k) || !free(c, k)) continue;
    if (maxDanger === 0 && c.search.mov < fastestPlayer && c.danger[k] !== 0) continue;
    if (c.danger[k]! > maxDanger) continue;
    if (costTo(k) > bestRange) continue;
    bestRange = costTo(k);
    to = k;
  }
  return to;
}

/**
 * AiTryGetNearestHealPoint: a fort, or a square with an allied player unit carrying a healing staff,
 * the unit could walk to (on any turn); of those, each that has no more foes nearby and costs no more
 * to reach than the last taken replaces it. Lords don't look for one.
 */
function nearestHealPoint(c: Ctx, healer: (u: PlayUnit) => boolean): number | null {
  if (c.rules.isLord(c.unit)) return null;
  const far = c.rules.searchOf(c.unit, c.state, 124);
  let count = 10000;
  let move = 0xff;
  let found: number | null = null;
  for (const k of scan(c.w, c.h)) {
    const cost = far.reached.get(k);
    if (cost === undefined || cost > MOVEMENT_MAX) continue;
    const o = c.occupant.get(k);
    if (c.rules.terrainAt(k) !== FORT) {
      if (!o || !allied(c.unit, o) || !healer(o)) continue;
    } else if (o && !allied(c.unit, o)) continue;
    const n = nearbyFoes(c, k);
    if (n <= count && cost <= move) {
      count = n;
      move = cost;
      found = k;
    }
  }
  return found;
}

/**
 * AiTryActionAfterMove after heading for a heal point (sub_803EEB0): attack, with its equipped weapon,
 * the first foe in reach from there that couldn't strike back at that distance.
 */
function attackAfterMove(c: Ctx, from: number): { target: PlayUnit; item: number } | null {
  const weapon = equipped(c.rules, c.unit);
  if (!weapon) return null;
  for (const k of scan(c.w, c.h)) {
    const d = distance(c.w, from, k);
    if (d < weapon.min || d > weapon.max) continue;
    const o = c.occupant.get(k);
    if (!o || allied(c.unit, o)) continue;
    const theirs = equipped(c.rules, o);
    if (theirs && (d > theirs.max || d < theirs.min)) return { target: o, item: weapon.item };
  }
  return null;
}

/** The unit's decision, as FE8's AI makes it. `unit.healing` must already be up to date (isHealing). */
export function planAction(unit: PlayUnit, state: PlayState, rules: AiRules): Plan {
  const w = rules.width;
  const h = rules.height ?? 0;
  const search = rules.searchOf(unit, state);
  const at = cellOf(w, unit);
  const occupant = new Map(state.units.map((u) => [cellOf(w, u), u] as const));
  const c: Ctx = { unit, state, rules, w, h, at, occupant, search, danger: dangerMap(unit, state, rules, search.mov) };
  const stay: Plan = { to: at, route: [at], attack: null };
  const moveTo = (to: number, extra: Partial<Plan> = {}): Plan => ({ to, route: shortestRoute(search, to) ?? [at], attack: null, ...extra });

  // DecideHealOrEscape.
  if (unit.healing) {
    const use = rules.selfHealItem?.(unit);
    const to = use && safestStop(search.stops.keys(), c.danger);
    if (use && to !== null && to !== undefined) return moveTo(to, { useItem: use });
    // Healers to head for are player units only (SetupUnitInventoryAIFlags marks no others).
    const point = nearestHealPoint(c, (u) => u.team === 'player' && (rules.healStaves?.(u).length ?? 0) > 0);
    if (point !== null) {
      const fastest = Math.max(0, ...state.units.filter((u) => u.team === 'player').map((u) => rules.searchOf(u, state).mov));
      const to = tryMoveTowards(c, point, 0, fastest);
      if (to !== null) {
        // AiTryActionAfterMove: for a unit that can steal, AiTryDoStealAdjacent always reports success (it
        // compares a 0 or 1 result with -1), and the map it builds leaves no square to steal from, so the
        // unit neither steals nor attacks.
        const after = rules.steals?.(unit) ? null : attackAfterMove(c, to);
        return moveTo(to, after ? { attack: after.target.id, attackItem: after.item } : {});
      }
    }
  }

  // AI1: the standard action (AiScriptCmd_05), or Hold's without moving (AiScriptCmd_07), but for a
  // steal, which AiAttemptOffensiveAction tries first with the unit's whole movement.
  const inPlace = unit.ai === 'hold';
  const action = tryStaff(c, inPlace) ?? trySteal(c) ?? tryAttack(c, inPlace);
  if (action) return action;

  // AI2: Charge moves toward the nearest enemy (AiScriptCmd_12_MoveTowardsEnemy); the others stay.
  if (unit.ai === 'charge') {
    const from = rules.costMapFrom(unit, at);
    let nearest: number | null = null;
    let best = 0xff;
    for (const k of scan(w, h)) {
      const cost = from.get(k);
      const o = occupant.get(k);
      if (cost === undefined || cost > MOVEMENT_MAX || !o || o.id === unit.id || !areFoes(o.team, unit.team) || cost > best) continue;
      best = cost;
      nearest = k;
    }
    if (nearest !== null) {
      const to = tryMoveTowards(c, nearest, 0xff, 0);
      if (to !== null && to !== at) return moveTo(to);
    }
  }
  return stay;
}
