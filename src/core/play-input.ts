// GBA-style controls for test play: a cursor moved one square at a time, A to act, B to cancel.
// While a unit is being moved the cursor stays inside its reach; after it moves, FE's action menu
// (Attack, Steal, Item, Wait and others) opens, B undoes the move, Attack picks a target and Item
// opens the unit's items. While a unit walks or a battle plays, input waits. End turn hands over to the enemy phase,
// then the ally phase (decision 24), each unit acting by its behaviour, one step at a time through
// stepAI.

import { isHealing, phaseOrder, planAction, type AiRules, type PlannedHeal, type PlannedStatus, type PlannedSteal, type StaffChoice } from './ai';
import { MAX_ITEMS } from './project';

export type { StaffChoice } from './ai';
import type { Stats, Strike } from './combat';
import type { ExpResult } from './experience';
import { followCursor, shortestRoute, type MoveSearch } from './movement';
import { applyBattle, applyExp, boostUnit, cannotAct, clearStatus, discardItem, setBarrier, setStatus, tickStatuses, seize, stealItem, tradeItems, endTurn, equipItem, finishAction, healUnit, moveUnit, outcomeOf, readyAll, spendUses, UNIT_ITEM_COUNT, unitAt, useHealItem, type Outcome, type PlayState, type PlayUnit, type StatusKind } from './play';

export type Phase = 'player' | 'enemy' | 'ally';

export type MenuOption = 'seize' | 'attack' | 'staff' | 'steal' | 'item' | 'trade' | 'wait';

/** What can be done with one item, as in FE8's item menu. */
export type ItemOption = 'equip' | 'use' | 'discard';

/**
 * What a unit can do with one of its items: equip it (a weapon its class can use), heal with it (HP
 * given back; 0 for none), or use it as a booster (`boost`: the unit's stats and movement bonus after,
 * set only if it would raise something).
 */
export interface ItemUse {
  readonly equip: boolean;
  readonly heal: number;
  readonly boost?: { readonly stats: Stats; readonly movBonus: number };
}

export type Action =
  /** The action menu for a unit that has just moved from `from`; once it has traded (`locked`) the move can't be taken back. */
  | { readonly kind: 'menu'; readonly unit: string; readonly from: readonly [number, number]; readonly index: number; readonly locked?: boolean }
  /** Choosing which enemy to attack, or with `staff`, which ally to heal with that item. */
  | {
      readonly kind: 'target';
      readonly unit: string;
      readonly from: readonly [number, number];
      readonly targets: readonly string[];
      readonly index: number;
      readonly staff?: StaffChoice;
      /** Choosing whom to trade with instead. */
      readonly trade?: boolean;
      /** Or whom to steal from. */
      readonly steal?: boolean;
      readonly locked?: boolean;
    }
  /**
   * Trading with `partner`: slots 0 to 4 are the unit's items, 5 to 9 the partner's (an empty slot past
   * the last item takes one); `picked` is the slot chosen to move, if any.
   */
  | {
      readonly kind: 'trade';
      readonly unit: string;
      readonly from: readonly [number, number];
      readonly partner: string;
      readonly index: number;
      readonly picked: number | null;
      readonly locked?: boolean;
    }
  /** Choosing which weapon to attack with (or with `staff`, which staff to heal with), `index` highlighted among the choices. */
  | { readonly kind: 'weapon'; readonly unit: string; readonly from: readonly [number, number]; readonly index: number; readonly staff?: boolean }
  /** Choosing which of `target`'s items to steal, `index` highlighted. */
  | { readonly kind: 'steal'; readonly unit: string; readonly from: readonly [number, number]; readonly target: string; readonly index: number; readonly locked?: boolean }
  /** Choosing the square to Warp `target` to with staff `item`: one of `cells`, under the cursor. */
  | { readonly kind: 'warp'; readonly unit: string; readonly from: readonly [number, number]; readonly target: string; readonly item: number; readonly cells: readonly number[] }
  /** The unit's items, `index` highlighted. */
  | { readonly kind: 'items'; readonly unit: string; readonly from: readonly [number, number]; readonly index: number }
  /** What to do with item `item`, option `index` highlighted. */
  | { readonly kind: 'item'; readonly unit: string; readonly from: readonly [number, number]; readonly item: number; readonly index: number };

/** Experience a unit earned in a fight: where it stood before, and the result. */
export interface ExpAward {
  readonly unit: string;
  readonly level: number;
  readonly exp: number;
  readonly result: ExpResult;
}

/** A fight's blows and the item each side fought with (its index in the unit's items), if any. */
export interface Fight {
  readonly strikes: readonly Strike[];
  readonly attackerItem: number | null;
  readonly defenderItem: number | null;
}

export interface Battle extends Fight {
  readonly attacker: string;
  readonly defender: string;
  /** Set for a heal: the HP the attacker's staff (attackerItem) gives the defender. A heal has no blows. */
  readonly heal?: number;
  /** Fortify: the allies it heals, each by `heal`, instead of the defender (the healer itself). */
  readonly healed?: readonly string[];
  /** Set for a staff that gives a status: the status, and whether it hit. It has no blows. */
  readonly inflict?: { readonly kind: StatusKind; readonly hit: boolean };
  /** Set for Restore or Barrier on the defender. It has no blows. */
  readonly support?: 'restore' | 'barrier';
  /** Set for Warp or Rescue: the square the defender is moved to. It has no blows. */
  readonly relocate?: readonly [number, number];
  /** Set for a steal: the defender's item the attacker takes (its index). A steal has no blows. */
  readonly steal?: number;
  /** The experience the fight gave, shown after it; null if nobody gained any. */
  readonly exp: ExpAward | null;
}

