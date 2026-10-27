import { describe, expect, it } from 'vitest';
import type { Stats } from './combat';
import { searchMoves } from './movement';
import { startPlay, type PlayState, type PlayUnit } from './play';
import {
  brokenWeapons,
  canMove,
  chooseOption,
  chooseTradeSlot,
  chooseWeapon,
  itemOptions,
  endPlayerTurn,
  finishBattle,
  finishWalk,
  menuOptions,
  moveCursor,
  optionDisabled,
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
  // The AI's view: every unit fights with a might-5 weapon reaching 1 square, as its item 0.
  costMapFrom: (_u, from) => searchMoves({ width: 5, height: 3, terrain: new Array(15).fill(0) }, () => 1, 124, [from % 5, Math.floor(from / 5)], () => null).reached,
  aiItems: () => [{ item: 0, staff: false, might: 5, min: 1, max: 1 }],
  forecastWith: () => ({
    attacker: { canAttack: true, damage: 99, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
    defender: { canAttack: true, damage: 1, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
  }),
  terrainScore: () => 0,
  terrainAt: () => 0,
  isLord: () => false,
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
    let v = endPlayerTurn(start([3, 1], [SETH]), rules);
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
    let v = stepAI(endPlayerTurn(start([4, 0]), rules), rules);
    v = stepAI(v, rules);
    expect(v.walking).toBeNull();
    expect(v.battle).toBeNull();
    expect(v.state.units.find((u) => u.id === 'brigand-1')).toMatchObject({ at: [4, 0], moved: true });
  });

  it('has an enemy thief walk up and steal, the item and its uses going to the end of its items', () => {
    const thief: PlayRules = { ...rules, steals: (u) => u.id === 'brigand-1', stealRank: (u, i) => (u.items[i] === 'vulnerary' ? 36 : null) };
    const v0 = start([3, 1], [SETH]);
    const carrying: PlayView = {
      ...v0,
      state: { ...v0.state, units: v0.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['rapier', 'vulnerary'], uses: [40, 3] } : u.id === 'brigand-1' ? { ...u, items: ['iron-axe'], uses: [45] } : u)) },
    };
    let v = stepAI(stepAI(endPlayerTurn(carrying, thief), thief), thief);
    expect(v.walking).toMatchObject({ id: 'brigand-1', route: [8, 7], then: null, thenSteal: { target: 'eirika', item: 1 } });
    v = finishWalk(v, thief);
    expect(v.battle).toMatchObject({ attacker: 'brigand-1', defender: 'eirika', strikes: [], steal: 1, exp: null });
    v = finishBattle(v);
    const get = (id: string) => v.state.units.find((u) => u.id === id)!;
    expect(get('eirika')).toMatchObject({ items: ['rapier'], uses: [40], hp: 18 });
    expect(get('brigand-1')).toMatchObject({ items: ['iron-axe', 'vulnerary'], uses: [45, 3], moved: true, at: [2, 1] });
  });

  it('leaves asleep units out of their phase, their status ticking as it begins', () => {
    const v = start([4, 0], [{ id: 'brigand-2', class: 'brigand', team: 'enemy', level: 1, at: [4, 2] }]);
    const asleep = (turns1: number, turns2: number): PlayView => ({
      ...v,
      state: {
        ...v.state,
        units: v.state.units.map((u) =>
          u.id === 'brigand-1' ? { ...u, status: { kind: 'sleep' as const, turns: turns1 } } : u.id === 'brigand-2' ? { ...u, status: { kind: 'sleep' as const, turns: turns2 } } : u,
        ),
      },
    });
    // brigand-1 wakes as the phase begins; brigand-2 sleeps on.
    const phase = endPlayerTurn(asleep(1, 2), rules);
    expect(phase.queue).toEqual(['brigand-1']);
    expect(phase.state.units.find((u) => u.id === 'brigand-1')).not.toHaveProperty('status');
    expect(phase.state.units.find((u) => u.id === 'brigand-2')?.status).toEqual({ kind: 'sleep', turns: 1 });
  });

  it("can't select an asleep player unit to move, and ticks its status as the player phase begins", () => {
    const v = start([4, 0]);
    const asleep: PlayView = { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, status: { kind: 'sleep' as const, turns: 2 } } : u)) } };
    expect(canMove(eirika(asleep))).toBe(false);
    let w = endPlayerTurn(asleep, rules);
    while (w.phase !== 'player') w = stepAI(w.walking ? finishWalk(w, rules) : w.battle ? finishBattle(w) : w, rules);
    expect(eirika(w).status).toEqual({ kind: 'sleep', turns: 1 });
  });

  it("runs the player's berserk units after End turn, then the enemy phase", () => {
    // Eirika, berserk, beside Seth: she strikes him, and he can't be moved meanwhile.
    const v = start([4, 0], [{ id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [2, 1] }]);
    const mad: PlayView = { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, status: { kind: 'berserk' as const, turns: 3 } } : u)) } };
    let w = endPlayerTurn(mad, rules);
    expect(w).toMatchObject({ phase: 'player', berserk: true, queue: ['eirika'], banner: null });
    expect(pressA(w, rules)).toBe(w);
    w = stepAI(w, rules);
    expect(w.battle).toMatchObject({ attacker: 'eirika', defender: 'seth' });
    w = stepAI(finishBattle(w), rules);
    expect(w).toMatchObject({ phase: 'enemy', banner: 'enemy', berserk: false });
  });

  it("runs the enemy side's berserk units after its own", () => {
    const v = start([4, 0], [{ id: 'brigand-2', class: 'brigand', team: 'enemy', level: 1, at: [4, 2] }]);
    const mad: PlayView = { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'brigand-1' ? { ...u, status: { kind: 'berserk' as const, turns: 3 } } : u)) } };
    let w = stepAI(endPlayerTurn(mad, rules), rules);
    expect(w.queue).toEqual(['brigand-2']);
    w = stepAI(w, rules);
    while (w.walking || w.battle) w = w.walking ? finishWalk(w, rules) : finishBattle(w);
    w = stepAI(w, rules);
    expect(w).toMatchObject({ phase: 'enemy', berserk: true, queue: ['brigand-1'] });
  });

  it("doesn't end the turn in the middle of an action", () => {
    const menu = moveRight(start());
    expect(endPlayerTurn(menu, rules)).toBe(menu);
  });
});

