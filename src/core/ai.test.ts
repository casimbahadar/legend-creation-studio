import { describe, expect, it } from 'vitest';
import { dangerMap, isHealing, phaseOrder, planAction, type AiItem, type AiRules, type AiStaff } from './ai';
import type { Forecast, Stats } from './combat';
import { searchMoves } from './movement';
import { startPlay, type PlayState, type PlayUnit } from './play';
import type { Behaviour, ProjectUnit } from './project';

// A 7 x 3 field where every step costs 1 and every unit has Mov 2. Each unit's weapons are set per
// test (by unit id); by default a sword: might 5, reaching 1 square. Fights deal `damage` at 100 hit,
// and the defender strikes back for 2 if its weapon reaches.
const W = 7;
const H = 3;
const STATS: Stats = { hp: 10, str: 5, skl: 5, spd: 5, def: 3, res: 1, lck: 2, con: 6 };
const SWORD: AiItem = { item: 0, staff: false, might: 5, min: 1, max: 1 };
const grid = { width: W, height: H, terrain: new Array(W * H).fill(0) };
const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

interface Setup {
  readonly items?: Record<string, readonly AiItem[]>;
  readonly damage?: (target: PlayUnit) => number;
  readonly terrain?: Record<number, number>;
  readonly lords?: readonly string[];
  readonly forts?: readonly number[];
  /** Units that can steal, and the steal rank of each item name. */
  readonly thieves?: readonly string[];
  readonly ranks?: Record<string, number>;
  /** Each unit's staves (by unit id), and a status staff's chance to hit. */
  readonly staves?: Record<string, readonly AiStaff[]>;
  readonly accuracy?: number;
}
function rules(setup: Setup = {}): AiRules {
  const itemsOf = (u: PlayUnit) => setup.items?.[u.id] ?? [SWORD];
  return {
    width: W,
    height: H,
    searchOf: (u, s, mov = 2) =>
      searchMoves(grid, () => 1, mov, u.at, (x, y) => {
        const o = s.units.find((p) => p.at[0] === x && p.at[1] === y && p.id !== u.id);
        return !o ? null : (o.team === 'enemy') !== (u.team === 'enemy') ? 'foe' : 'friend';
      }),
    costMapFrom: (_u, from) => searchMoves(grid, () => 1, 124, [from % W, Math.floor(from / W)], () => null).reached,
    aiItems: itemsOf,
    forecastWith: (u, at, item, target): Forecast => {
      const theirs = itemsOf(target).find((i) => !i.staff);
      const d = dist(at, target.at);
      return {
        attacker: { canAttack: true, damage: setup.damage?.(target) ?? 3, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
        defender: { canAttack: !!theirs && d >= theirs.min && d <= theirs.max, damage: 2, hit: 100, crit: 0, doubles: false, attackSpeed: 5 },
      };
    },
    terrainScore: (_u, cell) => setup.terrain?.[cell] ?? 0,
    terrainAt: (cell) => (setup.forts?.includes(cell) ? 0x0a : 0),
    isLord: (u) => setup.lords?.includes(u.id) ?? false,
    aiStaves: (u) => setup.staves?.[u.id] ?? itemsOf(u).filter((i) => i.staff).map((i) => ({ item: i.item, heal: 10, physic: false, reach: 1, rank: 1 })),
    staffAccuracy: () => setup.accuracy ?? 50,
    steals: (u) => setup.thieves?.includes(u.id) ?? false,
    stealRank: (u, i) => setup.ranks?.[u.items[i]!] ?? null,
  };
}
const unit = (id: string, team: ProjectUnit['team'], at: [number, number], ai?: Behaviour): ProjectUnit => ({ id, class: 'c', team, level: 1, at, ...(ai ? { ai } : {}) });
const play = (...units: ProjectUnit[]): PlayState => startPlay({ id: 'c', name: 'C', map: 'fe8-us/chapter-entry-0', goal: 'rout', units }, () => STATS);
const get = (s: PlayState, id: string) => s.units.find((u) => u.id === id)!;
const withHp = (s: PlayState, hp: Record<string, number>, healing = false): PlayState => ({
  ...s,
  units: s.units.map((u) => (hp[u.id] !== undefined ? { ...u, hp: hp[u.id]!, ...(healing ? { healing: true } : {}) } : u)),
});
const cell = (x: number, y: number) => y * W + x;
const carrying = (s: PlayState, items: Record<string, readonly string[]>): PlayState => ({
  ...s,
  units: s.units.map((u) => (items[u.id] ? { ...u, items: items[u.id]!, uses: items[u.id]!.map(() => null) } : u)),
});

describe("FE8's attack choice", () => {
  it('walks to a square in reach of the foe and attacks it', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]));
    const plan = planAction(get(s, 'e'), s, rules());
    expect(plan).toMatchObject({ attack: 'p', attackItem: 0 });
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [0, 1])).toBe(1);
  });

  it("takes the square the foe can't strike back from, worth 50, over a cheaper one", () => {
    // 'e' has a javelin reaching 1 to 2; 'p' a sword. (2,1) is 1 step away but in p's reach; squares 2
    // from p cost 1 or 2 more: still better.
    const javelin: AiItem = { item: 0, staff: false, might: 5, min: 1, max: 2 };
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]));
    const plan = planAction(get(s, 'e'), s, rules({ items: { e: [javelin] } }));
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [0, 1])).toBe(2);
  });

  it("weighs the square's terrain and, between equals, keeps the first the game's scan meets", () => {
    // Beside p at (4,1), e at (5,1) can stand where it is, or on (4,0) or (4,2) 2 steps away.
    const s = play(unit('p', 'player', [4, 1]), unit('e', 'enemy', [5, 1]));
    expect(planAction(get(s, 'e'), s, rules({ terrain: { [cell(4, 0)]: 30 } })).to).toBe(cell(4, 0));
    // Without terrain, (4,0) and (4,2) still beat staying (each has e's own square, an ally, within 3,
    // worth +5 against its 2 steps); between them, the scan from the bottom right meets (4,2) first.
    expect(planAction(get(s, 'e'), s, rules()).to).toBe(cell(4, 2));
  });

  it('goes for the foe it would defeat', () => {
    const s = play(unit('p', 'player', [2, 0]), unit('e', 'enemy', [3, 1]), unit('q', 'player', [4, 2]));
    const weak = withHp(s, { q: 3 });
    expect(planAction(get(weak, 'e'), weak, rules({ damage: () => 3 })).attack).toBe('q');
  });

  it('holds its square, attacking only what it reaches from there', () => {
    const far = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1], 'hold'));
    expect(planAction(get(far, 'e'), far, rules())).toEqual({ to: cell(3, 1), route: [cell(3, 1)], attack: null });
    const near = play(unit('p', 'player', [2, 1]), unit('e', 'enemy', [3, 1], 'hold'));
    expect(planAction(get(near, 'e'), near, rules())).toMatchObject({ to: cell(3, 1), attack: 'p' });
  });

  it('lets allies hunt enemies the same way', () => {
    const s = play(unit('a', 'ally', [0, 1]), unit('x', 'enemy', [3, 1]));
    expect(planAction(get(s, 'a'), s, rules())).toMatchObject({ attack: 'x' });
  });
});

