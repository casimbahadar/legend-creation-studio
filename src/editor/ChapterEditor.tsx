import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  checkProject,
  mapEntry,
  BEHAVIOURS,
  DEFAULT_BEHAVIOUR,
  MAX_ITEMS,
  MAX_LEVEL,
  mapRef,
  newProject,
  projectToJson,
  TEAMS,
  toName,
  type Behaviour,
  type Problem,
  type Project,
  type ProjectUnit,
  type Team,
} from '../core/project';
import { readClasses, type ClassStats } from '../rom/fe8-classes';
import { idleFrame, readMapSprite, readTeamPalettes, renderMapSprite, spriteOrigin, type TeamColour } from '../rom/fe8-map-sprites';
import { readChapterMap, renderMap, type ChapterMap } from '../rom/fe8-maps';
import { checkClassNames, FE8_CLASS_NAMES, type ClassName, type NameMismatch } from '../rom/fe8-names';
import { checkItemNames, FE8_ITEM_NAMES, type ItemMismatch, type ItemName } from '../rom/fe8-item-names';
import { findItemTable, isStaff, isWeapon, readItems, WEAPON_TYPES, type RomItem } from '../rom/fe8-items';
import { attackRange, IMPASSABLE, searchMoves, type MoveSearch } from '../core/movement';
import { battleFrame, type BattleFrame } from '../core/battle-anim';
import { forecast, randomNumbers, resolveBattle, statsAtLevel, type Combatant, type Forecast, type Stats, type Weapon } from '../core/combat';
import { areFoes, startPlay, unitAt, type PlayState, type PlayUnit } from '../core/play';
import {
  canMove as unitCanMove,
  chooseOption,
  endPlayerTurn,
  finishBattle,
  finishWalk,
  menuOptions,
  moveCursor,
  pressA,
  pressB,
  selectedUnit as selectedOf,
  startView,
  stepAI,
  tapAt,
  visibleRoute,
  walkPosition,
  type PlayRules,
  type PlayView,
} from '../core/play-input';
import type { Image } from '../rom/gba-graphics';
import type { GbaRom } from '../rom/gba-rom';
import type { TextTable } from '../rom/text';
import { deviceStore, readAutosave, writeAutosave } from './autosave';

const TEAM_LABELS: Record<Team, string> = { player: 'Player', enemy: 'Enemy', ally: 'Ally' };
const BEHAVIOUR_LABELS: Record<Behaviour, string> = {
  'attack-in-range': 'Attack in range: waits until a target is within reach',
  charge: 'Charge: heads for the other side every turn',
  hold: 'Hold: never moves, attacks anything in reach',
};

/** How long a phase banner shows, and the pause between computer units' actions. */
const BANNER_MS = 1000;
const AI_PAUSE_MS = 700;

/** Range square colours from Endless Chronicle: blue where a unit can move, red where it can attack, as in FE. */
const MOVE_COLOURS = { fill: 'rgba(48, 110, 255, 0.45)', edge: 'rgba(170, 200, 255, 0.8)' };
const ATTACK_COLOURS = { fill: 'rgba(255, 60, 48, 0.42)', edge: 'rgba(255, 170, 160, 0.75)' };

/**
 * One range square, as Endless Chronicle draws them: inset by a pixel with a lighter edge, so the map
 * shows through between squares as grid lines. Drawn at the GBA's own scale (16 pixels per square).
 */
function drawRangeSquare(g: CanvasRenderingContext2D, x: number, y: number, colours: { fill: string; edge: string }) {
  g.fillStyle = colours.fill;
  g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  g.strokeStyle = colours.edge;
  g.lineWidth = 1;
  g.strokeRect(x * 16 + 1.5, y * 16 + 1.5, 13, 13);
}

/**
 * The movement arrow: a light line with a dark outline from the unit to the cursor, ending in an
 * arrowhead, drawn at the GBA's own scale. Colours approximate FE's; they are not taken from the ROM.
 */
function drawArrow(g: CanvasRenderingContext2D, route: readonly number[], width: number) {
  const pts = route.map((k) => [(k % width) * 16 + 8, Math.floor(k / width) * 16 + 8] as const);
  const [ex, ey] = pts[pts.length - 1]!;
  const [px, py] = pts[pts.length - 2]!;
  const dx = Math.sign(ex - px);
  const dy = Math.sign(ey - py);
  // The shaft stops short of the last square's centre so the head can sit there.
  const shaft = [...pts.slice(0, -1), [ex - dx * 2, ey - dy * 2] as const];
  const line = () => {
    g.beginPath();
    shaft.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = '#183078';
  g.lineWidth = 7;
  line();
  g.stroke();
  g.strokeStyle = '#a8dcff';
  g.lineWidth = 4;
  line();
  g.stroke();
  // Head: tip 6 pixels past the centre, base 2 pixels before it, 12 wide.
  g.beginPath();
  g.moveTo(ex + dx * 6, ey + dy * 6);
  g.lineTo(ex - dx * 2 - dy * 6, ey - dy * 2 + dx * 6);
  g.lineTo(ex - dx * 2 + dy * 6, ey - dy * 2 - dx * 6);
  g.closePath();
  g.fillStyle = '#a8dcff';
  g.fill();
  g.strokeStyle = '#183078';
  g.lineWidth = 1.5;
  g.lineJoin = 'miter';
  g.stroke();
}

/** Endless Chronicle's cursor: four yellow corner brackets that step outward and back every 250 ms. */
function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, now: number) {
  const out = Math.floor(now / 250) % 2;
  const arm = 5;
  const thick = 2;
  g.fillStyle = '#ffe680';
  for (const [cx, cy, dx, dy] of [
    [0, 0, 1, 1],
    [1, 0, -1, 1],
    [0, 1, 1, -1],
    [1, 1, -1, -1],
  ] as const) {
    // Corner point, pushed outward on the "out" beat.
    const ox = (x + cx) * 16 - dx * out;
    const oy = (y + cy) * 16 - dy * out;
    g.fillRect(dx > 0 ? ox : ox - thick, dy > 0 ? oy : oy - arm, thick, arm);
    g.fillRect(dx > 0 ? ox : ox - arm, dy > 0 ? oy : oy - thick, arm, thick);
  }
}