export interface PlayView {
  readonly state: PlayState;
  readonly cursor: readonly [number, number];
  /** The unit whose range is shown, if any. */
  readonly selected: string | null;
  /** The movement arrow while moving a unit: cell indices from the unit to the cursor. */
  readonly route: readonly number[] | null;
  /**
   * A unit walking its route to the square it was just moved to, from `from`. Input waits until
   * finishWalk. A computer-controlled unit attacks `then` (or heals per `thenHeal`, uses the item per
   * `thenUse`, steals per `thenSteal`, uses a status staff per `thenInflict`, Restore per `thenRestore`
   * or Rescue per `thenRescue`) on arrival, if set.
   */
  readonly walking: {
    readonly id: string;
    readonly route: readonly number[];
    readonly from: readonly [number, number];
    readonly then?: string | null;
    readonly thenHeal?: PlannedHeal;
    readonly thenUse?: { readonly item: number; readonly heal: number };
    readonly thenSteal?: PlannedSteal;
    readonly thenInflict?: PlannedStatus;
    readonly thenRestore?: { readonly target: string; readonly item: number };
    readonly thenRescue?: { readonly target: string; readonly item: number };
  } | null;
  readonly action: Action | null;
  /** A fight being shown. Input waits until finishBattle. */
  readonly battle: Battle | null;
  /** Whose phase it is. Outside the player's, input waits and stepAI moves the units. */
  readonly phase: Phase;
  /** Units still to act this computer phase, in order. */
  readonly queue: readonly string[];
  /**
   * The side's berserk units are acting, after its own phase (FE8's berserk phase): `queue` holds them,
   * in unit order, and the computer moves them, the player's too.
   */
  readonly berserk?: boolean;
  /** The phase banner showing, if any. Input waits until stepAI clears it. */
  readonly banner: Phase | null;
  /** Set when the chapter is won or lost; play stops there. */
  readonly outcome: Outcome | null;
  /** A help message (an FE8 text id) shown for choosing something that can't be used; A or B closes it. */
  readonly notice?: number;
}

/** FE8's messages for a disabled choice (MenuFrozenHelpBox): Steal with a full inventory, and an item that can't be stolen. */
export const MSG_INVENTORY_FULL = 0x862;
export const MSG_CANT_STEAL = 0x855;

export interface PlayRules extends AiRules {
  readonly width: number;
  readonly height: number;
  /** Where the unit can go this turn and how; its stops are the cells it can end on. */
  searchOf(unit: PlayUnit, state: PlayState, mov?: number): MoveSearch;
  /** Ids of enemies the unit could attack from where it stands, nearest first. */
  targetsOf(unit: PlayUnit, state: PlayState): string[];
  /** The blows of a fight between two units where they stand, and the items they fight with. */
  fight(attacker: PlayUnit, defender: PlayUnit, state: PlayState): Fight;
  /** The experience a fight gives, if any (none if left out). */
  experience?(attacker: PlayUnit, defender: PlayUnit, strikes: readonly Strike[]): ExpAward | null;
  /** Each weapon the unit could attack with from where it stands (its item index), with the foes it reaches, in item order. */
  weaponChoices?(unit: PlayUnit, state: PlayState): { readonly item: number; readonly targets: readonly string[] }[];
  /** The experience using staff `index` gives the unit, if any; less for a staff that missed. */
  staffExperience?(unit: PlayUnit, index: number, missed?: boolean): ExpAward | null;
  /** Whether a status staff hits `target` this time (a random roll against staffAccuracy). */
  statusStaffHits?(unit: PlayUnit, target: PlayUnit): boolean;
  /** Where Rescue brings `target`, beside the user. */
  rescueLanding?(user: PlayUnit, target: PlayUnit, state: PlayState): readonly [number, number];
  /** The squares Warp can send `target` to, as cell indices. */
  warpCells?(user: PlayUnit, target: PlayUnit, state: PlayState): number[];
  /** What the unit can do with its item `index` (none if left out). */
  itemUse?(unit: PlayUnit, index: number): ItemUse;
  /** Whether the unit's item `index` can be stolen (IsItemStealable); none can if left out. */
  stealable?(unit: PlayUnit, index: number): boolean;
  /** The experience stealing gives the unit, if any. */
  stealExperience?(unit: PlayUnit): ExpAward | null;
}

/** A heal with a staff: played like a fight with no blows, then its experience; finishBattle heals. */
function healBattle(healer: PlayUnit, target: PlayUnit, heal: PlannedHeal, rules: PlayRules): Battle {
  return {
    attacker: healer.id,
    defender: target.id,
    strikes: [],
    attackerItem: heal.item,
    defenderItem: null,
    heal: heal.heal,
    ...(heal.fortify ? { healed: heal.fortify } : {}),
    exp: rules.staffExperience?.(healer, heal.item) ?? null,
  };
}

/** A staff that gives a status (ExecStatusStaff): played like a fight with no blows, hitting or not, then its experience. */
function statusBattle(user: PlayUnit, target: PlayUnit, item: number, kind: StatusKind, rules: PlayRules): Battle {
  const hit = rules.statusStaffHits?.(user, target) ?? false;
  return { attacker: user.id, defender: target.id, strikes: [], attackerItem: item, defenderItem: null, inflict: { kind, hit }, exp: rules.staffExperience?.(user, item, !hit) ?? null };
}

/** Restore or Barrier (ExecRestore, ExecBarrierStaff): played like a fight with no blows, then its experience. */
function supportBattle(user: PlayUnit, target: PlayUnit, item: number, support: 'restore' | 'barrier', rules: PlayRules): Battle {
  return { attacker: user.id, defender: target.id, strikes: [], attackerItem: item, defenderItem: null, support, exp: rules.staffExperience?.(user, item) ?? null };
}

/** Warp or Rescue (ExecWarpStaff, ExecRescueStaff): played like a fight with no blows, then its experience; finishBattle moves the ally. */
function relocateBattle(user: PlayUnit, target: PlayUnit, item: number, to: readonly [number, number], rules: PlayRules): Battle {
  return { attacker: user.id, defender: target.id, strikes: [], attackerItem: item, defenderItem: null, relocate: to, exp: rules.staffExperience?.(user, item) ?? null };
}

/** Rescue on `target`: it lands where rescueLanding says. */
function rescueBattle(user: PlayUnit, target: PlayUnit, item: number, state: PlayState, rules: PlayRules): Battle {
  return relocateBattle(user, target, item, rules.rescueLanding?.(user, target, state) ?? target.at, rules);
}

/** Fortify, chosen from the Staff menu: it heals every ally it reaches at once (SetStaffUseAction, ExecFortify). */
function fortifyBattle(view: PlayView, healer: PlayUnit, staff: StaffChoice, rules: PlayRules): PlayView {
  return { ...view, action: null, battle: healBattle(healer, healer, { target: healer.id, item: staff.item, heal: staff.heal, fortify: staff.targets }, rules) };
}