describe('winning and losing', () => {
  it('wins when the last enemy falls and stops all input', () => {
    // Eirika attacks the brigand next to her; the test rules always defeat the defender.
    let v = pressA(moveRight(start([3, 1])), rules);
    v = finishBattle(pressA(v, rules));
    expect(v.outcome).toEqual({ result: 'victory' });
    expect(moveCursor(v, 1, 0, rules)).toBe(v);
    expect(endPlayerTurn(v, rules)).toBe(v);
    expect(stepAI(v, rules)).toBe(v);
  });

  it('loses when the enemy defeats the last player unit, stopping the enemy phase', () => {
    let v = stepAI(stepAI(endPlayerTurn(start([3, 1]), rules), rules), rules);
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

  it('uses a booster that would raise something: new stats, HP rising with the maximum, the use spent', () => {
    const boostRules: PlayRules = {
      ...itemRules,
      itemUse: (u, i) =>
        u.items[i] === 'angelic-robe' && u.stats.hp < 60 ? { equip: false, heal: 0, boost: { stats: { ...u.stats, hp: u.stats.hp + 7 }, movBonus: 0 } } : { equip: false, heal: 0 },
    };
    const v = withItems(start(), 10);
    const robe: PlayView = { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['angelic-robe'], uses: [1] } : u)) } };
    const options = pressA(pressA(finishWalk(pressA(moveCursor(pressA(robe, boostRules), 1, 0, boostRules), boostRules), boostRules), boostRules), boostRules);
    expect(itemOptions(options, boostRules)).toEqual(['use', 'discard']);
    const used = pressA(options, boostRules);
    expect(eirika(used)).toMatchObject({ hp: 17, stats: { hp: 25 }, items: [], uses: [], moved: true });
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

describe('healing with a staff', () => {
  // Eirika carries a Heal staff; Seth stands next to where she moves, hurt.
  const staffRules: PlayRules = {
    ...rules,
    staffChoices: (u, s) => {
      const hurt = s.units.filter((o) => o.id !== u.id && o.team === 'player' && o.hp < o.stats.hp && Math.abs(o.at[0] - u.at[0]) + Math.abs(o.at[1] - u.at[1]) === 1);
      return u.items[0] === 'heal' && hurt.length ? [{ item: 0, targets: hurt.map((o) => o.id), heal: 15 }] : [];
    },
    staffExperience: (u) => ({ unit: u.id, level: u.level, exp: 0, result: { gain: 11, exp: 11, level: u.level, levelUp: null } }),
  };
  const setUp = (): PlayView => {
    const v = start([4, 2], [{ id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [2, 0] }]);
    return {
      ...v,
      state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['heal'], uses: [3] } : u.id === 'seth' ? { ...u, hp: 5 } : u)) },
    };
  };

  it('offers Staff with a hurt ally in reach, heals it, spends a use and gives experience', () => {
    const menu = moveRight(setUp());
    expect(menuOptions(menu, staffRules)).toEqual(['staff', 'item', 'trade', 'wait']);
    const choosing = pressA(menu, staffRules);
    expect(choosing.action).toMatchObject({ kind: 'target', targets: ['seth'], staff: { item: 0, heal: 15 } });
    expect(choosing.cursor).toEqual([2, 0]);
    const healing = pressA(choosing, staffRules);
    expect(healing.battle).toMatchObject({ attacker: 'eirika', defender: 'seth', strikes: [], heal: 15, exp: { result: { gain: 11 } } });
    const after = finishBattle(healing);
    expect(after.state.units.find((u) => u.id === 'seth')!.hp).toBe(18);
    expect(eirika(after)).toMatchObject({ uses: [2], moved: true, exp: 11 });
    expect(pressB(choosing, staffRules).action).toMatchObject({ kind: 'menu', index: 0 });
  });

  it('heals every hurt ally in reach at once with Fortify, with no one to choose', () => {
    // Fortify reaches the whole field here; Seth and the far-off cleric are hurt, the knight isn't.
    const fortifyRules: PlayRules = {
      ...staffRules,
      staffChoices: (u, s) => {
        const hurt = s.units.filter((o) => o.id !== u.id && o.team === 'player' && o.hp < o.stats.hp);
        return u.items[0] === 'fortify' && hurt.length ? [{ item: 0, targets: hurt.map((o) => o.id), heal: 12, fortify: true }] : [];
      },
    };
    const v = start([4, 2], [
      { id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [2, 0] },
      { id: 'cleric', class: 'cleric', team: 'player', level: 1, at: [0, 2] },
      { id: 'knight', class: 'knight', team: 'player', level: 1, at: [0, 0] },
    ]);
    const set: PlayView = {
      ...v,
      state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['fortify'], uses: [3] } : u.id === 'seth' ? { ...u, hp: 5 } : u.id === 'cleric' ? { ...u, hp: 10 } : u)) },
    };
    const healing = chooseOption(moveRight(set), 'staff', fortifyRules);
    expect(healing.action).toBeNull();
    expect(healing.battle).toMatchObject({ attacker: 'eirika', defender: 'eirika', heal: 12, healed: ['seth', 'cleric'], exp: { result: { gain: 11 } } });
    const after = finishBattle(healing);
    const hp = (id: string) => after.state.units.find((u) => u.id === id)!.hp;
    expect([hp('seth'), hp('cleric'), hp('knight'), hp('eirika')]).toEqual([17, 18, 18, 18]);
    expect(eirika(after)).toMatchObject({ uses: [2], moved: true, exp: 11 });
  });

  it("lets the computer's healers heal allies set on healing", () => {
    // The brigand carries a staff; a second brigand, under half its HP, stands below it.
    const v = start([4, 0], [{ id: 'brigand-2', class: 'brigand', team: 'enemy', level: 1, at: [4, 1] }]);
    const set: PlayView = {
      ...v,
      state: { ...v.state, units: v.state.units.map((u) => (u.id === 'brigand-1' ? { ...u, items: ['heal'], uses: [3] } : u.id === 'brigand-2' ? { ...u, hp: 4 } : u)) },
    };
    const enemyRules: PlayRules = {
      ...staffRules,
      aiItems: (u) => (u.items[0] === 'heal' ? [{ item: 0, staff: true, might: 0, min: 1, max: 1 }] : rules.aiItems(u)),
      aiStaves: (u) => (u.items[0] === 'heal' ? [{ item: 0, heal: 10, physic: false, reach: 1, rank: 1 }] : []),
    };
    // The hurt brigand, set on healing, acts first (its priority is only its movement) and waits; then
    // the healer heals it from where it stands, its only square beside it within its 1 movement.
    let acting = endPlayerTurn(set, enemyRules);
    expect(acting.queue).toEqual(['brigand-2', 'brigand-1']);
    acting = stepAI(stepAI(stepAI(acting, enemyRules), enemyRules), enemyRules);
    expect(acting.walking).toBeNull();
    expect(acting.battle).toMatchObject({ attacker: 'brigand-1', defender: 'brigand-2', heal: 10 });
    const after = finishBattle(acting);
    expect(after.state.units.find((u) => u.id === 'brigand-2')!.hp).toBe(14);
    expect(after.state.units.find((u) => u.id === 'brigand-1')!.uses).toEqual([2]);
  });

  it('has a hurt enemy walk away and drink its Vulnerary, staying set on healing', () => {
    // The brigand at (2,1), next to Eirika, at 5 of 18 HP. Eirika threatens the squares around her.
    const v = start([2, 1]);
    const hurt: PlayView = { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'brigand-1' ? { ...u, hp: 5, items: ['vulnerary'], uses: [3] } : u)) } };
    const healRules: PlayRules = {
      ...rules,
      selfHealItem: (u) => (u.items[0] === 'vulnerary' ? { item: 0, heal: 10 } : null),
    };
    let w = stepAI(stepAI(endPlayerTurn(hurt, rules), healRules), healRules);
    // From (2,1) it reaches (2,0), (2,2) and (3,1), all within Eirika's strike but (3,1).
    expect(w.walking).toMatchObject({ id: 'brigand-1', route: [7, 8], thenUse: { item: 0, heal: 10 } });
    w = finishWalk(w, healRules);
    const brigand = w.state.units.find((u) => u.id === 'brigand-1')!;
    expect([brigand.hp, brigand.uses, brigand.moved, brigand.healing]).toEqual([15, [2], true, true]);
  });

  it('offers no Staff with nobody hurt in reach', () => {
    const v = setUp();
    const fine = { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'seth' ? { ...u, hp: 18 } : u)) } };
    expect(menuOptions(moveRight(fine), staffRules)).toEqual(['item', 'trade', 'wait']);
  });
});

