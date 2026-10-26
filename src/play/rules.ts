// The game rules for one chapter map, built from the ROM catalog: movement from each class's move
// costs, targets from the weapons units carry, forecasts with terrain bonuses, fights and experience.

import { forecast, resolveBattle, type Combatant, type Forecast, type Strike } from '../core/combat';
import { addExp, expGain, rollLevelUp, type ExpProfile } from '../core/experience';
import { IMPASSABLE, searchMoves, type MoveSearch } from '../core/movement';
import { areFoes, unitAt, type PlayState, type PlayUnit } from '../core/play';
import type { ExpAward, PlayRules } from '../core/play-input';
import type { RomCharacter } from '../rom/fe8-characters';
import { CA_BOSS, CA_MAXLEVEL10, CA_PROMOTED, CA_THIEF } from '../rom/fe8-classes';
import type { ChapterMap } from '../rom/fe8-maps';
import { distance, inReach, toWeapon, weaponsOf, type ClassArt, type GameItem } from './catalog';

export interface FightPreview {
  readonly forecast: Forecast;
  readonly attackerWeapon: GameItem | undefined;
  readonly defenderWeapon: GameItem | undefined;
  readonly attacker: Combatant;
  readonly defender: Combatant;
  /** Where each side's weapon is in its items, if it has one. */
  readonly attackerItem: number | null;
  readonly defenderItem: number | null;
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

/** HP healing items' heal by item id (GetUnitItemHealAmount): Vulnerary 10, Elixir 80, and the second Vulnerary entry 10. */
const HEAL_ITEMS: Readonly<Record<number, number>> = { 0x6c: 10, 0x6d: 80, 0xa2: 10 };

/** A unit's last level: 10 for classes FE8 marks so (CA_MAXLEVEL10), otherwise 20. */
export function maxLevel(art: ClassArt | undefined, character: RomCharacter | undefined): number {
  return ((art?.attributes ?? 0) | (character?.attributes ?? 0)) & CA_MAXLEVEL10 ? 10 : 20;
}

/**
 * `rn` gives the random numbers for fights and level-ups (0 to 99); `characterOf` the FE8 character
 * a unit plays as, if any, whose growths and attributes then count.
 */
export function chapterRules(
  map: ChapterMap,
  artByName: ReadonlyMap<string, ClassArt>,
  items: GameItem[],
  rn: () => number,
  characterOf: (u: PlayUnit) => RomCharacter | undefined = () => undefined,
): ChapterRules {
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

  /** The unit's first item that is `weapon`, or null. */
  const itemIndex = (u: PlayUnit, weapon: GameItem | undefined) => {
    const i = weapon ? u.items.indexOf(weapon.entry.name) : -1;
    return i >= 0 ? i : null;
  };

  function combatantOf(u: PlayUnit, weapon: GameItem | undefined): Combatant {
    const art = artByName.get(u.class);
    const t = map.terrain[u.at[1] * map.width + u.at[0]] ?? 0;
    const index = itemIndex(u, weapon);
    return {
      stats: u.stats,
      hp: u.hp,
      weapon: weapon ? toWeapon(weapon) : null,
      uses: index === null ? null : (u.uses[index] ?? null),
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
    return { forecast: forecast(attacker, defender, dist), attackerWeapon, defenderWeapon, attacker, defender, attackerItem: itemIndex(a, attackerWeapon), defenderItem: itemIndex(d, defenderWeapon) };
  }

  /** Foes the unit could attack from square `at`, nearest first. */
  function targetsAt(u: PlayUnit, at: readonly [number, number], state: PlayState): PlayUnit[] {
    const weapons = weaponsOf(artByName.get(u.class), u.items, items);
    const from = { ...u, at };
    return state.units
      .filter((o) => o.id !== u.id && areFoes(o.team, u.team) && weapons.some((w) => inReach(w, distance(from, o))))
      .sort((a, b) => distance(from, a) - distance(from, b));
  }

  function profileOf(u: PlayUnit): ExpProfile {
    const art = artByName.get(u.class);
    const attributes = (art?.attributes ?? 0) | (characterOf(u)?.attributes ?? 0);
    return {
      level: u.level,
      promoted: (attributes & CA_PROMOTED) !== 0,
      power: art?.power ?? 1,
      promotionPower: art?.promotionPower ?? 0,
      boss: (attributes & CA_BOSS) !== 0,
      thief: (attributes & CA_THIEF) !== 0,
    };
  }

  /** Experience for the first player unit in the fight that can gain it (only player units do, as in FE8). */
  function experience(a: PlayUnit, d: PlayUnit, strikes: readonly Strike[]): ExpAward | null {
    const last = strikes[strikes.length - 1];
    for (const [u, other, by] of [
      [a, d, 'attacker'],
      [d, a, 'defender'],
    ] as const) {
      if (u.team !== 'player' || u.exp === null) continue;
      const hpOf = (side: 'attacker' | 'defender', unit: PlayUnit) => (last ? (side === 'attacker' ? last.attackerHp : last.defenderHp) : unit.hp);
      const fell = hpOf(by, u) <= 0;
      const otherFell = hpOf(by === 'attacker' ? 'defender' : 'attacker', other) <= 0;
      const dealt = strikes.some((s) => s.by === by && s.hit && s.damage > 0);
      const gain = expGain(profileOf(u), profileOf(other), dealt, fell, otherFell);
      const art = artByName.get(u.class);
      const character = characterOf(u);
      const result = addExp(u.level, u.exp, gain, maxLevel(art, character), () =>
        rollLevelUp(u.stats, character?.growths ?? art?.growths ?? u.stats, art?.caps ?? u.stats, rn),
      );
      return result.gain > 0 ? { unit: u.id, level: u.level, exp: u.exp, result } : null;
    }
    return null;
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
      return { strikes: resolveBattle(f.attacker, f.defender, f.forecast, rn), attackerItem: f.attackerItem, defenderItem: f.defenderItem };
    },
    experience,
    weaponChoices: (u, state) => {
      const art = artByName.get(u.class);
      const choices: { item: number; targets: string[] }[] = [];
      u.items.forEach((name, item) => {
        const [weapon] = weaponsOf(art, [name], items);
        if (!weapon) return;
        const targets = state.units
          .filter((o) => o.id !== u.id && areFoes(o.team, u.team) && inReach(weapon, distance(u, o)))
          .sort((x, y) => distance(u, x) - distance(u, y))
          .map((o) => o.id);
        if (targets.length) choices.push({ item, targets });
      });
      return choices;
    },
    itemUse: (u, index) => {
      const item = items.find((i) => i.entry.name === u.items[index]);
      const equip = !!item && weaponsOf(artByName.get(u.class), [item.entry.name], items).length > 0;
      return { equip, heal: item ? (HEAL_ITEMS[item.rom.id] ?? 0) : 0 };
    },
  };
  return { rules, preview };
}