/** A steal: played like a fight with no blows, then its experience; finishBattle moves the item. */
function stealBattle(thief: PlayUnit, target: PlayUnit, item: number, exp: ExpAward | null = null): Battle {
  return { attacker: thief.id, defender: target.id, strikes: [], attackerItem: null, defenderItem: null, steal: item, exp };
}

/** A fight between two units, with the experience it gives. */
function startBattle(attacker: PlayUnit, defender: PlayUnit, state: PlayState, rules: PlayRules): Battle {
  const fight = rules.fight(attacker, defender, state);
  return { attacker: attacker.id, defender: defender.id, ...fight, exp: rules.experience?.(attacker, defender, fight.strikes) ?? null };
}

/** The cursor starts on the first player unit, as FE starts it on the lord. */
export function startView(state: PlayState): PlayView {
  const first = state.units.find((u) => u.team === 'player') ?? state.units[0];
  return { state, cursor: first ? first.at : [0, 0], selected: null, route: null, walking: null, action: null, battle: null, phase: 'player', queue: [], banner: null, outcome: null };
}

const unitById = (state: PlayState, id: string | null) => (id === null ? undefined : state.units.find((u) => u.id === id));

export function selectedUnit(view: PlayView): PlayUnit | undefined {
  return unitById(view.state, view.selected);
}

/** A player unit that hasn't acted this turn, and isn't asleep or berserk, can be moved; anything else only shows its range. */
export function canMove(unit: PlayUnit | undefined): boolean {
  return !!unit && unit.team === 'player' && !unit.moved && !cannotAct(unit);
}

/** Player input is ignored while a unit walks, a battle plays, a banner shows, or the computer has the turn. */
const busy = (view: PlayView) => !!view.walking || !!view.battle || !!view.banner || view.phase !== 'player' || !!view.berserk || !!view.outcome;

/** The search for the unit being moved, if one is selected and can still move. */
function moving(view: PlayView, rules: PlayRules): { unit: PlayUnit; search: MoveSearch } | null {
  const unit = selectedUnit(view);
  return unit && canMove(unit) ? { unit, search: rules.searchOf(unit, view.state) } : null;
}

export function menuOptions(view: PlayView, rules: PlayRules): MenuOption[] {
  const unit = view.action ? unitById(view.state, view.action.unit) : undefined;
  if (!unit) return [];
  const options: MenuOption[] = [];
  // Seize comes first, as in FE8, for the lord standing on the square (UnitActionMenu_CanSeize).
  const goal = view.state.goal;
  if (goal?.kind === 'seize' && goal.lord === unit.id && goal.at && goal.at[0] === unit.at[0] && goal.at[1] === unit.at[1]) options.push('seize');
  if (rules.targetsOf(unit, view.state).length) options.push('attack');
  if (rules.staffChoices?.(unit, view.state).length) options.push('staff');
  if (stealTargets(view.state, unit, rules).length) options.push('steal');
  if (unit.items.length) options.push('item');
  if (tradePartners(view.state, unit).length) options.push('trade');
  options.push('wait');
  return options;
}

/**
 * Whether a menu option shows but can't be chosen (MENU_DISABLED): Steal with a full inventory
 * (StealCommandUsability).
 */
export function optionDisabled(view: PlayView, option: MenuOption): boolean {
  const unit = view.action ? unitById(view.state, view.action.unit) : undefined;
  return option === 'steal' && !!unit && unit.items.length >= UNIT_ITEM_COUNT;
}

/**
 * Enemies the unit can steal from (MakeTargetListForSteal, AddAsTarget_IfCanStealFrom): if its class
 * can steal, those next to it, no faster than it (Spd), carrying an item that can be stolen.
 */
export function stealTargets(state: PlayState, unit: PlayUnit, rules: PlayRules): string[] {
  if (!rules.steals?.(unit)) return [];
  return state.units
    .filter((o) => o.team === 'enemy' && Math.abs(o.at[0] - unit.at[0]) + Math.abs(o.at[1] - unit.at[1]) === 1 && unit.stats.spd >= o.stats.spd)
    .filter((o) => o.items.some((_, i) => rules.stealable?.(o, i)))
    .map((o) => o.id);
}

/** Units the unit can trade with (TryAddUnitToTradeTargetList): next to it, on its side, not berserk, one of the two carrying something. */
export function tradePartners(state: PlayState, unit: PlayUnit): string[] {
  return state.units
    .filter((o) => o.id !== unit.id && o.team === unit.team && o.status?.kind !== 'berserk' && Math.abs(o.at[0] - unit.at[0]) + Math.abs(o.at[1] - unit.at[1]) === 1 && (o.items.length > 0 || unit.items.length > 0))
    .map((o) => o.id);
}

/** Slots per side in the trade window. */
export const TRADE_SLOTS = UNIT_ITEM_COUNT;

/** Whether trade slot `slot` can be chosen: one holding an item, or the first empty one of a side with room. */
export function tradeSlotOpen(state: PlayState, unit: string, partner: string, slot: number): boolean {
  const side = unitById(state, slot < TRADE_SLOTS ? unit : partner);
  const i = slot % TRADE_SLOTS;
  return !!side && (i < side.items.length || (i === side.items.length && i < TRADE_SLOTS));
}

/**
 * A slot chosen in the trade window: picks an item, or with one picked from the other side, trades
 * them (or moves it into an empty slot). Choosing on the same side picks again.
 */
export function chooseTradeSlot(view: PlayView, slot: number): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'trade' || !tradeSlotOpen(view.state, a.unit, a.partner, slot)) return view;
  const sideOf = (k: number) => (k < TRADE_SLOTS ? a.unit : a.partner);
  if (a.picked === null || sideOf(a.picked) === sideOf(slot)) {
    const side = unitById(view.state, sideOf(slot))!;
    return slot % TRADE_SLOTS < side.items.length ? { ...view, action: { ...a, index: slot, picked: slot } } : view;
  }
  const state = tradeItems(view.state, sideOf(a.picked), a.picked % TRADE_SLOTS, sideOf(slot), slot % TRADE_SLOTS);
  return { ...view, state, action: { ...a, index: slot, picked: null, locked: true } };
}

/**
 * What the item menu offers for the highlighted item: Equip for a weapon the unit can use, Use for a
 * healing item while the unit is hurt (as CanUnitUseHealItem) or a booster that would raise something
 * (CanUnitUseStatGainItem), and Discard.
 */
