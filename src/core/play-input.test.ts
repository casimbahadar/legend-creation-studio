import { describe, expect, it } from 'vitest';
import type { Stats } from './combat';
import { searchMoves } from './movement';
import { startPlay, type PlayState, type PlayUnit } from './play';
import {
  brokenWeapons,
  canMove,
  chooseWeapon,
  itemOptions,
  endPlayerTurn,
  finishBattle,
  finishWalk,
  menuOptions,
  moveCursor,
  pressA,
  pressB,
  selectedUnit,
  startView,
  stepAI,
  tapAt,
  visibleRoute,
  walkPosition,
  type PlayRules,
  type PlayView,
} from './play-input';
import type { ProjectChapter } from './project';

const STATS: Stats = { hp: 18, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 2, con: 6 };
const chapterWith = (brigandAt: [number, number], extra: ProjectChapter['units'] = []): ProjectChapter => ({
  id: 'c',
  name: 'C',
  map: 'fe8-us/chapter-entry-0',
  goal: 'rout',
  units: [
    { id: 'brigand-1', class: 'brigand', team: 'enemy', level: 1, at: brigandAt },
    { id: 'eirika', class: 'lord-eirika', team: 'player', level: 1, at: [1, 1] },
    ...extra,
  ],
});
const start = (brigandAt: [number, number] = [4, 0], extra: ProjectChapter['units'] = []) =>
  startView(startPlay(chapterWith(brigandAt, extra), () => STATS, (u) => (u.team === 'player' ? 0 : null)));
/** A second player unit out of everyone's reach, so losing Eirika doesn't end the chapter. */
const SETH: ProjectChapter['units'][number] = { id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [0, 2] };

// Open 5x3 field where every step costs 1 and every unit has Mov 1. A unit can attack a foe next to it,
// and every fight is one blow that defeats the defender.
const foesNextTo = (u: PlayUnit, at: readonly [number, number], s: PlayState) =>
  s.units.filter((o) => (o.team === 'enemy') !== (u.team === 'enemy') && Math.abs(o.at[0] - at[0]) + Math.abs(o.at[1] - at[1]) === 1);