describe("FE8's movement toward enemies", () => {
  it('waits in Attack in range with nothing in reach, and charges toward the nearest enemy otherwise', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [6, 1]));
    expect(planAction(get(s, 'e'), s, rules()).to).toBe(cell(6, 1));
    const c = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [6, 1], 'charge'));
    // Of the squares it can reach, (4,1) costs the least (4) from there to p.
    expect(planAction(get(c, 'e'), c, rules())).toMatchObject({ to: cell(4, 1), attack: null });
  });
});

describe("FE8's staff use", () => {
  const staff: AiItem = { item: 0, staff: true, might: 0, min: 1, max: 1 };

  it('heals the ally set on healing with the lowest share of its HP, over attacking', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]), unit('f', 'enemy', [4, 1]), unit('g', 'enemy', [3, 2]));
    const hurt = withHp(s, { f: 4, g: 2 }, true);
    expect(planAction(get(hurt, 'e'), hurt, rules({ items: { e: [staff, { ...SWORD, item: 1 }] } })).heal).toEqual({ target: 'g', item: 0, heal: 10 });
  });

  it('uses Fortify with more than two of its side set on healing, from the square reaching the most', () => {
    // Reach 2. From (5,1), f and g at (6,0) and (6,2) are in reach; i, hurt but not set on healing, is
    // healed too; j, set on healing, is out of reach.
    const fortify = (u: PlayUnit) => (u.id === 'e' ? [{ item: 0, heal: 12, physic: true, fortify: true, reach: 2, rank: 1 }] : []);
    const s = play(unit('e', 'enemy', [3, 1]), unit('f', 'enemy', [6, 0]), unit('g', 'enemy', [6, 2]), unit('i', 'enemy', [4, 0]), unit('j', 'enemy', [0, 1]));
    const hurt = withHp(withHp(s, { f: 4, g: 4, j: 4 }, true), { i: 9 });
    const r = { ...rules({ items: { e: [staff] } }), aiStaves: fortify };
    expect(planAction(get(hurt, 'e'), hurt, r)).toMatchObject({ to: cell(5, 1), heal: { target: 'e', item: 0, heal: 12, fortify: ['f', 'g', 'i'] } });
    // With only two set on healing, it doesn't.
    const two = withHp(withHp(s, { f: 4, g: 4 }, true), { i: 9 });
    expect(planAction(get(two, 'e'), two, r).heal).toBeUndefined();
  });

  it("leaves alone hurt allies that aren't set on healing", () => {
    const s = withHp(play(unit('e', 'enemy', [3, 1]), unit('f', 'enemy', [4, 1])), { f: 6 });
    expect(planAction(get(s, 'e'), s, rules({ items: { e: [staff] } })).heal).toBeUndefined();
  });
});