describe('trading', () => {
  // Eirika (sword, vulnerary) moves next to Seth (lance).
  const setUp = (): PlayView => {
    const v = start([4, 2], [{ id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [2, 0] }]);
    return {
      ...v,
      state: {
        ...v.state,
        units: v.state.units.map((u) =>
          u.id === 'eirika' ? { ...u, items: ['iron-sword', 'vulnerary'], uses: [46, 3] } : u.id === 'seth' ? { ...u, items: ['iron-lance'], uses: [45] } : u,
        ),
      },
    };
  };
  const seth = (v: PlayView) => v.state.units.find((u) => u.id === 'seth')!;
  const tradeMenu = () => {
    const menu = moveRight(setUp());
    expect(menuOptions(menu, rules)).toEqual(['item', 'trade', 'wait']);
    const choosing = pressA(moveCursor(menu, 0, 1, rules), rules);
    expect(choosing.action).toMatchObject({ kind: 'target', targets: ['seth'], trade: true });
    return pressA(choosing, rules);
  };

  it('swaps two items, uses and all', () => {
    const t = tradeMenu();
    expect(t.action).toMatchObject({ kind: 'trade', partner: 'seth', index: 0, picked: null });
    const swapped = chooseTradeSlot(chooseTradeSlot(t, 0), 5);
    expect(eirika(swapped)).toMatchObject({ items: ['iron-lance', 'vulnerary'], uses: [45, 3] });
    expect(seth(swapped)).toMatchObject({ items: ['iron-sword'], uses: [46] });
  });

  it('gives an item into the first empty slot, and only there', () => {
    const t = tradeMenu();
    expect(chooseTradeSlot(chooseTradeSlot(t, 1), 7).state).toBe(t.state); // slot 2 of Seth's side is past the first empty one
    const given = chooseTradeSlot(chooseTradeSlot(t, 1), 6);
    expect(eirika(given).items).toEqual(['iron-sword']);
    expect(seth(given)).toMatchObject({ items: ['iron-lance', 'vulnerary'], uses: [45, 3] });
  });

  it('has five slots a side, as FE8, so a full side can still trade', () => {
    const t = tradeMenu();
    const full: PlayView = { ...t, state: { ...t.state, units: t.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['iron-sword', 'iron-lance', 'vulnerary', 'rapier', 'elixir'], uses: [46, 45, 3, 40, 1] } : u)) } };
    const given = chooseTradeSlot(chooseTradeSlot(full, 4), 6);
    expect(eirika(given).items).toEqual(['iron-sword', 'iron-lance', 'vulnerary', 'rapier']);
    expect(seth(given).items).toEqual(['iron-lance', 'elixir']);
  });

  it('moves between sides with the D-pad, and after a trade the move stays', () => {
    const t = tradeMenu();
    expect(moveCursor(t, 1, 0, rules).action).toMatchObject({ index: 5 });
    expect(moveCursor(moveCursor(t, 0, 1, rules), 1, 0, rules).action).toMatchObject({ index: 6 }); // Seth's empty slot
    const traded = chooseTradeSlot(chooseTradeSlot(t, 0), 5);
    const menu = pressB(traded, rules);
    expect(menu.action).toMatchObject({ kind: 'menu', locked: true });
    expect(pressB(menu, rules)).toBe(menu);
    // Without a trade, B goes back to the menu and B again takes the move back.
    const untouched = pressB(t, rules);
    expect(pressB(untouched, rules).action).toBeNull();
  });
});