const rules: PlayRules = {
  width: 5,
  height: 3,
  searchOf: (u: PlayUnit, s: PlayState, mov = 1) =>
    searchMoves({ width: 5, height: 3, terrain: new Array(15).fill(0) }, () => 1, mov, u.at, (x, y) => {
      const o = s.units.find((p) => p.at[0] === x && p.at[1] === y && p.id !== u.id);
      return !o ? null : (o.team === 'enemy') !== (u.team === 'enemy') ? 'foe' : 'friend';
    }),
  targetsOf: (u, s) => foesNextTo(u, u.at, s).map((o) => o.id),
  targetsAt: foesNextTo,
  forecastAt: () => ({
    attacker: { canAttack: true, damage: 99, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
    defender: { canAttack: true, damage: 1, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
  }),
  fight: (a) => ({ strikes: [{ by: 'attacker', hit: true, crit: false, damage: 99, attackerHp: a.hp, defenderHp: 0, used: true }], attackerItem: null, defenderItem: null }),
};
const eirika = (v: PlayView) => v.state.units.find((u) => u.id === 'eirika')!;
/** Selects Eirika, moves one square right and lets the walk finish. */
const moveRight = (v: PlayView) => finishWalk(pressA(moveCursor(pressA(v, rules), 1, 0, rules), rules), rules);

describe('selecting and moving', () => {
  it('starts the cursor on the first player unit', () => {
    expect(start().cursor).toEqual([1, 1]);
  });

  it('moves the cursor freely when nothing is selected, stopping at the map edge', () => {
    let v = start();
    v = moveCursor(moveCursor(v, -1, 0, rules), -1, 0, rules);
    expect(v.cursor).toEqual([0, 1]);
  });

  it('keeps the cursor inside the reach of a unit being moved', () => {
    let v = pressA(start(), rules);
    v = moveCursor(moveCursor(moveCursor(v, 1, 0, rules), 1, 0, rules), 1, 0, rules);
    expect(v.cursor).toEqual([2, 1]);
    expect(visibleRoute(v, rules)).toEqual([6, 7]);
  });

  it('walks the arrow, then opens the action menu without finishing the turn', () => {
    const walking = pressA(moveCursor(pressA(start(), rules), 1, 0, rules), rules);
    expect(walking.walking).toEqual({ id: 'eirika', route: [6, 7], from: [1, 1] });
    expect(moveCursor(walking, 1, 0, rules)).toBe(walking);
    expect(pressA(walking, rules)).toBe(walking);
    const menu = finishWalk(walking, rules);
    expect(menu.action).toEqual({ kind: 'menu', unit: 'eirika', from: [1, 1], index: 0 });
    expect(menuOptions(menu, rules)).toEqual(['wait']);
    expect(eirika(menu)).toMatchObject({ at: [2, 1], moved: false });
  });

  it('opens the menu straight away when A is pressed on the unit itself', () => {
    const v = pressA(pressA(start(), rules), rules);
    expect(v.walking).toBeNull();
    expect(v.action?.kind).toBe('menu');
  });

  it('finishes the turn with Wait', () => {
    const v = pressA(moveRight(start()), rules);
    expect(v.action).toBeNull();
    expect(eirika(v)).toMatchObject({ at: [2, 1], moved: true });
  });

  it('undoes the move with B in the menu, keeping the arrow to where it was', () => {
    const v = pressB(moveRight(start()), rules);
    expect(v.action).toBeNull();
    expect(eirika(v)).toMatchObject({ at: [1, 1], moved: false });
    expect(v.selected).toBe('eirika');
    expect(v.cursor).toEqual([2, 1]);
    expect(visibleRoute(v, rules)).toEqual([6, 7]);
  });

  it('ignores taps outside the reach of a unit being moved', () => {
    const v = pressA(start(), rules);
    expect(tapAt(v, 3, 1, rules)).toBe(v);
    expect(tapAt(v, 1, 2, rules).walking?.route).toEqual([6, 11]);
  });

  it('cancels a selection with B and returns the cursor to the unit', () => {
    let v = pressA(start(), rules);
    v = pressB(moveCursor(v, 1, 0, rules), rules);
    expect(v.selected).toBeNull();
    expect(v.cursor).toEqual([1, 1]);
  });

  it('shows an enemy range on A and clears it on a second A', () => {
    let v = tapAt(start(), 4, 0, rules);
    expect(selectedUnit(v)?.id).toBe('brigand-1');
    expect(canMove(selectedUnit(v))).toBe(false);
    v = pressA(v, rules);
    expect(v.selected).toBeNull();
  });
});

describe('attacking', () => {
  // The brigand stands at (3,1), next to the square Eirika moves to.
  const menu = () => moveRight(start([3, 1]));

  it('offers Attack when an enemy is in reach, and the D-pad moves the highlight', () => {
    const v = menu();
    expect(menuOptions(v, rules)).toEqual(['attack', 'wait']);
    expect(moveCursor(v, 0, 1, rules).action).toMatchObject({ index: 1 });
    expect(moveCursor(v, 0, -1, rules).action).toMatchObject({ index: 1 });
  });

  it('picks a target, goes back with B, then fights', () => {
    const target = pressA(menu(), rules);
    expect(target.action).toMatchObject({ kind: 'target', targets: ['brigand-1'], index: 0 });
    expect(target.cursor).toEqual([3, 1]);
    expect(pressB(target, rules).action?.kind).toBe('menu');
    const fighting = pressA(target, rules);
    expect(fighting.battle?.strikes).toHaveLength(1);
    expect(pressB(fighting, rules)).toBe(fighting);
    const after = finishBattle(fighting);
    expect(after.battle).toBeNull();
    expect(after.state.units.map((u) => u.id)).toEqual(['eirika']);
    expect(eirika(after)).toMatchObject({ moved: true, hp: 18 });
  });

  it("applies the fight's experience: level, experience and the level-up's gains, current HP kept", () => {
    const up = { hp: 1, str: 1, skl: 0, spd: 0, def: 0, res: 0, lck: 1 };
    const withExp: PlayRules = {
      ...rules,
      experience: (a, _d, strikes) => (a.exp === null ? null : { unit: a.id, level: a.level, exp: a.exp, result: { gain: strikes.length * 40, exp: 20, level: 2, levelUp: up } }),
    };
    const fighting = pressA(pressA(menu(), withExp), withExp);
    expect(fighting.battle?.exp).toMatchObject({ unit: 'eirika', level: 1, exp: 0, result: { gain: 40 } });
    const after = finishBattle(fighting);
    expect(eirika(after)).toMatchObject({ level: 2, exp: 20, hp: 18, stats: { ...STATS, hp: 19, str: 6, lck: 3 } });
  });

  it('spends the uses of the weapons each side fought with', () => {
    const v = startView(
      startPlay(chapterWith([3, 1]), () => STATS, () => null, (item) => (item === 'iron-sword' ? 1 : 30)),
    );
    const armed: PlayView = {
      ...v,
      state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['iron-sword', 'rapier'], uses: [1, 30] } : u)) },
    };
    const withItems: PlayRules = {
      ...rules,
      fight: (a) => ({ strikes: [{ by: 'attacker', hit: true, crit: false, damage: 99, attackerHp: a.hp, defenderHp: 0, used: true }], attackerItem: 0, defenderItem: null }),
    };
    const fighting = pressA(pressA(moveRight(armed), withItems), withItems);
    expect(eirika(finishBattle(fighting))).toMatchObject({ items: ['rapier'], uses: [30] });
  });

  it('tells which weapons a fight broke', () => {
    const v = start([3, 1]);
    const state = { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['rapier'], uses: [1] } : u.id === 'brigand-1' ? { ...u, items: ['iron-axe'], uses: [5] } : u)) };
    const strike = (by: 'attacker' | 'defender', hit: boolean) => ({ by, hit, crit: false, damage: hit ? 3 : 0, attackerHp: 18, defenderHp: 15, used: hit });
    const battle = { attacker: 'eirika', defender: 'brigand-1', attackerItem: 0, defenderItem: 0, exp: null };
    expect(brokenWeapons(state, { ...battle, strikes: [strike('attacker', true), strike('defender', true)] })).toEqual([{ unit: 'eirika', item: 'rapier' }]);
    expect(brokenWeapons(state, { ...battle, strikes: [strike('attacker', false)] })).toEqual([]);
  });

  it('chooses a target by tapping it, and attacks on a second tap', () => {
    const target = pressA(menu(), rules);
    expect(tapAt(target, 0, 0, rules)).toBe(target);
    expect(tapAt(target, 3, 1, rules).battle).not.toBeNull();
  });
});