export function itemOptions(view: PlayView, rules: PlayRules): ItemOption[] {
  const a = view.action;
  if (a?.kind !== 'item') return [];
  const unit = unitById(view.state, a.unit);
  if (!unit || a.item >= unit.items.length) return [];
  const can = rules.itemUse?.(unit, a.item) ?? { equip: false, heal: 0 };
  const options: ItemOption[] = [];
  if (can.equip) options.push('equip');
  if ((can.heal > 0 && unit.hp < unit.stats.hp) || can.boost) options.push('use');
  options.push('discard');
  return options;
}

/** Back to the action menu with `option` highlighted (or the first if it's gone). */
function backToMenu(view: PlayView, unit: string, from: readonly [number, number], rules: PlayRules, option: MenuOption): PlayView {
  const menu: PlayView = { ...view, action: { kind: 'menu', unit, from, index: 0 } };
  return { ...menu, action: { kind: 'menu', unit, from, index: Math.max(0, menuOptions(menu, rules).indexOf(option)) } };
}

function openMenu(view: PlayView, unit: string, from: readonly [number, number]): PlayView {
  return { ...view, selected: null, route: null, action: { kind: 'menu', unit, from, index: 0 } };
}

/**
 * Moves the cursor to (x, y), clamped to the map. While a unit is being moved the cursor only goes
 * where the unit can reach (its blue squares, plus friends standing inside its range); anywhere else
 * it stays put, so a held direction stops at the edge of the range with the arrow still showing.
 */
export function cursorTo(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  if (busy(view) || view.action) return view;
  const cx = Math.min(Math.max(0, x), rules.width - 1);
  const cy = Math.min(Math.max(0, y), rules.height - 1);
  if (cx === view.cursor[0] && cy === view.cursor[1]) return view;
  const m = moving(view, rules);
  if (!m) return { ...view, cursor: [cx, cy] };
  const cell = cy * rules.width + cx;
  if (!m.search.reached.has(cell)) return view;
  return { ...view, cursor: [cx, cy], route: followCursor(m.search, view.route ?? [m.search.start], cell) };
}

/** A D-pad press: moves the cursor, or the highlight in the action menu, or the chosen target. */
export function moveCursor(view: PlayView, dx: number, dy: number, rules: PlayRules): PlayView {
  if (busy(view) || view.notice !== undefined) return view;
  const a = view.action;
  if (a?.kind === 'menu' || a?.kind === 'items' || a?.kind === 'item' || a?.kind === 'weapon' || a?.kind === 'steal') {
    const n =
      a.kind === 'menu'
        ? menuOptions(view, rules).length
        : a.kind === 'item'
          ? itemOptions(view, rules).length
          : a.kind === 'weapon'
            ? weaponChoices(view, rules).length
            : (unitById(view.state, a.kind === 'steal' ? a.target : a.unit)?.items.length ?? 0);
    return dy && n ? { ...view, action: { ...a, index: (a.index + dy + n) % n } } : view;
  }
  if (a?.kind === 'trade') {
    // Up and down within a side, left and right between them (to the same row or the nearest open one above).
    const open = (k: number) => tradeSlotOpen(view.state, a.unit, a.partner, k);
    const row = a.index % TRADE_SLOTS;
    const side = a.index < TRADE_SLOTS ? 0 : TRADE_SLOTS;
    if (dx) {
      const other = side ? 0 : TRADE_SLOTS;
      for (let r = row; r >= 0; r--) if (open(other + r)) return { ...view, action: { ...a, index: other + r } };
      return view;
    }
    for (let i = 1; dy && i <= TRADE_SLOTS; i++) {
      const k = side + (((row + dy * i) % TRADE_SLOTS) + TRADE_SLOTS) % TRADE_SLOTS;
      if (open(k)) return { ...view, action: { ...a, index: k } };
    }
    return view;
  }
  if (a?.kind === 'warp') {
    const x = Math.min(Math.max(0, view.cursor[0] + dx), rules.width - 1);
    const y = Math.min(Math.max(0, view.cursor[1] + dy), rules.height - 1);
    return { ...view, cursor: [x, y] };
  }
  if (a?.kind === 'target') {
    const n = a.targets.length;
    const index = (a.index + (dx + dy > 0 ? 1 : -1) + n) % n;
    const target = unitById(view.state, a.targets[index]!);
    return { ...view, action: { ...a, index }, cursor: target ? target.at : view.cursor };
  }
  return cursorTo(view, view.cursor[0] + dx, view.cursor[1] + dy, rules);
}

/** A tap on a square: moves the cursor there and presses A. Ignored outside the reach of a unit being moved. */
export function tapAt(view: PlayView, x: number, y: number, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  if (view.notice !== undefined) return closeNotice(view);
  const a = view.action;
  if (a?.kind === 'target') {
    // Tap a target to choose it; tap it again to attack.
    const index = a.targets.findIndex((id) => {
      const t = unitById(view.state, id);
      return t && t.at[0] === x && t.at[1] === y;
    });
    if (index < 0) return view;
    if (index === a.index) return pressA(view, rules);
    return { ...view, action: { ...a, index }, cursor: [x, y] };
  }
  if (a?.kind === 'warp') {
    // Tap a square to put the cursor there; tap it again to warp.
    if (view.cursor[0] === x && view.cursor[1] === y) return pressA(view, rules);
    return { ...view, cursor: [x, y] };
  }
  if (a) return view;
  const moved = cursorTo(view, x, y, rules);
  if (moved.cursor[0] !== x || moved.cursor[1] !== y) return view;
  return pressA(moved, rules);
}