describe('chapter goals', () => {
  const chapter = (goal: Partial<ProjectChapter>, extra: ProjectChapter['units'] = []): ProjectChapter => ({
    ...chapterWith([4, 2], extra),
    ...goal,
    units: [...chapterWith([4, 2], extra).units.map((u) => (u.id === 'eirika' ? { ...u, character: 'eirika' } : u))],
  });
  const view = (c: ProjectChapter) => startView(startPlay(c, () => STATS));

  it("offers Seize to the lord on the square, and seizing wins", () => {
    const menu = moveRight(view(chapter({ goal: 'seize', seizeAt: [2, 1] })));
    expect(menuOptions(menu, rules)).toEqual(['seize', 'wait']);
    const won = pressA(menu, rules);
    expect(won.outcome).toEqual({ result: 'victory' });
    // Off the square, or without the lord, no Seize.
    expect(menuOptions(moveRight(view(chapter({ goal: 'seize', seizeAt: [3, 2] }))), rules)).toEqual(['wait']);
  });

  it('does not win a Seize chapter by defeating every enemy', () => {
    const v = view(chapter({ goal: 'seize', seizeAt: [0, 0] }));
    const fight = pressA(pressA(moveRight({ ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'brigand-1' ? { ...u, at: [3, 1] as const } : u)) } }), rules), rules);
    expect(finishBattle(fight).outcome).toBeNull();
  });

  it('wins Defeat boss when the boss falls', () => {
    const c = { ...chapter({ goal: 'boss', boss: 'brigand-1' }), units: chapterWith([3, 1]).units.map((u) => (u.id === 'brigand-1' ? { ...u, character: 'oneill' } : u)) };
    const fight = pressA(pressA(moveRight(view(c)), rules), rules);
    expect(finishBattle(fight).outcome).toEqual({ result: 'victory' });
  });

  it('wins Survive as the turn after the last begins', () => {
    let v = view(chapter({ goal: 'survive', surviveTurns: 2 }));
    for (let turn = 1; turn <= 2; turn++) {
      expect(v.outcome).toBeNull();
      v = endPlayerTurn(v, rules);
      while ((v.phase !== 'player' || v.banner) && !v.outcome) v = stepAI(v, rules);
    }
    expect(v.state.turn).toBe(3);
    expect(v.outcome).toEqual({ result: 'victory' });
  });
});

