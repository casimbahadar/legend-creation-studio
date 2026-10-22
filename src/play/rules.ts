// The game rules for one chapter map, built from the ROM catalog: movement from each class's move
// costs, targets from the weapons units carry, forecasts with terrain bonuses, and fights.

import { forecast, resolveBattle, type Combatant, type Forecast } from '../core/combat';
import { IMPASSABLE, searchMoves, type MoveSearch } from '../core/movement';
import { areFoes, unitAt, type PlayState, type PlayUnit } from '../core/play';
import type { PlayRules } from '../core/play-input';
import type { ChapterMap } from '../rom/fe8-maps';
import { distance, inReach, toWeapon, weaponsOf, type ClassArt, type GameItem } from './catalog';

export interface FightPreview {
  readonly forecast: Forecast;
  readonly attackerWeapon: GameItem | undefined;
  readonly defenderWeapon: GameItem | undefined;
  readonly attacker: Combatant;
  readonly defender: Combatant;
}

export interface ChapterRules {
  readonly rules: PlayRules;
  /**
   * A fight's forecast, with the attacker standing on `at` (its own square if left out). The attacker
   * uses the first weapon it can use that reaches; the defender counters with its first usable weapon,
   * if that reaches.
   */
  preview(attacker: PlayUnit, defender: PlayUnit, at?: readonly [number, number]): FightPreview;
}

/** `rn` gives the random numbers for fights (0 to 99). */
export function chapterRules(map: ChapterMap, artByName: ReadonlyMap<string, ClassArt>, items: GameItem[], rn: () => number): ChapterRules {
  /** Where a unit could move this turn and how, from its class's ROM movement. */
  function searchOf(u: PlayUnit, state: PlayState, mov?: number): MoveSearch {
    const art = artByName.get(u.class);
    const costs = art?.moveCosts;
    return searchMoves(map, (t) => (costs ? (costs[t] ?? IMPASSABLE) : IMPASSABLE), art ? (mov ?? art.mov) : 0, u.at, (x, y) => {
      const o = unitAt(state, x, y);
      if (!o || o.id === u.id) return null;
      return areFoes(o.team, u.team) ? 'foe' : 'friend';
    });
  }

  function combatantOf(u: PlayUnit, weapon: GameItem | undefined): Combatant {
    const art = artByName.get(u.class);
    const t = map.terrain[u.at[1] * map.width + u.at[0]] ?? 0;
    return {
      stats: u.stats,
      hp: u.hp,
      weapon: weapon ? toWeapon(weapon) : null,
      terrain: { avoid: art?.terrainAvoid?.[t] ?? 0, def: art?.terrainDef?.[t] ?? 0, res: art?.terrainRes?.[t] ?? 0 },
    };
  }

  function preview(unit: PlayUnit, d: PlayUnit, at: readonly [number, number] = unit.at): FightPreview {
    const a = { ...unit, at };
    const dist = distance(a, d);
    const attackerWeapon = weaponsOf(artByName.get(a.class), a.items, items).find((w) => inReach(w, dist));
    const defenderWeapon = weaponsOf(artByName.get(d.class), d.items, items)[0];
    const attacker = combatantOf(a, attackerWeapon);
    const defender = combatantOf(d, defenderWeapon);
    return { forecast: forecast(attacker, defender, dist), attackerWeapon, defenderWeapon, attacker, defender };
  }

  /** Foes the unit could attack from square `at`, nearest first. */
  function targetsAt(u: PlayUnit, at: readonly [number, number], state: PlayState): PlayUnit[] {
    const weapons = weaponsOf(artByName.get(u.class), u.items, items);
    const from = { ...u, at };
    return state.units
      .filter((o) => o.id !== u.id && areFoes(o.team, u.team) && weapons.some((w) => inReach(w, distance(from, o))))
      .sort((a, b) => distance(from, a) - distance(from, b));
  }

  const rules: PlayRules = {
    width: map.width,
    height: map.height,
    searchOf,
    targetsAt,
    targetsOf: (u, state) => targetsAt(u, u.at, state).map((o) => o.id),
    forecastAt: (u, at, target) => preview(u, target, at).forecast,
    fight: (a, d) => {
      const f = preview(a, d);
      return resolveBattle(f.attacker, f.defender, f.forecast, rn);
    },
  };
  return { rules, preview };
}