describe('the order a phase acts in', () => {
  it('goes by movement plus 20 for melee, 40 for ranged, 72 for a staff, 87 for a lord or no weapon', () => {
    const s = play(
      unit('lord', 'enemy', [0, 0]),
      unit('healer', 'enemy', [1, 0]),
      unit('archer', 'enemy', [2, 0]),
      unit('fighter', 'enemy', [3, 0]),
      unit('hurt', 'enemy', [4, 0]),
    );
    const bow: AiItem = { item: 0, staff: false, might: 5, min: 2, max: 2 };
    const set = withHp(s, { hurt: 2 }, true);
    const r = rules({ lords: ['lord'], items: { healer: [{ ...bow, staff: true }], archer: [bow] } });
    expect(phaseOrder(set.units, set, r)).toEqual(['hurt', 'fighter', 'archer', 'healer', 'lord']);
  });
});

describe('healing itself', () => {
  it('sets on healing under half its HP and keeps on until whole', () => {
    const s = play(unit('e', 'enemy', [3, 1]));
    expect(isHealing(get(withHp(s, { e: 5 }), 'e'))).toBe(false); // 50%
    expect(isHealing(get(withHp(s, { e: 4 }), 'e'))).toBe(true);
    expect(isHealing(get(withHp(s, { e: 9 }, true), 'e'))).toBe(true); // 90%, already healing
    expect(isHealing(get(withHp(s, { e: 10 }, true), 'e'))).toBe(false);
  });

  it("adds each foe's (power + might) / 2 where it could strike, keeping the strongest weapon seen so far", () => {
    // 'p' at (0,1) with might 6 reaches 2 squares and strikes 3 away: (5 + 6) / 2 = 5. 'q' has no
    // weapon of its own but counts with p's, as in the game.
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1]), unit('q', 'player', [6, 1]));
    const danger = dangerMap(get(s, 'e'), s, rules({ items: { p: [{ ...SWORD, might: 6 }], q: [] } }), 2);
    expect(danger[cell(3, 1)]).toBe(5 + 5);
    expect(danger[cell(0, 0)]).toBe(5);
    expect(danger[cell(6, 1)]).toBe(5);
  });

  it('walks to the safest square it can reach and uses its Vulnerary there, Hold units too', () => {
    const s = withHp(play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [3, 1], 'hold')), { e: 3 }, true);
    const r = { ...rules(), selfHealItem: (u: PlayUnit) => (u.id === 'e' ? { item: 0, heal: 10 } : null) };
    const plan = planAction(get(s, 'e'), s, r);
    expect(plan.useItem).toEqual({ item: 0, heal: 10 });
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [0, 1])).toBeGreaterThan(3);
  });

  it('without one, heads for a fort, attacking on arrival only a foe that can\'t strike back', () => {
    const s = withHp(play(unit('p', 'player', [0, 0]), unit('e', 'enemy', [3, 1])), { e: 3 }, true);
    const plan = planAction(get(s, 'e'), s, rules({ forts: [cell(6, 1)] }));
    expect(plan).toMatchObject({ to: cell(5, 1), attack: null });
    // Lords stay put and fight on.
    expect(planAction(get(s, 'e'), s, rules({ forts: [cell(6, 1)], lords: ['e'] })).to).not.toBe(cell(5, 1));
  });
});