describe('enemy and ally phases', () => {
  it('runs the enemy phase after End turn, then hands back to the player', () => {
    // The brigand at (3,1) can step to (2,1), next to Eirika at (1,1), and attack.
    let v = endPlayerTurn(start([3, 1], [SETH]));
    expect(v).toMatchObject({ phase: 'enemy', banner: 'enemy', queue: ['brigand-1'] });
    expect(moveCursor(v, 1, 0, rules)).toBe(v);
    v = stepAI(v, rules); // banner cleared
    expect(v.banner).toBeNull();
    v = stepAI(v, rules); // the brigand walks
    expect(v.walking).toMatchObject({ id: 'brigand-1', route: [8, 7], then: 'eirika' });
    expect(stepAI(v, rules)).toBe(v);
    v = finishWalk(v, rules);
    expect(v.battle).toMatchObject({ attacker: 'brigand-1', defender: 'eirika' });
    v = finishBattle(v);
    expect(v.state.units.map((u) => u.id)).toEqual(['brigand-1', 'seth']);
    expect(v.outcome).toBeNull();
    v = stepAI(v, rules); // no allies: straight on to the player phase
    expect(v).toMatchObject({ phase: 'ally', banner: null });
    v = stepAI(v, rules);
    expect(v).toMatchObject({ phase: 'player', banner: 'player' });
    expect(v.state.turn).toBe(2);
    v = stepAI(v, rules);
    expect(v.banner).toBeNull();
  });

  it('lets an enemy with nothing in reach wait where it is', () => {
    let v = stepAI(endPlayerTurn(start([4, 0])), rules);
    v = stepAI(v, rules);
    expect(v.walking).toBeNull();
    expect(v.battle).toBeNull();
    expect(v.state.units.find((u) => u.id === 'brigand-1')).toMatchObject({ at: [4, 0], moved: true });
  });

  it("doesn't end the turn in the middle of an action", () => {
    const menu = moveRight(start());
    expect(endPlayerTurn(menu)).toBe(menu);
  });
});

describe('winning and losing', () => {
  it('wins when the last enemy falls and stops all input', () => {
    // Eirika attacks the brigand next to her; the test rules always defeat the defender.
    let v = pressA(moveRight(start([3, 1])), rules);
    v = finishBattle(pressA(v, rules));
    expect(v.outcome).toEqual({ result: 'victory' });
    expect(moveCursor(v, 1, 0, rules)).toBe(v);
    expect(endPlayerTurn(v)).toBe(v);
    expect(stepAI(v, rules)).toBe(v);
  });

  it('loses when the enemy defeats the last player unit, stopping the enemy phase', () => {
    let v = stepAI(stepAI(endPlayerTurn(start([3, 1])), rules), rules);
    v = finishBattle(finishWalk(v, rules));
    expect(v.outcome).toEqual({ result: 'defeat', fallen: null });
    expect(stepAI(v, rules)).toBe(v);
  });
});

describe('walkPosition', () => {
  // Route along a 5-wide map: (0,0) -> (1,0) -> (1,1).
  const route = [0, 1, 6];
  it('moves one square per 150 ms in a straight line between squares', () => {
    expect(walkPosition(route, 5, 0)).toEqual({ x: 0, y: 0, done: false });
    expect(walkPosition(route, 5, 75)).toEqual({ x: 0.5, y: 0, done: false });
    expect(walkPosition(route, 5, 225)).toEqual({ x: 1, y: 0.5, done: false });
    expect(walkPosition(route, 5, 300)).toEqual({ x: 1, y: 1, done: true });
  });
});