/** Picks an option in the action menu, as A does on the highlighted one. */
export function chooseOption(view: PlayView, option: MenuOption, rules: PlayRules): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'menu') return view;
  const unit = unitById(view.state, a.unit);
  if (!unit) return view;
  if (option === 'wait') return { ...view, state: finishAction(view.state, unit.id), action: null };
  if (option === 'seize') {
    const state = seize(view.state, unit.id);
    return { ...view, state, action: null, outcome: outcomeOf(state) };
  }
  if (option === 'item') return unit.items.length ? { ...view, action: { kind: 'items', unit: unit.id, from: a.from, index: 0 } } : view;
  if (option === 'steal') {
    // With a full inventory, FE8 only says so (StealCommandEffect).
    if (optionDisabled(view, option)) return { ...view, notice: MSG_INVENTORY_FULL };
    const targets = stealTargets(view.state, unit, rules);
    const first = unitById(view.state, targets[0] ?? null);
    if (!first) return view;
    return { ...view, action: { kind: 'target', unit: unit.id, from: a.from, targets, index: 0, steal: true, locked: a.locked }, cursor: first.at };
  }
  if (option === 'trade') {
    const partners = tradePartners(view.state, unit);
    const first = unitById(view.state, partners[0] ?? null);
    if (!first) return view;
    return { ...view, action: { kind: 'target', unit: unit.id, from: a.from, targets: partners, index: 0, trade: true, locked: a.locked }, cursor: first.at };
  }
  if (option === 'staff') {
    const staves = rules.staffChoices?.(unit, view.state) ?? [];
    if (staves.length > 1) return { ...view, action: { kind: 'weapon', unit: unit.id, from: a.from, index: 0, staff: true } };
    if (staves[0]?.fortify) return fortifyBattle(view, unit, staves[0], rules);
    return staves[0] ? healTargets(view, unit.id, a.from, staves[0]) : view;
  }
  // With more than one weapon that reaches a foe, choose the weapon first, as in FE8.
  if ((rules.weaponChoices?.(unit, view.state).length ?? 0) > 1) return { ...view, action: { kind: 'weapon', unit: unit.id, from: a.from, index: 0 } };
  const targets = rules.targetsOf(unit, view.state);
  const first = unitById(view.state, targets[0] ?? null);
  if (!first) return view;
  return { ...view, action: { kind: 'target', unit: unit.id, from: a.from, targets, index: 0 }, cursor: first.at };
}

/** The weapons (or for healing, staves) the unit choosing one could use. */
export function weaponChoices(view: PlayView, rules: PlayRules): { readonly item: number; readonly targets: readonly string[] }[] {
  const a = view.action;
  const unit = a ? unitById(view.state, a.unit) : undefined;
  if (!unit) return [];
  if (a?.kind === 'weapon' && a.staff) return rules.staffChoices?.(unit, view.state) ?? [];
  return rules.weaponChoices ? rules.weaponChoices(unit, view.state) : [];
}

/** Choosing which ally to heal with a staff. */
function healTargets(view: PlayView, unit: string, from: readonly [number, number], staff: StaffChoice): PlayView {
  const first = unitById(view.state, staff.targets[0] ?? null);
  if (!first) return view;
  return { ...view, action: { kind: 'target', unit, from, targets: staff.targets, index: 0, staff }, cursor: first.at };
}

/**
 * Picks choice `index`: a weapon is equipped (WeaponSelectMenu_Selected) and the unit chooses among the
 * foes it reaches; a staff goes straight to choosing whom to heal.
 */
export function chooseWeapon(view: PlayView, index: number, rules: PlayRules): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'weapon') return view;
  if (a.staff) {
    const unit = unitById(view.state, a.unit);
    const staff = unit ? rules.staffChoices?.(unit, view.state)[index] : undefined;
    if (unit && staff?.fortify) return fortifyBattle(view, unit, staff, rules);
    return staff ? healTargets(view, a.unit, a.from, staff) : view;
  }
  const choice = weaponChoices(view, rules)[index];
  const first = unitById(view.state, choice?.targets[0] ?? null);
  if (!choice || !first) return view;
  const state = equipItem(view.state, a.unit, choice.item);
  return { ...view, state, action: { kind: 'target', unit: a.unit, from: a.from, targets: choice.targets, index: 0 }, cursor: first.at };
}

/** Steals the target's item `index` if it can be stolen (StealItemMenuCommand_Effect), ending the thief's action. */
export function chooseStealItem(view: PlayView, index: number, rules: PlayRules): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'steal') return view;
  const thief = unitById(view.state, a.unit);
  const target = unitById(view.state, a.target);
  if (!thief || !target || index >= target.items.length) return view;
  // StealItemMenuCommand_Effect: weapons and staves can't be stolen, and FE8 says so.
  if (!rules.stealable?.(target, index)) return { ...view, notice: MSG_CANT_STEAL };
  return { ...view, action: null, battle: stealBattle(thief, target, index, rules.stealExperience?.(thief) ?? null) };
}

/** Picks an item in the item menu, opening what can be done with it. */
export function chooseItem(view: PlayView, index: number): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'items') return view;
  const unit = unitById(view.state, a.unit);
  if (!unit || index >= unit.items.length) return view;
  return { ...view, action: { kind: 'item', unit: a.unit, from: a.from, item: index, index: 0 } };
}

/**
 * Does `option` with the chosen item: Equip moves it to the top and goes back to the items; Use heals
 * or boosts and ends the unit's action, as in FE8; Discard drops it and goes back to the items (or the action
 * menu once none are left).
 */
export function chooseItemOption(view: PlayView, option: ItemOption, rules: PlayRules): PlayView {
  const a = view.action;
  if (busy(view) || a?.kind !== 'item' || !itemOptions(view, rules).includes(option)) return view;
  const unit = unitById(view.state, a.unit);
  if (!unit) return view;
  if (option === 'use') {
    const use = rules.itemUse?.(unit, a.item);
    const used = use?.boost ? boostUnit(view.state, unit.id, a.item, use.boost.stats, use.boost.movBonus) : useHealItem(view.state, unit.id, a.item, use?.heal ?? 0);
    return { ...view, state: finishAction(used, unit.id), action: null };
  }
  const state = option === 'equip' ? equipItem(view.state, unit.id, a.item) : discardItem(view.state, unit.id, a.item);
  const left = unitById(state, unit.id)?.items.length ?? 0;
  if (!left) return backToMenu({ ...view, state }, unit.id, a.from, rules, 'wait');
  return { ...view, state, action: { kind: 'items', unit: unit.id, from: a.from, index: option === 'equip' ? 0 : Math.min(a.item, left - 1) } };
}

/** The help message closes. */
export function closeNotice(view: PlayView): PlayView {
  const { notice: _closed, ...rest } = view;
  return rest;
}