describe('stealing', () => {
  // Eirika can steal; vulneraries can be stolen, weapons can't. A steal gives 10 experience.
  const thief: PlayRules = {
    ...rules,
    steals: (u) => u.id === 'eirika',
    stealable: (u, i) => u.items[i] === 'vulnerary',
    stealExperience: (u) => ({ unit: u.id, level: u.level, exp: u.exp ?? 0, result: { gain: 10, exp: 10, level: 1, levelUp: null } }),
  };
  /** The brigand beside Eirika carries `brigand`; she carries `own`; the action menu is open where she stands. */
  const menuWith = (brigand: string[], own: string[] = [], spd = STATS.spd) => {
    const v = start([2, 1], [SETH]);
    const set: PlayView = {
      ...v,
      state: {
        ...v.state,
        units: v.state.units.map((u) =>
          u.id === 'brigand-1' ? { ...u, items: brigand, uses: brigand.map(() => 3), stats: { ...u.stats, spd } } : u.id === 'eirika' ? { ...u, items: own, uses: own.map(() => 1) } : u,
        ),
      },
    };
    return pressA(pressA(set, thief), thief);
  };

  it('offers Steal after Staff, next to an enemy no faster carrying something stealable', () => {
    expect(menuOptions(menuWith(['iron-axe', 'vulnerary']), thief)).toEqual(['attack', 'steal', 'wait']);
    expect(menuOptions(menuWith(['iron-axe']), thief)).toEqual(['attack', 'wait']);
    expect(menuOptions(menuWith(['vulnerary'], [], STATS.spd + 1), thief)).toEqual(['attack', 'wait']);
    // A unit whose class can't steal.
    expect(menuOptions(menuWith(['vulnerary']), rules)).toEqual(['attack', 'wait']);
  });

  it("picks whom to steal from, then an item; weapons can't be taken; the item and 10 experience go to the thief", () => {
    let v = chooseOption(menuWith(['iron-axe', 'vulnerary']), 'steal', thief);
    expect(v.action).toMatchObject({ kind: 'target', steal: true, targets: ['brigand-1'] });
    v = pressA(v, thief);
    expect(v.action).toMatchObject({ kind: 'steal', target: 'brigand-1', index: 0 });
    expect(pressA(v, thief)).toBe(v); // the axe
    v = pressA(moveCursor(v, 0, 1, thief), thief);
    expect(v.battle).toMatchObject({ attacker: 'eirika', defender: 'brigand-1', strikes: [], steal: 1, exp: { result: { gain: 10 } } });
    v = finishBattle(v);
    expect(eirika(v)).toMatchObject({ items: ['vulnerary'], uses: [3], exp: 10, moved: true });
    expect(v.state.units.find((u) => u.id === 'brigand-1')).toMatchObject({ items: ['iron-axe'], uses: [3], hp: 18 });
  });

  it('goes back to the action menu with B, on Steal', () => {
    const steal = pressA(chooseOption(menuWith(['vulnerary']), 'steal', thief), thief);
    const back = pressB(steal, thief);
    expect(back.action).toMatchObject({ kind: 'menu', index: 1 });
    expect(pressB(chooseOption(menuWith(['vulnerary']), 'steal', thief), thief).action).toMatchObject({ kind: 'menu', index: 1 });
  });

  it('shows Steal greyed out with five items, and does nothing on it', () => {
    const full = menuWith(['vulnerary'], ['rapier', 'rapier', 'rapier', 'rapier', 'rapier']);
    expect(menuOptions(full, thief)).toContain('steal');
    expect(optionDisabled(full, 'steal')).toBe(true);
    expect(chooseOption(full, 'steal', thief)).toBe(full);
  });
});