describe('stealing', () => {
  const ranks = { 'member-card': 0, 'speedwing': 25, 'vulnerary': 36, 'elixir': 31 };

  it('walks beside the foe and takes its listed item, before attacking, from the cheapest square', () => {
    const s = carrying(play(unit('p', 'player', [1, 1]), unit('t', 'enemy', [4, 1])), { p: ['iron-sword', 'vulnerary'] });
    // (2,1) costs 2 and is the only square beside p it reaches.
    expect(planAction(get(s, 't'), s, rules({ thieves: ['t'], ranks }))).toMatchObject({ to: cell(2, 1), attack: null, steal: { target: 'p', item: 1 } });
  });

  it('takes the highest listed item, the last of equals, and leaves unlisted ones', () => {
    const s = carrying(play(unit('p', 'player', [2, 1]), unit('t', 'enemy', [3, 1])), { p: ['vulnerary', 'elixir', 'iron-sword', 'elixir'] });
    expect(planAction(get(s, 't'), s, rules({ thieves: ['t'], ranks })).steal).toEqual({ target: 'p', item: 3 });
    const none = carrying(s, { p: ['iron-sword'] });
    expect(planAction(get(none, 't'), none, rules({ thieves: ['t'], ranks }))).toMatchObject({ attack: 'p' });
    expect(planAction(get(none, 't'), none, rules({ thieves: ['t'], ranks })).steal).toBeUndefined();
  });

  it('goes for the foe with the most wanted item, ties to the last in the scan from the bottom right', () => {
    const s = carrying(play(unit('p', 'player', [2, 0]), unit('q', 'player', [2, 2]), unit('t', 'enemy', [3, 1])), { p: ['vulnerary'], q: ['speedwing'] });
    expect(planAction(get(s, 't'), s, rules({ thieves: ['t'], ranks })).steal?.target).toBe('q');
    const even = carrying(s, { q: ['vulnerary'] });
    expect(planAction(get(even, 't'), even, rules({ thieves: ['t'], ranks })).steal?.target).toBe('p');
  });

  it("leaves a faster foe alone, and doesn't steal with five items", () => {
    const s = carrying(play(unit('p', 'player', [2, 1]), unit('t', 'enemy', [3, 1])), { p: ['vulnerary'] });
    const fast = { ...s, units: s.units.map((u) => (u.id === 'p' ? { ...u, stats: { ...u.stats, spd: 6 } } : u)) };
    expect(planAction(get(fast, 't'), fast, rules({ thieves: ['t'], ranks })).steal).toBeUndefined();
    const full = carrying(s, { t: ['iron-sword', 'iron-sword', 'iron-sword', 'iron-sword', 'iron-sword'] });
    expect(planAction(get(full, 't'), full, rules({ thieves: ['t'], ranks })).steal).toBeUndefined();
  });

  it('steals with its whole movement even when set to Hold', () => {
    const s = carrying(play(unit('p', 'player', [1, 1]), unit('t', 'enemy', [3, 1], 'hold')), { p: ['vulnerary'] });
    expect(planAction(get(s, 't'), s, rules({ thieves: ['t'], ranks }))).toMatchObject({ to: cell(2, 1), steal: { target: 'p', item: 0 } });
  });

  it('goes before lords in the phase, by movement plus 60', () => {
    const s = play(unit('lord', 'enemy', [0, 0]), unit('t', 'enemy', [1, 0]), unit('f', 'enemy', [2, 0]));
    expect(phaseOrder(s.units, s, rules({ lords: ['lord'], thieves: ['t'] }))).toEqual(['f', 't', 'lord']);
  });

  it('heading for a heal point, neither steals nor attacks there', () => {
    // On its fort, beside a bowman who can't strike back: anyone else attacks him.
    const bow: AiItem = { item: 0, staff: false, might: 5, min: 2, max: 2 };
    const s = carrying(withHp(play(unit('p', 'player', [5, 1]), unit('e', 'enemy', [6, 1])), { e: 3 }, true), { p: ['vulnerary'] });
    const setup = { forts: [cell(6, 1)], items: { p: [bow] }, ranks };
    expect(planAction(get(s, 'e'), s, rules(setup))).toMatchObject({ to: cell(6, 1), attack: 'p' });
    const plan = planAction(get(s, 'e'), s, rules({ ...setup, thieves: ['e'] }));
    expect(plan).toEqual({ to: cell(6, 1), route: [cell(6, 1)], attack: null });
  });
});