export function pressA(view: PlayView, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  if (view.notice !== undefined) return closeNotice(view);
  const a = view.action;
  if (a?.kind === 'menu') {
    const option = menuOptions(view, rules)[a.index];
    return option ? chooseOption(view, option, rules) : view;
  }
  if (a?.kind === 'items') return chooseItem(view, a.index);
  if (a?.kind === 'warp') {
    // WarpSelect_OnIdle: only a square in range can be chosen.
    const user = unitById(view.state, a.unit);
    const target = unitById(view.state, a.target);
    const cell = view.cursor[1] * rules.width + view.cursor[0];
    if (!user || !target || !a.cells.includes(cell)) return view;
    return { ...view, action: null, battle: relocateBattle(user, target, a.item, view.cursor, rules) };
  }
  if (a?.kind === 'steal') return chooseStealItem(view, a.index, rules);
  if (a?.kind === 'trade') return chooseTradeSlot(view, a.index);
  if (a?.kind === 'weapon') return chooseWeapon(view, a.index, rules);
  if (a?.kind === 'item') {
    const option = itemOptions(view, rules)[a.index];
    return option ? chooseItemOption(view, option, rules) : view;
  }
  if (a?.kind === 'target') {
    const attacker = unitById(view.state, a.unit);
    const defender = unitById(view.state, a.targets[a.index] ?? null);
    if (!attacker || !defender) return view;
    if (a.trade) return { ...view, action: { kind: 'trade', unit: attacker.id, from: a.from, partner: defender.id, index: 0, picked: null, locked: a.locked } };
    if (a.steal) return { ...view, action: { kind: 'steal', unit: attacker.id, from: a.from, target: defender.id, index: 0, locked: a.locked } };
    if (a.staff?.move === 'rescue') return { ...view, action: null, battle: rescueBattle(attacker, defender, a.staff.item, view.state, rules) };
    if (a.staff?.move === 'warp') {
      // WarpSelect: the cursor picks one of the squares in range, starting on the ally.
      const cells = rules.warpCells?.(attacker, defender, view.state) ?? [];
      return { ...view, action: { kind: 'warp', unit: attacker.id, from: a.from, target: defender.id, item: a.staff.item, cells }, cursor: defender.at };
    }
    if (a.staff?.support) return { ...view, action: null, battle: supportBattle(attacker, defender, a.staff.item, a.staff.support, rules) };
    if (a.staff?.status) return { ...view, action: null, battle: statusBattle(attacker, defender, a.staff.item, a.staff.status, rules) };
    if (a.staff) return { ...view, action: null, battle: healBattle(attacker, defender, { target: defender.id, item: a.staff.item, heal: a.staff.heal }, rules) };
    return { ...view, action: null, battle: startBattle(attacker, defender, view.state, rules) };
  }
  const [x, y] = view.cursor;
  const here = unitAt(view.state, x, y);
  const m = moving(view, rules);
  if (m) {
    // Move into range (the unit's own square opens the menu where it stands); anywhere else does nothing, as in FE.
    const cell = y * rules.width + x;
    if (!m.search.stops.has(cell)) return view;
    const from = m.unit.at;
    if (cell === m.search.start) return openMenu(view, m.unit.id, from);
    const route = view.route && view.route[view.route.length - 1] === cell ? view.route : (shortestRoute(m.search, cell) ?? [m.search.start, cell]);
    return { ...view, state: moveUnit(view.state, m.unit.id, [x, y]), selected: null, route: null, walking: { id: m.unit.id, route, from } };
  }
  if (here && here.id !== view.selected) {
    return { ...view, selected: here.id, route: canMove(here) ? [here.at[1] * rules.width + here.at[0]] : null };
  }
  return { ...view, selected: null, route: null };
}

/**
 * B: from an item's options, back to the items; from the items or targeting, back to the menu; from the menu, undo the move (the unit goes back and is picked
 * up again with the arrow to where it was); otherwise cancel the selection and bring the cursor back.
 */
export function pressB(view: PlayView, rules: PlayRules): PlayView {
  if (busy(view)) return view;
  if (view.notice !== undefined) return closeNotice(view);
  const a = view.action;
  if (a?.kind === 'item') return { ...view, action: { kind: 'items', unit: a.unit, from: a.from, index: a.item } };
  if (a?.kind === 'trade') {
    if (a.picked !== null) return { ...view, action: { ...a, picked: null } };
    const unit = unitById(view.state, a.unit);
    const menu = backToMenu(view, a.unit, a.from, rules, 'trade');
    return { ...menu, action: menu.action?.kind === 'menu' ? { ...menu.action, locked: a.locked } : menu.action, cursor: unit ? unit.at : view.cursor };
  }
  if (a?.kind === 'items') return backToMenu(view, a.unit, a.from, rules, 'item');
  if (a?.kind === 'warp') {
    // Back to choosing whom to warp.
    const unit = unitById(view.state, a.unit);
    const staff = unit ? rules.staffChoices?.(unit, view.state).find((s) => s.item === a.item) : undefined;
    return staff ? healTargets(view, a.unit, a.from, staff) : backToMenu(view, a.unit, a.from, rules, 'staff');
  }
  // From the steal menu, back to the action menu, as FE8's ItemMenu_ButtonBPressed does.
  if (a?.kind === 'steal') {
    const unit = unitById(view.state, a.unit);
    const menu = backToMenu(view, a.unit, a.from, rules, 'steal');
    return { ...menu, action: menu.action?.kind === 'menu' ? { ...menu.action, locked: a.locked } : menu.action, cursor: unit ? unit.at : view.cursor };
  }
  if (a?.kind === 'weapon') return backToMenu(view, a.unit, a.from, rules, a.staff ? 'staff' : 'attack');
  if (a?.kind === 'target') {
    const unit = unitById(view.state, a.unit);
    const menu = backToMenu(view, a.unit, a.from, rules, a.trade ? 'trade' : a.staff ? 'staff' : a.steal ? 'steal' : 'attack');
    return { ...menu, action: menu.action?.kind === 'menu' ? { ...menu.action, locked: a.locked } : menu.action, cursor: unit ? unit.at : view.cursor };
  }
  if (a?.kind === 'menu') {
    // After a trade the move stays, as in FE8.
    if (a.locked) return view;
    const unit = unitById(view.state, a.unit);
    if (!unit) return { ...view, action: null };
    const dest = unit.at;
    const state = moveUnit(view.state, unit.id, a.from);
    const back = unitById(state, unit.id)!;
    const search = rules.searchOf(back, state);
    const route = shortestRoute(search, dest[1] * rules.width + dest[0]) ?? [search.start];
    return { ...view, state, action: null, selected: unit.id, route, cursor: dest };
  }
  const sel = selectedUnit(view);
  return sel ? { ...view, cursor: sel.at, selected: null, route: null } : view;
}