describe('status staves', () => {
  // Eirika carries a Sleep staff reaching the brigand; it hits when `hits` says so, 10 experience, 1 for a miss.
  const sleepRules = (hits: boolean): PlayRules => ({
    ...rules,
    staffChoices: (u, st) => {
      const foes = st.units.filter((o) => o.team === 'enemy' && (!o.status || o.status.kind === 'sleep'));
      return u.items[0] === 'sleep' && foes.length ? [{ item: 0, targets: foes.map((o) => o.id), heal: 0, status: 'sleep' }] : [];
    },
    staffAccuracy: () => 70,
    statusStaffHits: () => hits,
    staffExperience: (u, _i, missed) => ({ unit: u.id, level: u.level, exp: 0, result: { gain: missed ? 1 : 10, exp: missed ? 1 : 10, level: u.level, levelUp: null } }),
  });
  const withStaff = (): PlayView => {
    const v = start([4, 2], [SETH]);
    return { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: ['sleep'], uses: [2] } : u)) } };
  };
  const brigand = (v: PlayView) => v.state.units.find((u) => u.id === 'brigand-1')!;

  it('puts the target to sleep on a hit, spending a use, with no blows', () => {
    const r = sleepRules(true);
    const menu = moveRight(withStaff());
    expect(menuOptions(menu, r)).toContain('staff');
    const choosing = chooseOption(menu, 'staff', r);
    expect(choosing.action).toMatchObject({ kind: 'target', targets: ['brigand-1'], staff: { status: 'sleep' } });
    const using = pressA(choosing, r);
    expect(using.battle).toMatchObject({ attacker: 'eirika', defender: 'brigand-1', strikes: [], inflict: { kind: 'sleep', hit: true }, exp: { result: { gain: 10 } } });
    const after = finishBattle(using);
    expect(brigand(after).status).toEqual({ kind: 'sleep', turns: 5 });
    expect(eirika(after)).toMatchObject({ uses: [1], moved: true, exp: 10 });
  });

  it('on a miss gives no status and 1 experience, and still spends the use', () => {
    const r = sleepRules(false);
    const using = pressA(chooseOption(moveRight(withStaff()), 'staff', r), r);
    expect(using.battle).toMatchObject({ inflict: { kind: 'sleep', hit: false }, exp: { result: { gain: 1 } } });
    const after = finishBattle(using);
    expect(brigand(after)).not.toHaveProperty('status');
    expect(eirika(after)).toMatchObject({ uses: [1], exp: 1 });
  });
});