describe('status staves', () => {
  const staffItem: AiItem = { item: 0, staff: true, might: 0, min: 1, max: 1 };
  const sleep: AiStaff = { item: 0, heal: 0, physic: true, status: 'sleep', reach: 2, rank: 1 };
  const silence: AiStaff = { ...sleep, status: 'silence' };
  const at = (s: PlayState, changes: Record<string, Partial<PlayUnit>>): PlayState => ({ ...s, units: s.units.map((u) => (changes[u.id] ? { ...u, ...changes[u.id] } : u)) });
  // e, holding a staff only, at (5,1) with Mov 2 reaches foes up to 4 away; p at (1,1) and q at (2,0) are.
  const field = () => play(unit('p', 'player', [1, 1]), unit('q', 'player', [2, 0]), unit('e', 'enemy', [5, 1]));

  it('puts to sleep the foe kept last, comparing chance plus level with the last kept level alone', () => {
    // p (level 9) is kept first with "9"; q (level 1) then has 50 + 1, no lower, so it is kept instead.
    const s = at(field(), { p: { level: 9 }, q: { level: 1 } });
    const plan = planAction(get(s, 'e'), s, rules({ items: { e: [staffItem] }, staves: { e: [sleep] } }));
    expect(plan.inflict).toEqual({ target: 'q', item: 0, kind: 'sleep' });
    expect(dist([plan.to % W, Math.floor(plan.to / W)], [2, 0])).toBeLessThanOrEqual(2);
    // Not a foe already asleep, nor one under 5%.
    const asleep = at(s, { q: { status: { kind: 'sleep', turns: 3 } } });
    expect(planAction(get(asleep, 'e'), asleep, rules({ items: { e: [staffItem] }, staves: { e: [sleep] } })).inflict?.target).toBe('p');
    expect(planAction(get(s, 'e'), s, rules({ items: { e: [staffItem] }, staves: { e: [sleep] }, accuracy: 4 })).inflict).toBeUndefined();
  });

  it('silences only a foe that can use a staff, its score kept in a byte', () => {
    const s = at(field(), { q: { level: 3 } });
    const r = (accuracy: number, qMagic = false) =>
      rules({ items: { e: [staffItem], q: [{ ...SWORD, magic: qMagic }, { ...staffItem, item: 1 }] }, staves: { e: [silence] }, accuracy });
    expect(planAction(get(s, 'e'), s, r(50)).inflict).toEqual({ target: 'q', item: 0, kind: 'silence' });
    // 100 + Str 28 = 128, doubled for a magic weapon: 256, which is 0 in a byte, so q isn't silenced.
    const strong = at(s, { q: { stats: { ...STATS, str: 28 } } });
    expect(planAction(get(strong, 'e'), strong, r(100, true)).inflict).toBeUndefined();
    expect(planAction(get(strong, 'e'), strong, r(100, false)).inflict?.target).toBe('q');
  });
});