/** A listed class with its standing frames in each team's colours, plus grey for units that have moved. */
export interface ClassArt {
  readonly entry: ClassName;
  readonly frames: Record<TeamColour, HTMLCanvasElement[]>;
  /** Base movement and move cost per terrain id from the ROM. */
  readonly mov: number;
  readonly moveCosts: Uint8Array | null;
  /** Starting rank per weapon type (sword, lance, axe, bow, staff, anima, light, dark); 0 = can't use. */
  readonly weaponRanks: Uint8Array;
  readonly base: ClassStats;
  readonly growths: ClassStats;
  readonly terrainAvoid: Uint8Array | null;
  readonly terrainDef: Uint8Array | null;
  readonly terrainRes: Uint8Array | null;
  readonly width: number;
  readonly height: number;
}

/** A listed item with its stats from the ROM. */
export interface EditorItem {
  readonly entry: ItemName;
  readonly rom: RomItem;
}

export interface EditorRom {
  readonly rom: GbaRom;
  readonly maps: ChapterMap[];
  readonly art: ClassArt[];
  readonly mismatches: NameMismatch[];
  readonly items: EditorItem[];
  readonly itemMismatches: ItemMismatch[];
}

function toCanvas(image: Image): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d')?.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return c;
}

/** Everything the editor needs from the ROM, read once when the ROM is chosen. */
export function readEditorRom(rom: GbaRom, text: TextTable, maps: ChapterMap[]): EditorRom {
  const romClasses = readClasses(rom, text);
  const byId = new Map(romClasses.map((c) => [c.id, c]));
  const palettes = readTeamPalettes(rom);
  const art: ClassArt[] = [];
  for (const entry of FE8_CLASS_NAMES) {
    const c = byId.get(entry.id);
    if (!c) continue;
    try {
      const sprite = readMapSprite(rom, c.mapSprite);
      const framesFor = (colour: TeamColour) => [0, 1, 2].map((f) => toCanvas(renderMapSprite(sprite, palettes[colour], f)));
      art.push({
        entry,
        width: sprite.width,
        height: sprite.height,
        frames: { player: framesFor('player'), enemy: framesFor('enemy'), ally: framesFor('ally'), moved: framesFor('moved') },
        mov: c.mov,
        moveCosts: c.moveCosts,
        weaponRanks: c.weaponRanks,
        base: c.base,
        growths: c.growths,
        terrainAvoid: c.terrainAvoid,
        terrainDef: c.terrainDef,
        terrainRes: c.terrainRes,
      });
    } catch {
      // class without a usable map sprite
    }
  }
  const table = findItemTable(rom);
  const romItems = table === null ? [] : readItems(rom, text, table);
  const romItemById = new Map(romItems.map((i) => [i.id, i]));
  const items: EditorItem[] = [];
  for (const entry of FE8_ITEM_NAMES) {
    const it = romItemById.get(entry.id);
    if (it) items.push({ entry, rom: it });
  }
  return { rom, maps, art, mismatches: checkClassNames(romClasses), items, itemMismatches: checkItemNames(romItems) };
}

const layoutKey = (m: ChapterMap) => `${m.width}x${m.height}:${m.cells.join(',')}`;

/** Index in `maps` of the map a reference points to, or -1. Entries that reuse a listed layout resolve to it. */
function findMap(data: EditorRom, ref: string): number {
  const entry = mapEntry(ref);
  if (entry === null) return -1;
  const direct = data.maps.findIndex((m) => m.chapter === entry);
  if (direct >= 0) return direct;
  const map = readChapterMap(data.rom, entry);
  return map ? data.maps.findIndex((m) => layoutKey(m) === layoutKey(map)) : -1;
}

function nextUnitId(units: ProjectUnit[], cls: string): string {
  const taken = new Set(units.map((u) => u.id));
  let n = 1;
  while (taken.has(`${cls}-${n}`)) n++;
  return `${cls}-${n}`;
}

/** Can this class use this item? Weapons and staves need a rank in their type; other items anyone can carry. */
function usable(art: ClassArt, item: EditorItem): boolean {
  if (!isWeapon(item.rom) && !isStaff(item.rom)) return true;
  return item.rom.type < WEAPON_TYPES.length && (art.weaponRanks[item.rom.type] ?? 0) > 0;
}

/** Starting weapon for a newly placed unit: an iron-tier weapon of the first type its class can use. */
const DEFAULT_WEAPONS = ['iron-sword', 'iron-lance', 'iron-axe', 'iron-bow', 'fire', 'lightning', 'flux', 'heal'];
function defaultItems(art: ClassArt, items: EditorItem[]): string[] {
  for (const name of DEFAULT_WEAPONS) {
    const item = items.find((i) => i.entry.name === name);
    if (item && (isWeapon(item.rom) || isStaff(item.rom)) && usable(art, item)) return [name];
  }
  return [];
}

/** Weapon ranges [min, max] a unit can attack with: weapons it carries and its class can use, not staves. */
function weaponRanges(art: ClassArt | undefined, itemNames: readonly string[], items: EditorItem[]): [number, number][] {
  if (!art) return [];
  return itemNames
    .map((n) => items.find((i) => i.entry.name === n))
    .filter((i): i is EditorItem => !!i && isWeapon(i.rom) && !isStaff(i.rom) && usable(art, i))
    .map((i) => [i.rom.minRange, i.rom.maxRange]);
}

/** Weapons a unit can fight with, in inventory order: weapons it carries that its class can use, not staves. */
function weaponsOf(art: ClassArt | undefined, itemNames: readonly string[], items: EditorItem[]): EditorItem[] {
  if (!art) return [];
  return itemNames
    .map((n) => items.find((i) => i.entry.name === n))
    .filter((i): i is EditorItem => !!i && isWeapon(i.rom) && !isStaff(i.rom) && usable(art, i));
}

function toWeapon(item: EditorItem): Weapon {
  const r = item.rom;
  const kind = r.type < WEAPON_TYPES.length ? WEAPON_TYPES[r.type]! : 'other';
  return {
    name: item.entry.gameName,
    kind,
    // Anima, light and dark target Res, as do weapons the ROM marks as magic.
    magic: kind === 'anima' || kind === 'light' || kind === 'dark' || (r.attributes & 2) !== 0,
    might: r.might,
    hit: r.hit,
    crit: r.crit,
    weight: r.weight,
    minRange: r.minRange,
    maxRange: r.maxRange,
  };
}