describe('Restore and Barrier', () => {
  // Eirika moves beside Seth, who is asleep; her staff is `staff`.
  const supportRules = (support: 'restore' | 'barrier'): PlayRules => ({
    ...rules,
    staffChoices: (u, st) => {
      const near = st.units.filter((o) => o.id === 'seth' && Math.abs(o.at[0] - u.at[0]) + Math.abs(o.at[1] - u.at[1]) === 1);
      return near.length ? [{ item: 0, targets: ['seth'], heal: 0, support }] : [];
    },
    staffExperience: (u) => ({ unit: u.id, level: u.level, exp: 0, result: { gain: 11, exp: 11, level: u.level, levelUp: null } }),
  });
  const setUp = (staff: string): PlayView => {
    const v = start([4, 2], [{ id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [2, 0] }]);
    return {
      ...v,
      state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: [staff], uses: [3] } : u.id === 'seth' ? { ...u, status: { kind: 'sleep' as const, turns: 4 } } : u)) },
    };
  };
  const seth = (v: PlayView) => v.state.units.find((u) => u.id === 'seth')!;

  it('Restore wakes the ally beside it, spending a use, with experience', () => {
    const r = supportRules('restore');
    const using = pressA(chooseOption(moveRight(setUp('restore')), 'staff', r), r);
    expect(using.battle).toMatchObject({ attacker: 'eirika', defender: 'seth', strikes: [], support: 'restore', exp: { result: { gain: 11 } } });
    const after = finishBattle(using);
    expect(seth(after)).not.toHaveProperty('status');
    expect(eirika(after)).toMatchObject({ uses: [2], moved: true });
  });

  it('Barrier gives the ally beside it 7 Res', () => {
    const r = supportRules('barrier');
    const after = finishBattle(pressA(chooseOption(moveRight(setUp('barrier')), 'staff', r), r));
    expect(seth(after).barrier).toBe(7);
  });
});

