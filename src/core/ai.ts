// What a computer-controlled unit does on its turn (decision 23).
// Attack: of every square it can end on and every foe it can hit from there, the fight with the best
// score: expected damage, a large bonus for a likely kill, less half the expected counter; ties go to
// the shorter walk. Charge units with nothing to attack walk toward the nearest foe. Attack-in-range
// units wait. Hold units never move but attack anything in reach. A unit with a healing staff heals
// first: of the hurt allies it can reach this turn (as its behaviour allows), the heal that gives back
// the most HP, then the ally with the least HP left; ties go to the shorter walk.
// Before all that, as FE8 decides first (DecideHealOrEscape), a unit set on healing itself
// (AiUpdateGetUnitIsHealing: from under half its HP until it is whole again, the thresholds FE8 uses
// for the AI settings the patch writes) uses its first Vulnerary or Elixir (AiTryHealSelf), on the
// reachable square FE8's danger map rates safest (AiFindSafestReachableLocation). Hold units move for
// this too, as they do in the patched game, whose Hold only stops them moving later in the decision.
// Not yet: heading for a fort or a healer without such an item (AiTryGetNearestHealPoint).

import type { Forecast } from './combat';
import { shortestRoute, type MoveSearch } from './movement';
import { areFoes, type PlayState, type PlayUnit } from './play';

export interface AiRules {
  readonly width: number;
  /** The map's height in squares (needed for the danger map). */
  readonly height?: number;
  /** Where the unit can go this turn; with `mov`, as if it had that much movement. */
  searchOf(unit: PlayUnit, state: PlayState, mov?: number): MoveSearch;
  /** Foes the unit could attack from square `at`. */
  targetsAt(unit: PlayUnit, at: readonly [number, number], state: PlayState): PlayUnit[];
  /** The forecast for the unit attacking `target` from square `at`. */
  forecastAt(unit: PlayUnit, at: readonly [number, number], target: PlayUnit, state: PlayState): Forecast;
  /** Each staff the unit could heal with from where it stands, in item order (none if left out). */
  staffChoices?(unit: PlayUnit, state: PlayState): StaffChoice[];
  /** The unit's first Vulnerary or Elixir and what it heals, if it has one (AiTryHealSelf). */
  selfHealItem?(unit: PlayUnit): { readonly item: number; readonly heal: number } | null;
  /** What a foe threatens, for the danger map. */
  threatOf?(foe: PlayUnit, state: PlayState): Threat;
}

/** What a unit threatens, as FE8's danger map counts it (AiFillDangerMap). */
export interface Threat {
  /** Strength (GetUnitPower) and movement. */
  readonly power: number;
  readonly mov: number;
  /** The weapons it can use, in item order: might and range. */
  readonly weapons: readonly { readonly might: number; readonly min: number; readonly max: number }[];
  /** Every cell its movement map reaches. */
  readonly reached: Iterable<number>;
}

/** A staff the unit can heal with: its item index, the allies it reaches and how much it heals. */
export interface StaffChoice {
  readonly item: number;
  readonly targets: readonly string[];
  readonly heal: number;
}

/** A heal the computer chose: whom, with which item, for how much. */
export interface PlannedHeal {
  readonly target: string;
  readonly item: number;
  readonly heal: number;
}

export interface Plan {
  /** Cell to move to (its own cell to stay). */
  readonly to: number;
  /** Route there, start first; just the start when staying. */
  readonly route: readonly number[];
  /** Foe to attack from there, if any. */
  readonly attack: string | null;
  /** Or an ally to heal from there. */
  readonly heal?: PlannedHeal;
  /** Or a healing item to use on itself there. */
  readonly useItem?: { readonly item: number; readonly heal: number };
}

/**
 * Whether a computer-controlled unit is set on healing itself (AiUpdateGetUnitIsHealing with
 * gAI3HealingThresholdTable's first thresholds, which the patch's AI settings select): it starts under
 * half its HP and keeps on until its HP is full.
 */
export function isHealing(unit: PlayUnit): boolean {
  const percent = Math.trunc((unit.hp * 100) / Math.max(1, unit.stats.hp));
  return unit.healing ? percent < 100 : percent < 50;
}

const TEAM_ORDER = { player: 0, ally: 1, enemy: 2 } as const;

/**
 * FE8's danger map for `unit` (AiFillDangerMap): for each foe, in the game's unit order (player, then
 * green, then enemy units), (power + might) / 2 is added to every square its weapon could reach this
 * turn, wrapping as the game's bytes do. As in the game, the weapon and might are never reset between
 * foes: each foe counts with the strongest weapon seen so far, and only if the two could meet
 * (AiCouldReachByBirdsEyeDistance).
 */
