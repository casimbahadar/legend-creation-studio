// What a computer-controlled unit does on its turn (decision 23).
// Attack: of every square it can end on and every foe it can hit from there, the fight with the best
// score: expected damage, a large bonus for a likely kill, less half the expected counter; ties go to
// the shorter walk. Charge units with nothing to attack walk toward the nearest foe. Attack-in-range
// units wait. Hold units never move but attack anything in reach.

import type { Forecast } from './combat';
import { shortestRoute, type MoveSearch } from './movement';
import type { PlayState, PlayUnit } from './play';

export interface AiRules {
  readonly width: number;
  /** Where the unit can go this turn; with `mov`, as if it had that much movement. */
  searchOf(unit: PlayUnit, state: PlayState, mov?: number): MoveSearch;
  /** Foes the unit could attack from square `at`. */
  targetsAt(unit: PlayUnit, at: readonly [number, number], state: PlayState): PlayUnit[];
  /** The forecast for the unit attacking `target` from square `at`. */
  forecastAt(unit: PlayUnit, at: readonly [number, number], target: PlayUnit, state: PlayState): Forecast;
}

export interface Plan {
  /** Cell to move to (its own cell to stay). */
  readonly to: number;
  /** Route there, start first; just the start when staying. */
  readonly route: readonly number[];
  /** Foe to attack from there, if any. */
  readonly attack: string | null;
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

  let best: { score: number; cost: number; to: number; target: string } | null = null;
  const stops = unit.ai === 'hold' ? [start] : [...search.stops.keys()];
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