describe('Rescue and Warp', () => {
  // Eirika moves to (2,1); Seth stands at (2,0) beside her. Rescue lands him on (3,0); Warp reaches (4,0) and (4,1).
  const moveRules = (move: 'rescue' | 'warp'): PlayRules => ({
    ...rules,
    staffChoices: (u) => (u.id === 'eirika' ? [{ item: 0, targets: ['seth'], heal: 0, move }] : []),
    staffExperience: (u) => ({ unit: u.id, level: u.level, exp: 0, result: { gain: 11, exp: 11, level: u.level, levelUp: null } }),
    rescueLanding: () => [3, 0],
    warpCells: () => [4, 9],
  });
  const setUp = (staff: string): PlayView => {
    const v = start([4, 2], [{ id: 'seth', class: 'paladin-m', team: 'player', level: 1, at: [2, 0] }]);
    return { ...v, state: { ...v.state, units: v.state.units.map((u) => (u.id === 'eirika' ? { ...u, items: [staff], uses: [3] } : u)) } };
  };
  const seth = (v: PlayView) => v.state.units.find((u) => u.id === 'seth')!;

  it('Rescue brings the ally to its landing square, spending a use', () => {
    const r = moveRules('rescue');
    const using = pressA(chooseOption(moveRight(setUp('rescue')), 'staff', r), r);
    expect(using.battle).toMatchObject({ attacker: 'eirika', defender: 'seth', strikes: [], relocate: [3, 0] });
    const after = finishBattle(using);
    expect(seth(after).at).toEqual([3, 0]);
    expect(eirika(after)).toMatchObject({ uses: [2], moved: true });
  });

  it('Warp asks for a square in range, then sends the ally there; B goes back to choosing whom', () => {
    const r = moveRules('warp');
    const choosing = chooseOption(moveRight(setUp('warp')), 'staff', r);
    const picking = pressA(choosing, r);
    expect(picking.action).toMatchObject({ kind: 'warp', target: 'seth', cells: [4, 9] });
    expect(picking.cursor).toEqual([2, 0]);
    expect(pressA(picking, r)).toBe(picking); // (2,0) isn't in range
    expect(pressB(picking, r).action).toMatchObject({ kind: 'target', targets: ['seth'] });
    const on = moveCursor(moveCursor(picking, 1, 0, r), 1, 0, r); // to (4,0), cell 4
    const after = finishBattle(pressA(on, r));
    expect(seth(after).at).toEqual([4, 0]);
    expect(eirika(after).uses).toEqual([2]);
    // A tap picks a square; a second tap on it warps.
    const tapped = tapAt(picking, 4, 1, r);
    expect(tapped.cursor).toEqual([4, 1]);
    expect(tapAt(tapped, 4, 1, r).battle).toMatchObject({ relocate: [4, 1] });
  });
});