/**
 * The walk is over. On the player's turn the action menu opens for the unit; a computer-controlled
 * unit attacks the foe it walked up to, or ends its turn.
 */
export function finishWalk(view: PlayView, rules: PlayRules): PlayView {
  const w = view.walking;
  if (!w) return view;
  const done = { ...view, walking: null };
  if (view.phase === 'player' && !view.berserk) return openMenu(done, w.id, w.from);
  const unit = unitById(view.state, w.id);
  const ally = unitById(view.state, w.thenHeal?.target ?? null);
  if (unit && ally && w.thenHeal) return { ...done, cursor: unit.at, battle: healBattle(unit, ally, w.thenHeal, rules) };
  if (unit && w.thenUse) return { ...done, cursor: unit.at, state: finishAction(useHealItem(view.state, unit.id, w.thenUse.item, w.thenUse.heal), unit.id) };
  const robbed = unitById(view.state, w.thenSteal?.target ?? null);
  if (unit && robbed && w.thenSteal) return { ...done, cursor: unit.at, battle: stealBattle(unit, robbed, w.thenSteal.item) };
  const rescued = unitById(view.state, w.thenRescue?.target ?? null);
  if (unit && rescued && w.thenRescue) return { ...done, cursor: unit.at, battle: rescueBattle(unit, rescued, w.thenRescue.item, view.state, rules) };
  const restored = unitById(view.state, w.thenRestore?.target ?? null);
  if (unit && restored && w.thenRestore) return { ...done, cursor: unit.at, battle: supportBattle(unit, restored, w.thenRestore.item, 'restore', rules) };
  const struck = unitById(view.state, w.thenInflict?.target ?? null);
  if (unit && struck && w.thenInflict) return { ...done, cursor: unit.at, battle: statusBattle(unit, struck, w.thenInflict.item, w.thenInflict.kind, rules) };
  const target = unitById(view.state, w.then ?? null);
  if (unit && target) return { ...done, cursor: unit.at, battle: startBattle(unit, target, view.state, rules) };
  return { ...done, state: finishAction(view.state, w.id), cursor: unit ? unit.at : view.cursor };
}


/** Every unit of `team` with its healing setting brought up to date (isHealing). */
function markHealing(state: PlayState, team: PlayUnit['team']): PlayState {
  return { ...state, units: state.units.map((u) => (u.team !== team || isHealing(u) === !!u.healing ? u : { ...u, healing: isHealing(u) })) };
}

/**
 * A computer phase's start: its units' statuses tick (TickActiveFactionTurn), their healing settings
 * update, then their order, leaving out units asleep or berserk (UpdateAllPhaseHealingAIStatus, CpOrder).
 */
function phaseQueue(state: PlayState, team: PlayUnit['team'], rules: PlayRules): { state: PlayState; queue: string[] } {
  const marked = markHealing(tickStatuses(state, team), team);
  return { state: marked, queue: phaseOrder(marked.units.filter((u) => u.team === team && !cannotAct(u)), marked, rules) };
}

/** A side's berserk units that haven't acted, in unit order (CpOrderBerserkInit). */
function berserkQueue(state: PlayState, team: PlayUnit['team']): string[] {
  return state.units.filter((u) => u.team === team && u.status?.kind === 'berserk' && !u.moved).map((u) => u.id);
}

/** The enemy phase begins: every unit is ready again. */
function enemyPhase(view: PlayView, rules: PlayRules): PlayView {
  const { state, queue } = phaseQueue(readyAll(view.state), 'enemy', rules);
  return { ...view, state, selected: null, route: null, phase: 'enemy', queue, banner: 'enemy', berserk: false };
}

/** End turn: the player's berserk units act, then the enemy phase begins. */
export function endPlayerTurn(view: PlayView, rules: PlayRules): PlayView {
  if (busy(view) || view.action) return view;
  const berserkers = berserkQueue(view.state, 'player');
  if (berserkers.length) return { ...view, selected: null, route: null, berserk: true, queue: berserkers };
  return enemyPhase(view, rules);
}

/**
 * One step of a computer phase: clears the banner, or starts the next unit's action (a walk, an attack
 * or waiting), or moves on to the next phase. Does nothing while a walk or battle is still playing.
 */