const distance = (a: PlayUnit, b: PlayUnit) => Math.abs(a.at[0] - b.at[0]) + Math.abs(a.at[1] - b.at[1]);
const inReach = (w: EditorItem, d: number) => d >= w.rom.minRange && d <= w.rom.maxRange;

/** Stats for a class at a level, or a 1 HP stand-in if the class isn't known. */
function classStats(art: ClassArt | undefined, level: number): Stats {
  return art ? statsAtLevel(art.base, art.growths, level) : { hp: 1, str: 0, skl: 0, spd: 0, def: 0, res: 0, lck: 0, con: 0 };
}

/** One-line stats for an item, e.g. "Mt 5 · Hit 90 · Rng 1 · 46 uses". */
function itemStats(i: RomItem): string {
  const rng = i.minRange === i.maxRange ? `${i.minRange}` : `${i.minRange}-${i.maxRange}`;
  if (isWeapon(i) && !isStaff(i)) return `Mt ${i.might} · Hit ${i.hit} · Rng ${rng} · ${i.uses} uses`;
  return `${i.uses} uses`;
}

/** Checks a parsed project file against this ROM: the file itself, its class names, its maps and unit positions. */
function loadProject(data: EditorRom, parsed: unknown): { project: Project | null; problems: Problem[] } {
  const { project, problems } = checkProject(parsed, {
    classes: new Set(data.art.map((a) => a.entry.name)),
    items: new Set(data.items.map((i) => i.entry.name)),
  });
  if (project) {
    project.chapters.forEach((c, ci) => {
      const m = data.maps[findMap(data, c.map)];
      if (!m) problems.push({ path: `chapters[${ci}].map`, message: `The map for "${c.name}" isn't in your ROM.` });
      else
        c.units.forEach((u, ui) => {
          if (u.at[0] >= m.width || u.at[1] >= m.height) problems.push({ path: `chapters[${ci}].units[${ui}].at`, message: `"${u.id}" is outside the map.` });
        });
    });
  }
  return { project: project && !problems.length ? project : null, problems };
}