describe('berserk', () => {
  it('attacks any unit but itself, its own side too', () => {
    // f, e's ally, is beside it; the player unit is out of reach.
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [5, 1]), unit('f', 'enemy', [6, 1]));
    expect(planAction(get(s, 'e'), s, rules()).attack).toBeNull();
    expect(planAction(get(s, 'e'), s, rules(), true)).toMatchObject({ attack: 'f' });
  });

  it('with nothing in reach, heads for the nearest unit of any side, whatever its behaviour', () => {
    const s = play(unit('p', 'player', [0, 1]), unit('e', 'enemy', [6, 1], 'hold'), unit('f', 'enemy', [3, 1]));
    // A Hold unit, berserk, still moves: with Mov 2 it reaches (4,1), beside f, and attacks.
    expect(planAction(get(s, 'e'), s, rules(), true)).toMatchObject({ attack: 'f' });
    const far = play(unit('p', 'player', [0, 0]), unit('e', 'enemy', [6, 2], 'hold'), unit('f', 'enemy', [2, 2]));
    // f is 4 away and out of reach; e walks 2 toward it.
    expect(planAction(get(far, 'e'), far, rules(), true)).toMatchObject({ to: cell(4, 2), attack: null });
  });
});

describe('Restore', () => {
  it('restores the highest-level ally with a status it can reach, ties to the last in the scan', () => {
    const restore: AiStaff = { item: 0, heal: 0, physic: false, restore: true, reach: 1, rank: 1 };
    const s = play(unit('p', 'player', [0, 0]), unit('e', 'enemy', [3, 1]), unit('f', 'enemy', [4, 0]), unit('g', 'enemy', [4, 2]));
    const st = (kind: 'sleep' | 'silence') => ({ kind, turns: 3 });
    const both = { ...s, units: s.units.map((u) => (u.id === 'f' ? { ...u, level: 4, status: st('sleep') } : u.id === 'g' ? { ...u, level: 4, status: st('silence') } : u)) };
    const r = rules({ items: { e: [{ item: 0, staff: true, might: 0, min: 1, max: 1 }] }, staves: { e: [restore] } });
    // Equal levels: f, at (4,0), comes later in the scan from the bottom right than g at (4,2).
    expect(planAction(get(both, 'e'), both, r).restore).toEqual({ target: 'f', item: 0 });
    const higher = { ...both, units: both.units.map((u) => (u.id === 'g' ? { ...u, level: 6 } : u)) };
    expect(planAction(get(higher, 'e'), higher, r).restore).toEqual({ target: 'g', item: 0 });
  });
});
