// The game rules for one chapter map, built from the ROM catalog: movement from each class's move
// costs, targets from the weapons units carry, forecasts with terrain bonuses, fights, heals and
// experience.

import { forecast, hpCapFor, resolveBattle, withinCaps, type Combatant, type Forecast, type Stats, type Strike } from '../core/combat';
import { addExp, expGain, rollLevelUp, staffExp, type ExpProfile } from '../core/experience';
import { IMPASSABLE, searchMoves, type MoveSearch } from '../core/movement';
import { areFoes, unitAt, type PlayState, type PlayUnit, type StatusKind } from '../core/play';
import type { AiItem, AiStaff } from '../core/ai';
import type { ExpAward, ItemUse, PlayRules, StaffChoice } from '../core/play-input';
import type { RomCharacter } from '../rom/fe8-characters';
import { CA_BOSS, CA_LORD, CA_MAXLEVEL10, CA_PROMOTED, CA_STEAL, CA_THIEF } from '../rom/fe8-classes';
import { isStaff, isStealable } from '../rom/fe8-items';
import type { ChapterMap } from '../rom/fe8-maps';
import { distance, IA_MAGIC, inReach, toWeapon, usable, weaponsOf, type ClassArt, type GameItem } from './catalog';

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

/**
 * Healing staves by item id (GetUnitItemHealAmount, MakeTargetListForRangedHeal): Heal 10, Mend 20,
 * Recover 80, Physic 10 at range, Fortify 10 to everyone at range.
 */
const HEAL_STAVES: Readonly<Record<number, { heal: number; physic: boolean; fortify?: boolean }>> = {
  0x4b: { heal: 10, physic: false },
  0x4c: { heal: 20, physic: false },
  0x4d: { heal: 80, physic: false },
  0x4e: { heal: 10, physic: true },
  0x4f: { heal: 10, physic: true, fortify: true },
};

/** Staves that give a status, by item id (ExecStatusStaff): Silence, Sleep and Berserk. */
const STATUS_STAVES: Readonly<Record<number, StatusKind>> = { 0x51: 'silence', 0x52: 'sleep', 0x53: 'berserk' };

/** Stat boosters by item id: Angelic Robe to Body Ring (ITEM_BOOSTER_HP to ITEM_BOOSTER_CON). */
const BOOSTERS = new Set([0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x61, 0x62, 0x63]);
/**
 * The items the computer steals, most wanted first, by item id (gAiStealPriorityItemList): Member Card,
 * Silver Card, Hoplon Guard, Delphi Shield, Lockpick, Metis's Tome, Master Seal, the promotion items,
 * Heaven Seal, item 0xC1, White Gem, the four Sacred Stones items, the stat boosters, Juna Fruit, Blue
 * and Red Gems, Elixir, Chest and Door Keys, Pure Water, Torch, Vulnerary, Antitoxin, Mine, Light Rune.
 */
const AI_STEAL_PRIORITY = [
  0x72, 0x73, 0x7c, 0x71, 0x6b, 0x89, 0x88, 0x64, 0x65, 0x66, 0x67, 0x68, 0x8a, 0xc1, 0x74, 0x7d, 0x7e, 0x7f, 0x80, 0x5d, 0x5f, 0x5b,
  0x60, 0x5c, 0x5e, 0x61, 0x62, 0x63, 0xb7, 0x75, 0x76, 0x6d, 0x69, 0x6a, 0x6e, 0x70, 0x6c, 0x6f, 0x7a, 0x7b,
];
/** FE8's movement cap (UNIT_MOV_MAX). */
const MOV_CAP = 15;