export function stepAI(view: PlayView, rules: PlayRules): PlayView {
  if (view.walking || view.battle || view.outcome) return view;
  if (view.banner) return { ...view, banner: null };
  if (view.phase === 'player' && !view.berserk) return view;
  const [next, ...rest] = view.queue;
  if (next === undefined) {
    // The side's own phase is over: its berserk units act, then the next side's phase.
    const berserkers = view.berserk ? [] : berserkQueue(view.state, view.phase);
    if (berserkers.length) return { ...view, berserk: true, queue: berserkers };
    if (view.phase === 'player') return enemyPhase(view, rules);
    if (view.phase === 'enemy') {
      const { state, queue } = phaseQueue(readyAll(view.state), 'ally', rules);
      return { ...view, state, phase: 'ally', queue, banner: queue.length ? 'ally' : null, berserk: false };
    }
    const state = tickStatuses(endTurn(view.state), 'player');
    const first = state.units.find((u) => u.team === 'player');
    // A Survive goal is won as the turn after the last begins.
    const outcome = outcomeOf(state);
    return { ...view, state, phase: 'player', queue: [], banner: outcome ? null : 'player', cursor: first ? first.at : view.cursor, outcome, berserk: false };
  }
  const before = unitById(view.state, next);
  if (!before) return { ...view, queue: rest };
  // FE8 updates its side's healing settings before each unit decides (UpdateAllPhaseHealingAIStatus).
  const marked = markHealing(view.state, before.team);
  const plan = planAction(unitById(marked, next)!, marked, rules, !!view.berserk);
  // The weapon it attacks with is equipped, as FE8's action does.
  const armed = plan.attack && plan.attackItem !== undefined ? equipItem(marked, next, plan.attackItem) : marked;
  const unit = unitById(armed, next)!;
  const start = unit.at[1] * rules.width + unit.at[0];
  if (plan.to !== start) {
    const to = [plan.to % rules.width, Math.floor(plan.to / rules.width)] as const;
    return { ...view, queue: rest, cursor: unit.at, state: moveUnit(armed, unit.id, to), walking: { id: unit.id, route: plan.route, from: unit.at, then: plan.attack, thenHeal: plan.heal, thenUse: plan.useItem, thenSteal: plan.steal, thenInflict: plan.inflict, thenRestore: plan.restore, thenRescue: plan.rescue } };
  }
  if (plan.useItem) return { ...view, queue: rest, cursor: unit.at, state: finishAction(useHealItem(marked, unit.id, plan.useItem.item, plan.useItem.heal), unit.id) };
  const ally = unitById(armed, plan.heal?.target ?? null);
  if (ally && plan.heal) return { ...view, state: armed, queue: rest, cursor: unit.at, battle: healBattle(unit, ally, plan.heal, rules) };
  const robbed = unitById(armed, plan.steal?.target ?? null);
  if (robbed && plan.steal) return { ...view, state: armed, queue: rest, cursor: unit.at, battle: stealBattle(unit, robbed, plan.steal.item) };
  const rescued = unitById(armed, plan.rescue?.target ?? null);
  if (rescued && plan.rescue) return { ...view, state: armed, queue: rest, cursor: unit.at, battle: rescueBattle(unit, rescued, plan.rescue.item, armed, rules) };
  const restored = unitById(armed, plan.restore?.target ?? null);
  if (restored && plan.restore) return { ...view, state: armed, queue: rest, cursor: unit.at, battle: supportBattle(unit, restored, plan.restore.item, 'restore', rules) };
  const struck = unitById(armed, plan.inflict?.target ?? null);
  if (struck && plan.inflict) return { ...view, state: armed, queue: rest, cursor: unit.at, battle: statusBattle(unit, struck, plan.inflict.item, plan.inflict.kind, rules) };
  const target = unitById(armed, plan.attack);
  if (target) return { ...view, state: armed, queue: rest, cursor: unit.at, battle: startBattle(unit, target, armed, rules) };
  return { ...view, queue: rest, cursor: unit.at, state: finishAction(armed, unit.id) };
}

/** The weapons that broke in a fight: each side's item that ran out of uses (GetItemAfterUse leaves none). */
export function brokenWeapons(state: PlayState, b: Battle): { readonly unit: string; readonly item: string }[] {
  const out: { unit: string; item: string }[] = [];
  for (const [id, index, by] of [
    [b.attacker, b.attackerItem, 'attacker'],
    [b.defender, b.defenderItem, 'defender'],
  ] as const) {
    const unit = unitById(state, id);
    const uses = index === null ? null : unit?.uses[index];
    if (!unit || index === null || uses === null || uses === undefined) continue;
    if (b.strikes.filter((s) => s.by === by && s.used).length >= uses) out.push({ unit: id, item: unit.items[index]! });
  }
  return out;
}

/** The battle has been shown: apply its result and the experience it gave. */
export function finishBattle(view: PlayView): PlayView {
  const b = view.battle;
  if (!b) return view;
  const last = b.strikes[b.strikes.length - 1];
  const spent = (by: 'attacker' | 'defender') => b.strikes.filter((s) => s.by === by && s.used).length;
  let used = view.state;
  if (b.heal !== undefined && b.attackerItem !== null) {
    for (const id of b.healed ?? [b.defender]) used = healUnit(used, id, b.heal);
    used = spendUses(used, b.attacker, b.attackerItem, 1);
  }
  if (b.steal !== undefined) used = stealItem(used, b.attacker, b.defender, b.steal);
  if (b.relocate && b.attackerItem !== null) {
    used = moveUnit(used, b.defender, b.relocate);
    used = spendUses(used, b.attacker, b.attackerItem, 1);
  }
  if (b.support && b.attackerItem !== null) {
    used = b.support === 'restore' ? clearStatus(used, b.defender) : setBarrier(used, b.defender);
    used = spendUses(used, b.attacker, b.attackerItem, 1);
  }
  if (b.inflict && b.attackerItem !== null) {
    if (b.inflict.hit) used = setStatus(used, b.defender, b.inflict.kind);
    used = spendUses(used, b.attacker, b.attackerItem, 1);
  }
  if (b.attackerItem !== null) used = spendUses(used, b.attacker, b.attackerItem, spent('attacker'));
  if (b.defenderItem !== null) used = spendUses(used, b.defender, b.defenderItem, spent('defender'));
  // Without blows (a heal, or a fight nobody could strike in) HP stay as they are now.
  const attacker = unitById(used, b.attacker);
  const defender = unitById(used, b.defender);
  const fought = applyBattle(used, b.attacker, b.defender, last?.attackerHp ?? attacker?.hp ?? 0, last?.defenderHp ?? defender?.hp ?? 0);
  const state = b.exp ? applyExp(fought, b.exp.unit, b.exp.result) : fought;
  const still = unitById(state, b.attacker);
  // The chapter can end with this fight; then the phase and its queue stop where they are.
  return { ...view, state, battle: null, cursor: still ? still.at : view.cursor, outcome: outcomeOf(state), banner: null };
}

/** The arrow to draw: only while it ends under the cursor. */
export function visibleRoute(view: PlayView, rules: PlayRules): readonly number[] | null {
  const r = view.route;
  return r && r.length > 1 && r[r.length - 1] === view.cursor[1] * rules.width + view.cursor[0] ? r : null;
}

/** Walking pace, set in playtesting: between EC's normal (200 ms) and fast (110 ms) speeds. */
export const WALK_MS_PER_SQUARE = 150;

/** Where a walking unit is drawn after `ms`, in squares (fractional between squares), and whether it has arrived. */
export function walkPosition(route: readonly number[], width: number, ms: number, msPerSquare = WALK_MS_PER_SQUARE): { x: number; y: number; done: boolean } {
  const steps = route.length - 1;
  const t = Math.max(0, ms) / msPerSquare;
  const i = Math.min(Math.floor(t), steps);
  const a = route[i]!;
  const b = route[Math.min(i + 1, steps)]!;
  const k = i >= steps ? 0 : t - i;
  const ax = a % width;
  const bx = b % width;
  const ay = Math.floor(a / width);
  const by = Math.floor(b / width);
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, done: t >= steps };
}
