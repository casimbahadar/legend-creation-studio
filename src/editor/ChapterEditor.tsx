import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  checkProject,
  mapEntry,
  MAX_ITEMS,
  mapRef,
  newProject,
  projectToJson,
  TEAMS,
  toName,
  type Problem,
  type Project,
  type ProjectUnit,
  type Team,
} from '../core/project';
import { readClasses } from '../rom/fe8-classes';
import { idleFrame, readMapSprite, readTeamPalettes, renderMapSprite, spriteOrigin, type TeamColour } from '../rom/fe8-map-sprites';
import { readChapterMap, renderMap, type ChapterMap } from '../rom/fe8-maps';
import { checkClassNames, FE8_CLASS_NAMES, type ClassName, type NameMismatch } from '../rom/fe8-names';
import { checkItemNames, FE8_ITEM_NAMES, type ItemMismatch, type ItemName } from '../rom/fe8-item-names';
import { findItemTable, isStaff, isWeapon, readItems, WEAPON_TYPES, type RomItem } from '../rom/fe8-items';
import { attackRange, IMPASSABLE, searchMoves, type MoveSearch } from '../core/movement';
import { areFoes, endTurn, startPlay, unitAt, type PlayState, type PlayUnit } from '../core/play';
import {
  canMove as unitCanMove,
  finishWalk,
  moveCursor,
  pressA,
  pressB,
  selectedUnit as selectedOf,
  startView,
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
  function searchOf(u: PlayUnit, state: PlayState): MoveSearch {
    const art = artByName.get(u.class);
    const costs = art?.moveCosts;
    const grid = map ?? { width: 1, height: 1, terrain: [0] };
    return searchMoves(grid, (t) => (costs ? (costs[t] ?? IMPASSABLE) : IMPASSABLE), map && art ? art.mov : 0, u.at, (x, y) => {
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
  // searchOf reads only map and artByName, so the rules change only when they do.
  const rules = useMemo<PlayRules | null>(() => (map ? { width: map.width, height: map.height, searchOf } : null), [map, artByName]);
  const arrow = view && rules ? visibleRoute(view, rules) : null;
  // When a walk starts, note the time; the draw loop moves the unit along its route from then on.
  const walk = view?.walking ?? null;
  const walkStart = useRef(0);
  useEffect(() => {
    if (walk) walkStart.current = performance.now();
  }, [walk]);

  // Arrow keys, Z (A) and X (B) for playing on a computer, like an emulator.
  useEffect(() => {
    if (!view || !rules) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[e.key];
      if (dir) setView((v) => v && moveCursor(v, dir[0], dir[1], rules));
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') setView((v) => v && pressA(v, rules));
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Escape') setView((v) => v && pressB(v));
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
      const placed = units.map((u) => {
        const walker = walk && play && play.units.find((p) => p.id === walk.id);
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
      if (walkDone) setView((v) => v && finishWalk(v));
      if (view) drawCursor(g, view.cursor[0], view.cursor[1], now);
      const edited = !view && editing ? chapter.units.find((u) => u.id === editing) : undefined;
      if (edited) drawCursor(g, edited.at[0], edited.at[1], now);
      if (units.length) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [mapImage, chapter.units, artByName, play, range, selectedUnit, view, arrow, walk, editing]);

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
    setView(playing ? startView(startPlay(chapter)) : null);
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
              label={(u) => artByName.get(u.class)?.entry.label ?? u.class}
              onEndTurn={() => setView((v) => v && { ...v, state: endTurn(v.state), selected: null })}
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

          <canvas ref={canvas} className="map" aria-label="Chapter map" onClick={onMapTap} />
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
                  onClose={() => setEditing(null)}
                />
              ) : null;
            })()}
          {view && rules && (
            <GbaControls
              onDirection={(dx, dy) => setView((v) => v && moveCursor(v, dx, dy, rules))}
              onA={() => setView((v) => v && pressA(v, rules))}
              onB={() => setView((v) => v && pressB(v))}
            />
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
  label,
  onEndTurn,
}: {
  play: PlayState;
  selected: PlayUnit | undefined;
  canMove: boolean;
  label: (u: PlayUnit) => string;
  onEndTurn: () => void;
}) {
  const yours = play.units.filter((u) => u.team === 'player');
  const allMoved = yours.length > 0 && yours.every((u) => u.moved);
  let hint: string;
  if (selected && canMove) hint = `Move the cursor to a blue square and press A to move your ${label(selected)} there. Red squares are in reach of its weapons. Press A on the unit itself to wait, or B to cancel.`;
  else if (selected && selected.team === 'player') hint = `Your ${label(selected)} has already moved this turn. Press B to go back.`;
  else if (selected) hint = `This ${TEAM_LABELS[selected.team].toLowerCase()} ${label(selected)} can move to the blue squares and attack the red ones. Press A or B to close.`;
  else if (allMoved) hint = 'All your units have moved. Tap End turn.';
  else hint = 'Move the cursor onto one of your units and press A. Press A on an enemy to see how far it can move.';
  return (
    <div className="play-status">
      <p>
        <strong>Turn {play.turn}.</strong> {hint}
      </p>
      <div className="stepper">
        <button type="button" className="button" onClick={onEndTurn}>
          End turn
        </button>
      </div>
      <p className="note">
        You can also tap a square: that moves the cursor there and presses A. On a computer, use the arrow keys, Z for A and X for B.
        Test play doesn't change your chapter. Enemies don't move yet.
      </p>
    </div>
  );
}

const REPEAT_DELAY = 300;
const REPEAT_EVERY = 80;

/** On-screen GBA buttons: a D-pad that repeats while held, and A and B. */
function GbaControls({ onDirection, onA, onB }: { onDirection: (dx: number, dy: number) => void; onA: () => void; onB: () => void }) {
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);

  const hold = (dx: number, dy: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      stop();
      onDirection(dx, dy);
      timers.current.delay = window.setTimeout(() => {
        timers.current.repeat = window.setInterval(() => onDirection(dx, dy), REPEAT_EVERY);
      }, REPEAT_DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  });
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
  onClose,
}: {
  unit: ProjectUnit;
  art: ClassArt | undefined;
  items: EditorItem[];
  /** A change to the unit, or null to remove it. */
  onChange: (change: Partial<ProjectUnit> | null) => void;
  onClose: () => void;
}) {
  const carried = unit.items ?? [];
  const byName = new Map(items.map((i) => [i.entry.name, i]));
  const choices = art ? items.filter((i) => usable(art, i)) : [];
  const setItems = (next: string[]) => onChange({ items: next.length ? next : undefined });
  const title = `${unit.name ?? art?.entry.label ?? unit.class} (${TEAM_LABELS[unit.team].toLowerCase()})`;
  return (
    <div className="unit-panel">
      <h3>{title}</h3>
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