/** HP healing items' heal by item id (GetUnitItemHealAmount): Vulnerary 10, Elixir 80, and the second Vulnerary entry 10. */
const HEAL_ITEMS: Readonly<Record<number, number>> = { 0x6c: 10, 0x6d: 80, 0xa2: 10 };
/** The items the computer heals itself with (AiTryHealSelf): Vulnerary and Elixir only. */
const SELF_HEAL_ITEMS = new Set([0x6c, 0x6d]);

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
    return searchMoves(map, (t) => (costs ? (costs[t] ?? IMPASSABLE) : IMPASSABLE), art ? (mov ?? art.mov + (u.movBonus ?? 0)) : 0, u.at, (x, y) => {
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

  /** The unit's weapons it can use (CanUnitUseWeapon): a silenced unit can't use magic ones. */
  function weaponsFor(u: PlayUnit, names: readonly string[] = u.items): GameItem[] {
    return weaponsOf(artByName.get(u.class), names, items).filter((w) => u.status?.kind !== 'silence' || (w.rom.attributes & IA_MAGIC) === 0);
  }

  function preview(unit: PlayUnit, d: PlayUnit, at: readonly [number, number] = unit.at, slot?: number): FightPreview {
    const a = { ...unit, at };
    const dist = distance(a, d);
    const choices = weaponsFor(a, slot === undefined ? a.items : [a.items[slot] ?? '']);
    const attackerWeapon = choices.find((w) => inReach(w, dist));
    // A sleeping defender fights with no weapon and can't strike back (SetBattleUnitWeapon), nor can a
    // player unit a berserk player unit attacks (BattleInitTargetCanCounter).
    const noCounter = d.status?.kind === 'sleep' || (a.status?.kind === 'berserk' && a.team === 'player' && d.team === 'player');
    const defenderWeapon = noCounter ? undefined : weaponsFor(d)[0];
    const attacker = combatantOf(a, attackerWeapon);
    const defender = combatantOf(d, defenderWeapon);
    return { forecast: forecast(attacker, defender, dist), attackerWeapon, defenderWeapon, attacker, defender, attackerItem: itemIndex(a, attackerWeapon), defenderItem: itemIndex(d, defenderWeapon) };
  }

  /** Foes the unit could attack from square `at`, nearest first. */
  function targetsAt(u: PlayUnit, at: readonly [number, number], state: PlayState): PlayUnit[] {
    const weapons = weaponsFor(u);
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
    // BattleApplyExpGains: none when two player units fight (a berserk one and another).
    if (a.team === 'player' && d.team === 'player') return null;
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
      return award(u, expGain(profileOf(u), profileOf(other), dealt, fell, otherFell));
    }
    return null;
  }

  /** `gain` experience for a player unit that can gain it, with any level-up rolled; null if it gains none. */
  function award(u: PlayUnit, gain: number): ExpAward | null {
    if (u.team !== 'player' || u.exp === null) return null;
    const art = artByName.get(u.class);
    const character = characterOf(u);
    const result = addExp(u.level, u.exp, gain, maxLevel(art, character), () => rollLevelUp(u.stats, character?.growths ?? art?.growths ?? u.stats, art?.caps ?? u.stats, rn));
    return result.gain > 0 ? { unit: u.id, level: u.level, exp: u.exp, result } : null;
  }

  /** Half the unit's Magic, at least 5: Physic's, Fortify's and the status staves' reach (GetUnitMagBy2Range). */
  const magBy2 = (u: PlayUnit) => Math.max(5, Math.floor(u.stats.str / 2));

  /** The unit's staff `index` if it gives a status and its class can use it, with the status. */
  function statusStaff(u: PlayUnit, index: number) {
    const item = items.find((i) => i.entry.name === u.items[index]);
    const art = artByName.get(u.class);
    const kind = item ? STATUS_STAVES[item.rom.id] : undefined;
    return item && kind && art && isStaff(item.rom) && usable(art, item) && !u.status ? { item, kind } : null;
  }

  /**
   * A status staff's chance to hit (GetOffensiveStaffAccuracy): (Magic - the target's Res) x 5 + Skill
   * + 30 - 2 per square between them, from 0 to 100.
   */
  function staffAccuracy(u: PlayUnit, target: PlayUnit): number {
    return Math.max(0, Math.min(100, (u.stats.str - target.stats.res) * 5 + u.stats.skl + 30 - distance(u, target) * 2));
  }

  /** The unit's staff `index` if it is a healing staff its class can use. */
  function healStaff(u: PlayUnit, index: number) {
    const item = items.find((i) => i.entry.name === u.items[index]);
    const art = artByName.get(u.class);
    const staff = item ? HEAL_STAVES[item.rom.id] : undefined;
    // CanUnitUseStaff: not while asleep, berserk or silenced.
    return item && staff && art && isStaff(item.rom) && usable(art, item) && !u.status ? { item, ...staff } : null;
  }

  const rules: PlayRules = {
    width: map.width,
    height: map.height,
    searchOf,
    targetsOf: (u, state) => targetsAt(u, u.at, state).map((o) => o.id),
    costMapFrom: (u, from) => {
      const art = artByName.get(u.class);
      const costs = art?.moveCosts;
      return searchMoves(map, (t) => (costs ? (costs[t] ?? IMPASSABLE) : IMPASSABLE), 124, [from % map.width, Math.floor(from / map.width)], () => null).reached;
    },
    aiItems: (u) => {
      const art = artByName.get(u.class);
      if (!art) return [];
      return u.items.flatMap((name, item): AiItem[] => {
        const it = items.find((i) => i.entry.name === name);
        if (!it || !usable(art, it)) return [];
        if (isStaff(it.rom)) return u.status ? [] : [{ item, staff: true, might: 0, min: it.rom.minRange, max: it.rom.maxRange }];
        return weaponsFor(u, [name]).length ? [{ item, staff: false, might: it.rom.might, min: it.rom.minRange, max: it.rom.maxRange, magic: (it.rom.attributes & IA_MAGIC) !== 0 }] : [];
      });
    },
    forecastWith: (u, at, item, target) => preview(u, target, at, item).forecast,
    terrainScore: (u, cell) => {
      const art = artByName.get(u.class);
      const t = map.terrain[cell] ?? 0;
      return (art?.terrainAvoid?.[t] ?? 0) + (art?.terrainDef?.[t] ?? 0) + (art?.terrainRes?.[t] ?? 0);
    },
    terrainAt: (cell) => map.terrain[cell] ?? 0,
    isLord: (u) => (((artByName.get(u.class)?.attributes ?? 0) | (characterOf(u)?.attributes ?? 0)) & CA_LORD) !== 0,
    steals: (u) => (((artByName.get(u.class)?.attributes ?? 0) | (characterOf(u)?.attributes ?? 0)) & CA_STEAL) !== 0,
    stealRank: (u, index) => {
      const item = items.find((i) => i.entry.name === u.items[index]);
      const rank = item ? AI_STEAL_PRIORITY.indexOf(item.rom.id) : -1;
      return rank < 0 ? null : rank;
    },
    carriesMagic: (u) => weaponsFor(u).some((w) => (w.rom.attributes & IA_MAGIC) !== 0),
    aiStaves: (u) =>
      u.items.flatMap((_, index): AiStaff[] => {
        const status = statusStaff(u, index);
        if (status) return [{ item: index, heal: 0, physic: true, status: status.kind, reach: magBy2(u), rank: status.item.rom.rank }];
        const staff = healStaff(u, index);
        if (!staff) return [];
        return [
          {
            item: index,
            heal: Math.min(80, staff.heal + u.stats.str),
            physic: staff.physic,
            ...(staff.fortify ? { fortify: true } : {}),
            reach: staff.physic ? magBy2(u) : 1,
            rank: staff.item.rom.rank,
          },
        ];
      }),
    fight: (a, d) => {
      const f = preview(a, d);
      return { strikes: resolveBattle(f.attacker, f.defender, f.forecast, rn), attackerItem: f.attackerItem, defenderItem: f.defenderItem };
    },
    experience,
    weaponChoices: (u, state) => {
      const art = artByName.get(u.class);
      const choices: { item: number; targets: string[] }[] = [];
      u.items.forEach((name, item) => {
        const [weapon] = weaponsFor(u, [name]);
        if (!weapon) return;
        const targets = state.units
          .filter((o) => o.id !== u.id && areFoes(o.team, u.team) && inReach(weapon, distance(u, o)))
          .sort((x, y) => distance(u, x) - distance(u, y))
          .map((o) => o.id);
        if (targets.length) choices.push({ item, targets });
      });
      return choices;
    },
    staffChoices: (u, state) => {
      const choices: StaffChoice[] = [];
      u.items.forEach((_, index) => {
        const status = statusStaff(u, index);
        if (status) {
          // MakeTargetListForSleep, ...ForSilence: units not on its side in reach, with no other status.
          const foes = state.units
            .filter((o) => areFoes(o.team, u.team) && distance(u, o) <= magBy2(u) && (!o.status || o.status.kind === status.kind))
            .sort((x, y) => distance(u, x) - distance(u, y))
            .map((o) => o.id);
          if (foes.length) choices.push({ item: index, targets: foes, heal: 0, status: status.kind });
          return;
        }
        const staff = healStaff(u, index);
        if (!staff) return;
        // Heal, Mend and Recover reach a neighbour; Physic and Fortify half the healer's Magic, at least 5 (GetUnitMagBy2Range).
        const reach = staff.physic ? magBy2(u) : 1;
        const targets = state.units
          .filter((o) => o.id !== u.id && !areFoes(o.team, u.team) && o.hp < o.stats.hp && distance(u, o) >= 1 && distance(u, o) <= reach)
          .sort((x, y) => distance(u, x) - distance(u, y))
          .map((o) => o.id);
        // GetUnitItemHealAmount: the staff's amount plus the healer's Magic, at most 80.
        if (targets.length) choices.push({ item: index, targets, heal: Math.min(80, staff.heal + u.stats.str), ...(staff.fortify ? { fortify: true } : {}) });
      });
      return choices;
    },
    selfHealItem: (u) => {
      // AiTryHealSelf takes the first in item order.
      for (let index = 0; index < u.items.length; index++) {
        const item = items.find((i) => i.entry.name === u.items[index]);
        if (item && SELF_HEAL_ITEMS.has(item.rom.id)) return { item: index, heal: HEAL_ITEMS[item.rom.id]! };
      }
      return null;
    },
    staffExperience: (u, index, missed) => {
      const staff = healStaff(u, index) ?? statusStaff(u, index);
      if (!staff) return null;
      // GetBattleUnitStaffExp: 1 for a miss.
      if (missed) return award(u, 1);
      const attributes = (artByName.get(u.class)?.attributes ?? 0) | (characterOf(u)?.attributes ?? 0);
      return award(u, staffExp((attributes & CA_PROMOTED) !== 0, staff.item.rom.costPerUse));
    },
    staffAccuracy,
    // ExecStatusStaff: one random number under the chance hits (Roll1RN).
    statusStaffHits: (u, target) => rn() < staffAccuracy(u, target),
    stealable: (u, index) => {
      const item = items.find((i) => i.entry.name === u.items[index]);
      return !!item && isStealable(item.rom);
    },
    // BattleApplyMiscActionExpGains: 10 for a steal.
    stealExperience: (u) => award(u, 10),
    itemUse: (u, index) => {
      const item = items.find((i) => i.entry.name === u.items[index]);
      const art = artByName.get(u.class);
      const equip = !!item && weaponsFor(u, [item.entry.name]).length > 0;
      const use: ItemUse = { equip, heal: item ? (HEAL_ITEMS[item.rom.id] ?? 0) : 0 };
      const b = item && BOOSTERS.has(item.rom.id) ? item.rom.statBonuses : null;
      if (!b || !art) return use;
      // ApplyStatBoostItem, cut to the caps (UnitCheckStatCaps); usable only if that raises something (CanUnitUseStatGainItem).
      const raised = { hp: u.stats.hp + b.hp, str: u.stats.str + b.str, skl: u.stats.skl + b.skl, spd: u.stats.spd + b.spd, def: u.stats.def + b.def, res: u.stats.res + b.res, lck: u.stats.lck + b.lck, con: u.stats.con + b.con };
      const stats = withinCaps(raised, art.caps, hpCapFor(u.team));
      const movBonus = Math.min((u.movBonus ?? 0) + b.mov, MOV_CAP - art.mov);
      const changes = (Object.keys(stats) as (keyof Stats)[]).some((k) => stats[k] !== u.stats[k]) || movBonus !== (u.movBonus ?? 0);
      return changes ? { ...use, boost: { stats, movBonus } } : use;
    },
  };
  return { rules, preview };
}