export function dangerMap(unit: PlayUnit, state: PlayState, rules: AiRules, mov: number): Uint8Array {
  const w = rules.width;
  const h = rules.height ?? 0;
  const danger = new Uint8Array(w * h);
  if (!rules.threatOf || !h) return danger;
  const foes = state.units.filter((o) => areFoes(o.team, unit.team)).sort((a, b) => TEAM_ORDER[a.team] - TEAM_ORDER[b.team]);
  let weapon: Threat['weapons'][number] | null = null;
  let might = 0;
  for (const foe of foes) {
    const threat = rules.threatOf(foe, state);
    for (const wpn of threat.weapons) {
      if (wpn.might > might) {
        weapon = wpn;
        might = wpn.might;
      }
    }
    if (!weapon) continue;
    const apart = Math.abs(unit.at[0] - foe.at[0]) + Math.abs(unit.at[1] - foe.at[1]);
    if (apart > mov + threat.mov + weapon.max) continue;
    const inRange = new Uint8Array(w * h);
    for (const k of threat.reached) {
      const x0 = k % w;
      const y0 = Math.floor(k / w);
      for (let y = Math.max(0, y0 - weapon.max); y <= Math.min(h - 1, y0 + weapon.max); y++) {
        for (let x = Math.max(0, x0 - weapon.max); x <= Math.min(w - 1, x0 + weapon.max); x++) {
          const d = Math.abs(x - x0) + Math.abs(y - y0);
          if (d >= weapon.min && d <= weapon.max) inRange[y * w + x] = 1;
        }
      }
    }
    const add = (threat.power + might) >> 1;
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

/** Movement for searching toward far-off foes. */
const FAR = 999;

function expected(s: Forecast['attacker']): number {
  return s.canAttack ? (s.hit / 100) * s.damage * (s.doubles ? 2 : 1) : 0;
}

/** How good attacking with this forecast is; higher is better. */
export function attackScore(f: Forecast, targetHp: number): number {
  const a = f.attacker;
  const killBonus = a.canAttack && a.damage * (a.doubles ? 2 : 1) >= targetHp ? 100 * (a.hit / 100) : 0;
  return expected(a) + killBonus - expected(f.defender) / 2;
}

export function planAction(unit: PlayUnit, state: PlayState, rules: AiRules): Plan {
  const w = rules.width;
  const search = rules.searchOf(unit, state);
  const start = search.start;
  const cellAt = (k: number) => [k % w, Math.floor(k / w)] as const;
  const stay: Plan = { to: start, route: [start], attack: null };

  if (unit.healing && rules.selfHealItem) {
    const use = rules.selfHealItem(unit);
    const to = use && safestStop(search.stops.keys(), dangerMap(unit, state, rules, search.mov));
    if (use && to !== null) return { to, route: shortestRoute(search, to) ?? [start], attack: null, useItem: use };
  }

  const stops = unit.ai === 'hold' ? [start] : [...search.stops.keys()];

  if (rules.staffChoices) {
    let heal: { gives: number; left: number; cost: number; to: number; plan: PlannedHeal } | null = null;
    for (const k of stops) {
      const at = cellAt(k);
      const cost = search.stops.get(k) ?? 0;
      for (const choice of rules.staffChoices({ ...unit, at }, state)) {
        for (const id of choice.targets) {
          const ally = state.units.find((u) => u.id === id);
          if (!ally) continue;
          const gives = Math.min(choice.heal, ally.stats.hp - ally.hp);
          const better =
            !heal || gives > heal.gives || (gives === heal.gives && (ally.hp < heal.left || (ally.hp === heal.left && cost < heal.cost)));
          if (better) heal = { gives, left: ally.hp, cost, to: k, plan: { target: id, item: choice.item, heal: choice.heal } };
        }
      }
    }
    if (heal) return { to: heal.to, route: shortestRoute(search, heal.to) ?? [start], attack: null, heal: heal.plan };
  }

  let best: { score: number; cost: number; to: number; target: string } | null = null;
  for (const k of stops) {
    const at = cellAt(k);
    const cost = search.stops.get(k) ?? 0;
    for (const target of rules.targetsAt(unit, at, state)) {
      const score = attackScore(rules.forecastAt(unit, at, target, state), target.hp);
      if (!best || score > best.score || (score === best.score && cost < best.cost)) best = { score, cost, to: k, target: target.id };
    }
  }
  if (best) return { to: best.to, route: shortestRoute(search, best.to) ?? [start], attack: best.target };
  if (unit.ai !== 'charge') return stay;

  // Head for the nearest foe: the closest square next to one by walking distance, ignoring this turn's limit.
  const far = rules.searchOf(unit, state, FAR);
  const foes = state.units.filter((o) => (o.team === 'enemy') !== (unit.team === 'enemy'));
  if (!foes.length) return stay;
  const foeDistance = (k: number) => {
    const [x, y] = cellAt(k);
    return Math.min(...foes.map((f) => Math.abs(f.at[0] - x) + Math.abs(f.at[1] - y)));
  };
  let goal: { k: number; d: number; cost: number } | null = null;
  for (const [k, cost] of far.stops) {
    const d = foeDistance(k);
    // Next to a foe beats any distance; then nearer to a foe; then a shorter walk.
    const key = (dd: number) => (dd <= 1 ? 0 : dd);
    if (!goal || key(d) < key(goal.d) || (key(d) === key(goal.d) && cost < goal.cost)) goal = { k, d, cost };
  }
  if (!goal || goal.k === start) return stay;
  const route = shortestRoute(far, goal.k) ?? [start];
  // Walk along that route as far as this turn's movement allows, stopping on a free square.
  let end = 0;
  for (let i = 0; i < route.length; i++) if (search.stops.has(route[i]!)) end = i;
  const to = route[end]!;
  return to === start ? stay : { to, route: shortestRoute(search, to) ?? [start], attack: null };
}