describe('the item menu', () => {
  // Eirika, hurt, carrying a lance first, then a sword and a vulnerary; swords can be equipped, vulneraries heal 10.
  const itemRules: PlayRules = {
    ...rules,
    itemUse: (u, i) => ({ equip: u.items[i] === 'iron-sword', heal: u.items[i] === 'vulnerary' ? 10 : 0 }),
  };
  const withItems = (v: PlayView, hp: number): PlayView => ({
    ...v,
    state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, hp, items: ['iron-lance', 'iron-sword', 'vulnerary'], uses: [45, 46, 3] } : u)) },
  });
  const itemMenu = (hp = 10) => {
    const menu = finishWalk(pressA(moveCursor(pressA(withItems(start(), hp), itemRules), 1, 0, itemRules), itemRules), itemRules);
    expect(menuOptions(menu, itemRules)).toEqual(['item', 'wait']);
    return pressA(menu, itemRules);
  };

  it('lists the items and offers what each can do', () => {
    const items = itemMenu();
    expect(items.action).toMatchObject({ kind: 'items', index: 0 });
    expect(itemOptions(pressA(items, itemRules), itemRules)).toEqual(['discard']);
    const sword = pressA(moveCursor(items, 0, 1, itemRules), itemRules);
    expect(itemOptions(sword, itemRules)).toEqual(['equip', 'discard']);
    const vulnerary = pressA(moveCursor(items, 0, -1, itemRules), itemRules);
    expect(itemOptions(vulnerary, itemRules)).toEqual(['use', 'discard']);
    // At full HP a vulnerary can't be used.
    expect(itemOptions(pressA(moveCursor(itemMenu(18), 0, -1, itemRules), itemRules), itemRules)).toEqual(['discard']);
  });

  it('equips a weapon by moving it to the top, back in the items', () => {
    const equipped = pressA(pressA(moveCursor(itemMenu(), 0, 1, itemRules), itemRules), itemRules);
    expect(eirika(equipped)).toMatchObject({ items: ['iron-sword', 'iron-lance', 'vulnerary'], uses: [46, 45, 3], moved: false });
    expect(equipped.action).toMatchObject({ kind: 'items', index: 0 });
  });

  it('uses a vulnerary: heals up to 10, spends a use and ends the action', () => {
    const used = pressA(pressA(moveCursor(itemMenu(), 0, -1, itemRules), itemRules), itemRules);
    expect(eirika(used)).toMatchObject({ hp: 18, uses: [45, 46, 2], moved: true });
    expect(used.action).toBeNull();
  });

  it('discards an item, and B steps back to the action menu', () => {
    const lance = pressA(itemMenu(), itemRules);
    const dropped = pressA(lance, itemRules);
    expect(eirika(dropped).items).toEqual(['iron-sword', 'vulnerary']);
    expect(pressB(lance, itemRules).action).toMatchObject({ kind: 'items', index: 0 });
    expect(pressB(pressB(lance, itemRules), itemRules).action).toMatchObject({ kind: 'menu', index: 0 });
  });
});

describe('choosing a weapon', () => {
  // Eirika carries a lance and a sword; both reach the brigand next to her.
  const weaponRules: PlayRules = { ...rules, weaponChoices: (u) => (u.items.length > 1 ? [{ item: 0, targets: ['brigand-1'] }, { item: 1, targets: ['brigand-1'] }] : [{ item: 0, targets: ['brigand-1'] }]) };
  const armed = (items: string[]): PlayView => {
    const v = start([3, 1]);
    return { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items, uses: items.map(() => 40) } : u)) } };
  };
  const attackMenu = (items: string[]) => pressA(finishWalk(pressA(moveCursor(pressA(armed(items), weaponRules), 1, 0, weaponRules), weaponRules), weaponRules), weaponRules);

  it('asks which weapon when more than one reaches, equips it and targets with it', () => {
    const choosing = attackMenu(['iron-lance', 'iron-sword']);
    expect(choosing.action).toMatchObject({ kind: 'weapon', index: 0 });
    const targeting = chooseWeapon(moveCursor(choosing, 0, 1, weaponRules), 1, weaponRules);
    expect(eirika(targeting).items).toEqual(['iron-sword', 'iron-lance']);
    expect(targeting.action).toMatchObject({ kind: 'target', targets: ['brigand-1'] });
    expect(pressB(choosing, weaponRules).action).toMatchObject({ kind: 'menu', index: 0 });
  });

  it('goes straight to the target with only one weapon', () => {
    expect(attackMenu(['iron-sword']).action).toMatchObject({ kind: 'target' });
  });
});