function saveFile(project: Project) {
  const url = URL.createObjectURL(new Blob([projectToJson(project)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${toName(project.name)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChapterEditor({ data }: { data: EditorRom }) {
  const store = useMemo(() => deviceStore(), []);
  // Restore the autosaved chapter if it still checks out against this ROM; otherwise start fresh.
  const [start] = useState(() => {
    const saved = readAutosave(store);
    const restored = saved ? loadProject(data, saved.project).project : null;
    if (restored) return { project: restored, savedJson: saved!.savedJson, freshJson: null, restored: true };
    const fresh = newProject('My First Chapter', mapRef(data.maps[0]?.chapter ?? 0));
    return { project: fresh, savedJson: null, freshJson: projectToJson(fresh), restored: false };
  });
  const [project, setProject] = useState<Project>(start.project);
  const [savedJson, setSavedJson] = useState<string | null>(start.savedJson);
  const [autosaveOk, setAutosaveOk] = useState(true);
  const [artIndex, setArtIndex] = useState(0);
  const [team, setTeam] = useState<Team>('player');
  const [status, setStatus] = useState<{ ok: boolean; text: string; problems?: Problem[] } | null>(
    start.restored ? { ok: true, text: `Picked up "${start.project.name}" where you left off.` } : null,
  );
  const json = projectToJson(project);
  // An untouched new chapter has nothing to lose, so it doesn't count as unsaved.
  const untouched = savedJson === null && json === start.freshJson;
  const unsaved = !untouched && json !== savedJson;

  useEffect(() => {
    setAutosaveOk(writeAutosave(store, { project, savedJson }));
  }, [store, project, savedJson]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<PlayView | null>(null);
  /** The placed unit whose panel is open in Edit mode. */
  const [editing, setEditing] = useState<string | null>(null);
  const play = view?.state ?? null;

  const chapter = project.chapters[0]!;
  const mapIndex = findMap(data, chapter.map);
  const map = data.maps[mapIndex];
  const artByName = useMemo(() => new Map(data.art.map((a) => [a.entry.name, a])), [data.art]);
  const mapImage = useMemo(() => (map ? toCanvas(renderMap(map)) : null), [map]);
  const selectedUnit = view ? selectedOf(view) : undefined;

  /** Where a unit could move this turn and how, from its class's ROM movement. */
  function searchOf(u: PlayUnit, state: PlayState, mov?: number): MoveSearch {
    const art = artByName.get(u.class);
    const costs = art?.moveCosts;
    const grid = map ?? { width: 1, height: 1, terrain: [0] };
    return searchMoves(grid, (t) => (costs ? (costs[t] ?? IMPASSABLE) : IMPASSABLE), map && art ? (mov ?? art.mov) : 0, u.at, (x, y) => {
      const o = unitAt(state, x, y);
      if (!o || o.id === u.id) return null;
      return areFoes(o.team, u.team) ? 'foe' : 'friend';
    });
  }
  const canMove = unitCanMove(selectedUnit);
  // A unit of yours that has already moved shows no range, as in FE.
  const showRange = !!selectedUnit && (selectedUnit.team !== 'player' || canMove);
  const range = useMemo(() => {
    if (!play || !selectedUnit || !showRange || !map) return null;
    const stops = searchOf(selectedUnit, play).stops;
    const attack = attackRange(stops, map.width, map.height, weaponRanges(artByName.get(selectedUnit.class), selectedUnit.items, data.items));
    return { stops, attack };
  },
    // searchOf only reads map and artByName besides its arguments.
    [play, selectedUnit, showRange, map, artByName],
  );
  const unitLabel = (u: { name?: string; class: string }) => u.name ?? artByName.get(u.class)?.entry.label ?? u.class;

  // One stream of random numbers per test play session.
  const rng = useRef(randomNumbers(Date.now()));

  function combatantOf(u: PlayUnit, weapon: EditorItem | undefined): Combatant {
    const art = artByName.get(u.class);
    const t = map ? (map.terrain[u.at[1] * map.width + u.at[0]] ?? 0) : 0;
    return {
      stats: u.stats,
      hp: u.hp,
      weapon: weapon ? toWeapon(weapon) : null,
      terrain: { avoid: art?.terrainAvoid?.[t] ?? 0, def: art?.terrainDef?.[t] ?? 0, res: art?.terrainRes?.[t] ?? 0 },
    };
  }

  /**
   * A fight's forecast. The attacker uses the first weapon it can use that reaches; the defender
   * counters with its first usable weapon, if that reaches.
   */
  function forecastOf(a: PlayUnit, d: PlayUnit) {
    return forecastFrom(a, a.at, d);
  }

  /** As forecastOf, with the attacker standing on `at` (terrain bonuses from there). */
  function forecastFrom(unit: PlayUnit, at: readonly [number, number], d: PlayUnit) {
    const a = { ...unit, at };
    const dist = distance(a, d);
    const attackerWeapon = weaponsOf(artByName.get(a.class), a.items, data.items).find((w) => inReach(w, dist));
    const defenderWeapon = weaponsOf(artByName.get(d.class), d.items, data.items)[0];
    const attacker = combatantOf(a, attackerWeapon);
    const defender = combatantOf(d, defenderWeapon);
    return { forecast: forecast(attacker, defender, dist), attackerWeapon, defenderWeapon, attacker, defender };
  }

  /** Foes the unit could attack from square `at`, nearest first. */
  function targetsAt(u: PlayUnit, at: readonly [number, number], state: PlayState): PlayUnit[] {
    const weapons = weaponsOf(artByName.get(u.class), u.items, data.items);
    const from = { ...u, at };
    return state.units
      .filter((o) => o.id !== u.id && areFoes(o.team, u.team) && weapons.some((w) => inReach(w, distance(from, o))))
      .sort((a, b) => distance(from, a) - distance(from, b));
  }

  function targetsOf(u: PlayUnit, state: PlayState): string[] {
    return targetsAt(u, u.at, state).map((o) => o.id);
  }

  // searchOf, targetsOf and fight read only map, artByName and the items, so the rules change only when they do.
  const rules = useMemo<PlayRules | null>(
    () =>
      map
        ? {
            width: map.width,
            height: map.height,
            searchOf,
            targetsOf,
            targetsAt,
            forecastAt: (u, at, target) => forecastFrom(u, at, target).forecast,
            fight: (a, d) => {
              const f = forecastOf(a, d);
              return resolveBattle(f.attacker, f.defender, f.forecast, rng.current);
            },
          }
        : null,
    [map, artByName, data.items],
  );
  const arrow = view && rules ? visibleRoute(view, rules) : null;
  // When a walk starts, note the time; the draw loop moves the unit along its route from then on.
  const walk = view?.walking ?? null;
  const walkStart = useRef(0);
  useEffect(() => {
    if (walk) walkStart.current = performance.now();
  }, [walk]);
  // The same for a battle; the HUD (HP bars, damage) updates only when a blow lands, not every frame.
  const battle = view?.battle ?? null;
  const battleStart = useRef(0);
  const battleFrom = useRef({ attackerHp: 0, defenderHp: 0 });
  const [hud, setHud] = useState<BattleFrame | null>(null);
  const hudKey = useRef('');
  useEffect(() => {
    if (!battle || !play) {
      setHud(null);
      hudKey.current = '';
      return;
    }
    battleStart.current = performance.now();
    battleFrom.current = {
      attackerHp: play.units.find((u) => u.id === battle.attacker)?.hp ?? 0,
      defenderHp: play.units.find((u) => u.id === battle.defender)?.hp ?? 0,
    };
  }, [battle]); // play is read only when a battle starts

  // Arrow keys, Z (A) and X (B) for playing on a computer, like an emulator.
  useEffect(() => {
    if (!view || !rules) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[e.key];
      if (dir) setView((v) => v && moveCursor(v, dir[0], dir[1], rules));
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') setView((v) => v && pressA(v, rules));
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Escape') setView((v) => v && pressB(v, rules));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Re-bind only when play starts or stops, or the map changes; the handlers read the latest view via setView.
  }, [view !== null, rules]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g || !mapImage) return;
    c.width = mapImage.width;
    c.height = mapImage.height;
    g.imageSmoothingEnabled = false;
    let raf = 0;
    const units: readonly { class: string; team: Team; at: readonly [number, number]; moved?: boolean }[] = play ? play.units : chapter.units;
    const draw = (now: number) => {
      g.drawImage(mapImage, 0, 0);
      if (range) {
        const w = c.width / 16;
        for (const k of range.stops.keys()) drawRangeSquare(g, k % w, Math.floor(k / w), MOVE_COLOURS);
        for (const k of range.attack) drawRangeSquare(g, k % w, Math.floor(k / w), ATTACK_COLOURS);
      }
      if (arrow) drawArrow(g, arrow, c.width / 16);
      const frame = idleFrame(now);
      let walkDone = false;
      const bf = battle ? battleFrame(battle.strikes, battleFrom.current, now - battleStart.current) : null;
      const striking = bf && bf.index >= 0 ? battle!.strikes[bf.index]! : null;
      const placed = units.map((u) => {
        const walker = walk && play && play.units.find((p) => p.id === walk.id);
        if (battle && bf && striking && play) {
          // The striker lunges a quarter square toward the unit it hits.
          const strikerId = striking.by === 'attacker' ? battle.attacker : battle.defender;
          const otherId = striking.by === 'attacker' ? battle.defender : battle.attacker;
          const other = play.units.find((p) => p.id === otherId);
          if ((u as PlayUnit).id === strikerId && other) {
            const dx = Math.sign(other.at[0] - u.at[0]);
            const dy = Math.sign(other.at[1] - u.at[1]);
            return { u, x: u.at[0] + dx * bf.lunge * 0.25, y: u.at[1] + dy * bf.lunge * 0.25, walking: false };
          }
        }
        if (!walk || walker !== u) return { u, x: u.at[0], y: u.at[1], walking: false };
        const pos = walkPosition(walk.route, c.width / 16, now - walkStart.current);
        walkDone = pos.done;
        return { u, x: pos.x, y: pos.y, walking: !pos.done };
      });
      // Top rows first, so taller sprites lower down overlap the ones behind them.
      for (const { u, x, y, walking } of placed.sort((a, b) => a.y - b.y)) {
        const art = artByName.get(u.class);
        if (!art) continue;
        const [sx, sy] = spriteOrigin(art, x, y);
        // Walking units cycle their frames quickly, as EC does; units that have moved are grey and still, as in FE.
        const img = walking ? art.frames[u.team][[0, 1, 2, 1][Math.floor(now / 110) % 4]!]! : u.moved ? art.frames.moved[0]! : art.frames[u.team][frame]!;
        g.drawImage(img, Math.round(sx), Math.round(sy));
      }
      if (walkDone && rules) setView((v) => v && finishWalk(v, rules));
      if (bf) {
        const key = `${bf.index}:${bf.landed ? battle!.strikes.indexOf(bf.landed) : -1}`;
        if (key !== hudKey.current) {
          hudKey.current = key;
          setHud(bf);
        }
        if (bf.done) setView((v) => v && finishBattle(v));
      }
      if (view && !battle) drawCursor(g, view.cursor[0], view.cursor[1], now);
      const edited = !view && editing ? chapter.units.find((u) => u.id === editing) : undefined;
      if (edited) drawCursor(g, edited.at[0], edited.at[1], now);
      if (units.length) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [mapImage, chapter.units, artByName, play, range, selectedUnit, view, arrow, walk, editing, battle, rules]);

  // The computer's phases: a pause on each phase banner, then one unit at a time.
  const aiTurn = !!view && (view.phase !== 'player' || !!view.banner) && !view.walking && !view.battle;
  useEffect(() => {
    if (!aiTurn || !rules) return;
    const t = window.setTimeout(() => setView((v) => v && stepAI(v, rules)), view?.banner ? BANNER_MS : AI_PAUSE_MS);
    return () => window.clearTimeout(t);
  }, [aiTurn, view, rules]);

  function updateChapter(change: Partial<typeof chapter>) {
    setProject({ ...project, chapters: [{ ...chapter, ...change }] });
  }

  function goTo(i: number) {
    const next = data.maps[i];
    if (!next) return;
    if (chapter.units.length && !window.confirm('Changing the map removes the units you placed. Change it anyway?')) return;
    setEditing(null);
    updateChapter({ map: mapRef(next.chapter), units: [] });
  }

  function onMapTap(event: MouseEvent<HTMLCanvasElement>) {
    const c = event.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * (c.width / 16));
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * (c.height / 16));
    // A tap moves the cursor there and presses A.
    if (view) return rules && setView(tapAt(view, x, y, rules));
    const art = data.art[artIndex];
    if (!map || !art || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const here = chapter.units.find((u) => u.at[0] === x && u.at[1] === y);
    if (here) {
      setEditing(here.id === editing ? null : here.id);
    } else if (editing) {
      // With a unit's panel open, a tap on an empty square only closes it, so a stray tap never places a unit.
      setEditing(null);
    } else {
      const cls = art.entry.name;
      const unit: ProjectUnit = { id: nextUnitId(chapter.units, cls), class: cls, team, level: 1, at: [x, y] };
      const items = defaultItems(art, data.items);
      updateChapter({ units: [...chapter.units, items.length ? { ...unit, items } : unit] });
    }
  }

  /** Raises or lowers a unit's level from its latest value, so a held button keeps counting. */
  function stepLevel(id: string, delta: number) {
    setProject((p) => {
      const ch = p.chapters[0]!;
      const units = ch.units.map((u) => (u.id === id ? { ...u, level: Math.min(MAX_LEVEL, Math.max(1, u.level + delta)) } : u));
      return { ...p, chapters: [{ ...ch, units }, ...p.chapters.slice(1)] };
    });
  }

  function updateUnit(id: string, change: Partial<ProjectUnit> | null) {
    if (!change) {
      setEditing(null);
      updateChapter({ units: chapter.units.filter((u) => u.id !== id) });
    } else {
      updateChapter({ units: chapter.units.map((u) => (u.id === id ? { ...u, ...change } : u)) });
    }
  }

  function setMode(playing: boolean) {
    setEditing(null);
    rng.current = randomNumbers(Date.now());
    setView(playing ? startView(startPlay(chapter, (u) => classStats(artByName.get(u.class), u.level))) : null);
  }

  function onSave() {
    saveFile(project);
    setSavedJson(projectToJson(project));
    setStatus(null);
  }

  async function onOpen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setStatus({ ok: false, text: `Couldn't open ${file.name}: it isn't a project file.` });
      return;
    }
    const { project: opened, problems } = loadProject(data, parsed);
    if (!opened || problems.length) {
      setStatus({ ok: false, text: `Couldn't open ${file.name}:`, problems });
      return;
    }
    if (unsaved && !window.confirm(`Opening ${file.name} replaces changes you haven't saved to a file. Open it anyway?`)) return;
    setMode(false);
    setProject(opened);
    setSavedJson(projectToJson(opened));
    setStatus({ ok: true, text: `Opened "${opened.name}".` });
  }

  const counts = TEAMS.map((t) => [t, chapter.units.filter((u) => u.team === t).length] as const).filter(([, n]) => n > 0);

  return (
    <section className="panel">
      <h2>Your chapter</h2>

      <label className="field">
        Project name
        <input type="text" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
      </label>

      <div className="stepper">
        <button type="button" className="button" disabled={!project.name.trim()} onClick={onSave}>
          Save
        </button>
        <label className="button button-secondary">
          Open
          <input type="file" className="visually-hidden" onChange={onOpen} />
        </label>
      </div>
      <p className="note">
        {untouched ? 'Nothing to save yet.' : unsaved ? 'Changes not saved to a file yet.' : 'Everything is saved to a file.'}{' '}
        {autosaveOk
          ? 'Your chapter is also kept on this device between visits.'
          : "This browser won't keep your chapter between visits (private browsing?), so tap Save before leaving."}
      </p>
      {status && (
        <div className={status.ok ? 'good' : 'bad'} role="status">
          <p>{status.text}</p>
          {status.problems && status.problems.length > 0 && (
            <ul className="problems">
              {status.problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {map ? (
        <>
          <p>
            Map {mapIndex + 1} of {data.maps.length} (chapter entry {map.chapter}), {map.width} × {map.height} tiles
          </p>
          <div className="stepper">
            <button type="button" className="button" disabled={mapIndex <= 0 || !!play} onClick={() => goTo(mapIndex - 1)}>
              Previous map
            </button>
            <button type="button" className="button" disabled={mapIndex >= data.maps.length - 1 || !!play} onClick={() => goTo(mapIndex + 1)}>
              Next map
            </button>
          </div>

          <div className="segmented" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!play} onClick={() => setMode(false)}>
              Edit
            </button>
            <button type="button" aria-pressed={!!play} disabled={!chapter.units.length} onClick={() => setMode(true)}>
              Test play
            </button>
          </div>

          {play && (
            <PlayStatus
              play={play}
              selected={selectedUnit}
              canMove={canMove}
              phase={view && view.phase !== 'player' ? view.phase : view?.battle ? 'battle' : view?.walking ? 'walk' : (view?.action?.kind ?? null)}
              label={(u) => artByName.get(u.class)?.entry.label ?? u.class}
              onEndTurn={() => setView((v) => v && endPlayerTurn(v))}
            />
          )}

          {!play && data.art.length > 0 && (
            <div className="unit-controls">
              <label className="field">
                Class
                <select value={artIndex} onChange={(e) => setArtIndex(Number(e.target.value))}>
                  {data.art.map((a, i) => (
                    <option key={a.entry.name} value={i}>
                      {a.entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="segmented" role="group" aria-label="Team">
                {TEAMS.map((t) => (
                  <button key={t} type="button" aria-pressed={team === t} onClick={() => setTeam(t)}>
                    {TEAM_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="note">Tap an empty square to place a unit. Tap a unit to change its items or remove it.</p>
            </div>
          )}

          {view && (
            <div className="play-window" aria-live="polite">
              {(() => {
                const a = view.action;
                if (a?.kind === 'target') {
                  const atk = view.state.units.find((u) => u.id === a.unit);
                  const def = view.state.units.find((u) => u.id === a.targets[a.index]);
                  if (!atk || !def) return null;
                  const f = forecastOf(atk, def);
                  return <ForecastBox a={atk} d={def} f={f.forecast} aWeapon={f.attackerWeapon?.entry.gameName} dWeapon={f.defenderWeapon?.entry.gameName} label={unitLabel} />;
                }
                if (battle && hud) {
                  return <BattleHud battle={battle} frame={hud} units={view.state.units} maxHp={(id: string) => view.state.units.find((u) => u.id === id)?.stats.hp ?? 1} label={unitLabel} />;
                }
                const u = unitAt(view.state, view.cursor[0], view.cursor[1]);
                if (!u) return null;
                const w = weaponsOf(artByName.get(u.class), u.items, data.items)[0];
                return (
                  <div className={`window-side team-${u.team}`}>
                    <strong>{unitLabel(u)}</strong>
                    <span>
                      Lv {u.level} · HP {u.hp}/{u.stats.hp} · {w ? w.entry.gameName : 'No weapon'}
                    </span>
                    <span>
                      Str {u.stats.str} · Skl {u.stats.skl} · Spd {u.stats.spd} · Lck {u.stats.lck} · Def {u.stats.def} · Res {u.stats.res}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
          <div className="map-wrap">
            <canvas ref={canvas} className="map" aria-label="Chapter map" onClick={onMapTap} />
            {view &&
              rules &&
              view.action?.kind === 'menu' &&
              (() => {
                const u = view.state.units.find((x) => x.id === view.action!.unit);
                // The menu opens on the side of the map away from the unit, as in FE.
                const side = u && u.at[0] >= rules.width / 2 ? 'left' : 'right';
                return (
                  <div className={`action-menu ${side}`} role="menu">
                    {menuOptions(view, rules).map((o, i) => (
                      <button
                        key={o}
                        type="button"
                        role="menuitem"
                        aria-current={view.action?.index === i}
                        onClick={() => setView((v) => v && chooseOption(v, o, rules))}
                      >
                        {o === 'attack' ? 'Attack' : 'Wait'}
                      </button>
                    ))}
                  </div>
                );
              })()}
            {view?.banner && (
              <div className={`phase-banner phase-${view.banner}`} role="status">
                {view.banner === 'player' ? 'Player Phase' : view.banner === 'enemy' ? 'Enemy Phase' : 'Ally Phase'}
              </div>
            )}
            {view && battle && hud && map && <BattlePopup battle={battle} frame={hud} units={view.state.units} width={map.width} height={map.height} />}
          </div>
          {!view &&
            editing &&
            (() => {
              const unit = chapter.units.find((u) => u.id === editing);
              return unit ? (
                <UnitPanel
                  unit={unit}
                  art={artByName.get(unit.class)}
                  items={data.items}
                  onChange={(change) => updateUnit(unit.id, change)}
                  onLevelStep={(delta) => stepLevel(unit.id, delta)}
                  onClose={() => setEditing(null)}
                />
              ) : null;
            })()}
          {view && rules && (
            <GbaControls
              onDirection={(dx, dy) => setView((v) => v && moveCursor(v, dx, dy, rules))}
              onA={() => setView((v) => v && pressA(v, rules))}
              onB={() => setView((v) => v && pressB(v, rules))}
            />
          )}
          {view && (
            <p className="note">
              You can also tap a square: that moves the cursor there and presses A. On a computer, use the arrow keys, Z for A and X for B.
              Test play doesn't change your chapter.
            </p>
          )}
          <p className="note">
            {counts.length
              ? `${chapter.units.length} ${chapter.units.length === 1 ? 'unit' : 'units'}: ${counts.map(([t, n]) => `${n} ${TEAM_LABELS[t].toLowerCase()}`).join(', ')}`
              : 'No units yet.'}
          </p>
        </>
      ) : (
        <p className="bad">Couldn't find any chapter maps in this ROM.</p>
      )}

      {data.mismatches.length ? (
        <details className="note bad">
          <summary>
            Name list check: {data.mismatches.length} of {FE8_CLASS_NAMES.length} class names don't match your ROM. Tap to see
            them.
          </summary>
          <ul className="problems">
            {data.mismatches.map((m) => (
              <li key={m.entry.name}>
                {m.entry.name} (class 0x{m.entry.id.toString(16).toUpperCase()}): expected "{m.entry.gameName}", ROM shows{' '}
                {m.romName === null ? 'nothing' : `"${m.romName}"`}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="note">Name list check: all {FE8_CLASS_NAMES.length} class names match your ROM.</p>
      )}
      {data.itemMismatches.length ? (
        <details className="note bad">
          <summary>
            Item list check: {data.itemMismatches.length} of {FE8_ITEM_NAMES.length} item names don't match your ROM. Tap to see them.
          </summary>
          <ul className="problems">
            {data.itemMismatches.map((m) => (
              <li key={m.entry.name}>
                {m.entry.name} (item 0x{m.entry.id.toString(16).toUpperCase()}): expected "{m.entry.gameName}", ROM shows{' '}
                {m.romName === null ? 'nothing' : `"${m.romName}"`}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="note">Item list check: all {FE8_ITEM_NAMES.length} item names match your ROM.</p>
      )}
    </section>
  );
}

function PlayStatus({
  play,
  selected,
  canMove,
  phase,
  label,
  onEndTurn,
}: {
  play: PlayState;
  selected: PlayUnit | undefined;
  canMove: boolean;
  /** What the player is in the middle of, if anything. */
  phase: 'walk' | 'menu' | 'target' | 'battle' | 'enemy' | 'ally' | null;
  label: (u: PlayUnit) => string;
  onEndTurn: () => void;
}) {
  const yours = play.units.filter((u) => u.team === 'player');
  const allMoved = yours.length > 0 && yours.every((u) => u.moved);
  let hint: string;
  if (phase === 'enemy') hint = 'Enemy phase: the enemies are moving.';
  else if (phase === 'ally') hint = 'Ally phase: the green units are moving.';
  else if (phase === 'menu') hint = 'Choose Attack or Wait with ▲▼ and A, or tap it. B takes the move back.';
  else if (phase === 'target') hint = 'Choose a target with the arrows or by tapping it, then press A to attack. B goes back.';
  else if (phase === 'battle' || phase === 'walk') hint = '…';
  else if (selected && canMove) hint = `Move the cursor to a blue square and press A to move your ${label(selected)} there. Red squares are in reach of its weapons. Press A on the unit itself to act without moving, or B to cancel.`;
  else if (selected && selected.team === 'player') hint = `Your ${label(selected)} has already acted this turn. Press B to go back.`;
  else if (selected) hint = `This ${TEAM_LABELS[selected.team].toLowerCase()} ${label(selected)} can move to the blue squares and attack the red ones. Press A or B to close.`;
  else if (allMoved) hint = 'All your units have acted. Tap End turn.';
  else hint = 'Move the cursor onto one of your units and press A. Press A on an enemy to see how far it can move.';
  return (
    <div className="play-status">
      <p>
        <strong>Turn {play.turn}.</strong> {hint}
      </p>
      <div className="stepper">
        <button type="button" className="button" disabled={phase !== null} onClick={onEndTurn}>
          End turn
        </button>
      </div>
    </div>
  );
}

/** FE's battle forecast: each side's weapon, HP, damage (×2 if it strikes twice), hit and crit. */
function ForecastBox({
  a,
  d,
  f,
  aWeapon,
  dWeapon,
  label,
}: {
  a: PlayUnit;
  d: PlayUnit;
  f: Forecast;
  aWeapon?: string;
  dWeapon?: string;
  label: (u: PlayUnit) => string;
}) {
  const col = (u: PlayUnit, s: Forecast['attacker'], weapon: string | undefined) => (
    <div className={`window-side team-${u.team}`}>
      <strong>{label(u)}</strong>
      <span>
        {weapon ?? 'No weapon'} · HP {u.hp}
      </span>
      <span>{s.canAttack ? `Dmg ${s.damage}${s.doubles ? ' ×2' : ''} · Hit ${s.hit} · Crit ${s.crit}` : "Can't counter"}</span>
    </div>
  );
  return (
    <>
      {col(a, f.attacker, aWeapon)}
      {col(d, f.defender, dWeapon)}
    </>
  );
}

/** HP bars for both units during a battle. */
function BattleHud({
  battle,
  frame,
  units,
  maxHp,
  label,
}: {
  battle: NonNullable<PlayView['battle']>;
  frame: BattleFrame;
  units: readonly PlayUnit[];
  maxHp: (id: string) => number;
  label: (u: PlayUnit) => string;
}) {
  const attacker = units.find((u) => u.id === battle.attacker);
  const defender = units.find((u) => u.id === battle.defender);
  if (!attacker || !defender) return null;
  const bar = (u: PlayUnit, hp: number) => (
    <div className={`window-side team-${u.team}`}>
      <strong>{label(u)}</strong>
      <span>HP {hp}</span>
      <div className="hp-bar">
        <div style={{ width: `${(100 * hp) / maxHp(u.id)}%` }} />
      </div>
    </div>
  );
  return (
    <>
      {bar(attacker, frame.attackerHp)}
      {bar(defender, frame.defenderHp)}
    </>
  );
}

/** The result of the last blow, shown over the unit it hit. */
function BattlePopup({
  battle,
  frame,
  units,
  width,
  height,
}: {
  battle: NonNullable<PlayView['battle']>;
  frame: BattleFrame;
  units: readonly PlayUnit[];
  width: number;
  height: number;
}) {
  const l = frame.landed;
  if (!l) return null;
  const target = units.find((u) => u.id === (l.by === 'attacker' ? battle.defender : battle.attacker));
  if (!target) return null;
  return (
    <div
      key={battle.strikes.indexOf(l)}
      className={`popup ${l.hit ? (l.crit ? 'crit' : 'hit') : 'miss'}`}
      style={{ left: `${((target.at[0] + 0.5) / width) * 100}%`, top: `${(target.at[1] / height) * 100}%` }}
    >
      {l.hit ? (l.crit ? `Critical! ${l.damage}` : l.damage) : 'Miss'}
    </div>
  );
}

const REPEAT_DELAY = 300;
/** Level buttons repeat a little slower than the D-pad, so a held button is easy to stop on a number. */
const LEVEL_REPEAT_EVERY = 120;
const REPEAT_EVERY = 80;

/** On-screen GBA buttons: a D-pad that repeats while held, and A and B. */
/**
 * Pointer handlers for a button that acts once when pressed and then repeats while held, like the
 * GBA's D-pad. preventDefault stops Safari selecting text or opening its menu on a long press.
 */
function useHoldRepeat(every = REPEAT_EVERY) {
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);
  return (action: () => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      stop();
      action();
      timers.current.delay = window.setTimeout(() => {
        timers.current.repeat = window.setInterval(action, every);
      }, REPEAT_DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });
}

function GbaControls({ onDirection, onA, onB }: { onDirection: (dx: number, dy: number) => void; onA: () => void; onB: () => void }) {
  const repeat = useHoldRepeat();
  const hold = (dx: number, dy: number) => repeat(() => onDirection(dx, dy));
  const press = (action: () => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      action();
    },
  });

  return (
    <div className="gba-controls">
      <div className="dpad" role="group" aria-label="Direction pad">
        <button type="button" className="dpad-up" aria-label="Up" {...hold(0, -1)}>▲</button>
        <button type="button" className="dpad-left" aria-label="Left" {...hold(-1, 0)}>◀</button>
        <button type="button" className="dpad-right" aria-label="Right" {...hold(1, 0)}>▶</button>
        <button type="button" className="dpad-down" aria-label="Down" {...hold(0, 1)}>▼</button>
      </div>
      <div className="ab">
        <button type="button" className="ab-b" aria-label="B" {...press(onB)}>B</button>
        <button type="button" className="ab-a" aria-label="A" {...press(onA)}>A</button>
      </div>
    </div>
  );
}

/** The panel for a placed unit in Edit mode: its items, and removing it. */
function UnitPanel({
  unit,
  art,
  items,
  onChange,
  onLevelStep,
  onClose,
}: {
  unit: ProjectUnit;
  art: ClassArt | undefined;
  items: EditorItem[];
  /** A change to the unit, or null to remove it. */
  onChange: (change: Partial<ProjectUnit> | null) => void;
  /** Raise (+1) or lower (-1) the level. */
  onLevelStep: (delta: number) => void;
  onClose: () => void;
}) {
  const repeat = useHoldRepeat(LEVEL_REPEAT_EVERY);
  const carried = unit.items ?? [];
  const byName = new Map(items.map((i) => [i.entry.name, i]));
  const choices = art ? items.filter((i) => usable(art, i)) : [];
  const setItems = (next: string[]) => onChange({ items: next.length ? next : undefined });
  const title = `${unit.name ?? art?.entry.label ?? unit.class} (${TEAM_LABELS[unit.team].toLowerCase()})`;
  const st = classStats(art, unit.level);
  return (
    <div className="unit-panel">
      <h3>{title}</h3>
      <div className="level-row">
        <label htmlFor={`level-${unit.id}`}>Level</label>
        <button type="button" className="icon-button" aria-label="Lower level" disabled={unit.level <= 1} {...repeat(() => onLevelStep(-1))}>
          −
        </button>
        <LevelInput id={`level-${unit.id}`} level={unit.level} onLevel={(level) => onChange({ level })} />
        <button type="button" className="icon-button" aria-label="Raise level" disabled={unit.level >= MAX_LEVEL} {...repeat(() => onLevelStep(1))}>
          +
        </button>
      </div>
      <p className="note">
        HP {st.hp} · Str {st.str} · Skl {st.skl} · Spd {st.spd} · Lck {st.lck} · Def {st.def} · Res {st.res} · Con {st.con}
        {art ? ` · Mov ${art.mov}` : ''}
      </p>
      {unit.team !== 'player' && (
        <label className="field">
          Behaviour
          <select value={unit.ai ?? DEFAULT_BEHAVIOUR} onChange={(e) => onChange({ ai: e.target.value as Behaviour })}>
            {BEHAVIOURS.map((b) => (
              <option key={b} value={b}>
                {BEHAVIOUR_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="note">
        Items ({carried.length} of {MAX_ITEMS})
      </p>
      {carried.length ? (
        <ul className="inventory">
          {carried.map((name, i) => {
            const item = byName.get(name);
            return (
              <li key={i}>
                <span>
                  <strong>{item?.entry.gameName ?? name}</strong>
                  {item && <span className="note"> {itemStats(item.rom)}</span>}
                  {item && art && !usable(art, item) && <span className="bad"> (this class can't use it)</span>}
                </span>
                <button type="button" className="icon-button" aria-label={`Remove ${item?.entry.gameName ?? name}`} onClick={() => setItems(carried.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="note">No items. Without a weapon this unit can't attack.</p>
      )}
      <label className="field">
        Add an item
        <select
          value=""
          disabled={carried.length >= MAX_ITEMS}
          onChange={(e) => {
            if (e.target.value) setItems([...carried, e.target.value]);
          }}
        >
          <option value="">{carried.length >= MAX_ITEMS ? 'Inventory full' : 'Choose…'}</option>
          {choices.map((i) => (
            <option key={i.entry.name} value={i.entry.name}>
              {i.entry.gameName} ({itemStats(i.rom)})
            </option>
          ))}
        </select>
      </label>
      <div className="stepper">
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
        <button type="button" className="button button-secondary" onClick={() => onChange(null)}>
          Remove unit
        </button>
      </div>
    </div>
  );
}

/** A level you can type: digits only, applied when it is a level from 1 to 20, put back otherwise. */
function LevelInput({ id, level, onLevel }: { id: string; level: number; onLevel: (level: number) => void }) {
  const [draft, setDraft] = useState(String(level));
  useEffect(() => setDraft(String(level)), [level]);
  return (
    <input
      id={id}
      className="level-input"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onChange={(e) => {
        const text = e.target.value.replace(/\D/g, '').slice(0, 2);
        setDraft(text);
        const n = Number(text);
        if (text && n >= 1 && n <= MAX_LEVEL) onLevel(n);
      }}
      onBlur={() => setDraft(String(level))}
    />
  );
}
