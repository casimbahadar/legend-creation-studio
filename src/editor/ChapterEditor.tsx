import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import {
  checkProject,
  mapEntry,
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
import { IMPASSABLE, moveRange } from '../core/movement';
import { areFoes, endTurn, moveUnit, startPlay, unitAt, type PlayState, type PlayUnit } from '../core/play';
import type { Image } from '../rom/gba-graphics';
import type { GbaRom } from '../rom/gba-rom';
import type { TextTable } from '../rom/text';
import { deviceStore, readAutosave, writeAutosave } from './autosave';

const TEAM_LABELS: Record<Team, string> = { player: 'Player', enemy: 'Enemy', ally: 'Ally' };

/** Range square colours from Endless Chronicle: blue for your units, red for enemies, green for allies. */
const RANGE_COLOURS: Record<Team, { fill: string; edge: string }> = {
  player: { fill: 'rgba(48, 110, 255, 0.45)', edge: 'rgba(170, 200, 255, 0.8)' },
  enemy: { fill: 'rgba(255, 60, 48, 0.42)', edge: 'rgba(255, 170, 160, 0.75)' },
  ally: { fill: 'rgba(60, 220, 90, 0.42)', edge: 'rgba(170, 255, 180, 0.75)' },
};

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
  readonly width: number;
  readonly height: number;
}

export interface EditorRom {
  readonly rom: GbaRom;
  readonly maps: ChapterMap[];
  readonly art: ClassArt[];
  readonly mismatches: NameMismatch[];
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
      });
    } catch {
      // class without a usable map sprite
    }
  }
  return { rom, maps, art, mismatches: checkClassNames(romClasses) };
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

/** Checks a parsed project file against this ROM: the file itself, its class names, its maps and unit positions. */
function loadProject(data: EditorRom, parsed: unknown): { project: Project | null; problems: Problem[] } {
  const { project, problems } = checkProject(parsed, { classes: new Set(data.art.map((a) => a.entry.name)) });
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
  const [play, setPlay] = useState<PlayState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const chapter = project.chapters[0]!;
  const mapIndex = findMap(data, chapter.map);
  const map = data.maps[mapIndex];
  const artByName = useMemo(() => new Map(data.art.map((a) => [a.entry.name, a])), [data.art]);
  const mapImage = useMemo(() => (map ? toCanvas(renderMap(map)) : null), [map]);
  const selectedUnit = play && selected ? play.units.find((u) => u.id === selected) : undefined;

  /** Where a unit could move this turn, from its class's ROM movement. */
  function rangeOf(u: PlayUnit, state: PlayState): Map<number, number> {
    const art = artByName.get(u.class);
    if (!map || !art) return new Map();
    const costs = art.moveCosts;
    return moveRange(map, (t) => (costs ? (costs[t] ?? IMPASSABLE) : IMPASSABLE), art.mov, u.at, (x, y) => {
      const o = unitAt(state, x, y);
      if (!o || o.id === u.id) return null;
      return areFoes(o.team, u.team) ? 'foe' : 'friend';
    });
  }
  const canMove = !!selectedUnit && selectedUnit.team === 'player' && !selectedUnit.moved;
  // A unit of yours that has already moved shows no range, as in FE.
  const showRange = !!selectedUnit && (selectedUnit.team !== 'player' || canMove);
  const range = useMemo(
    () => (play && selectedUnit && showRange ? rangeOf(selectedUnit, play) : null),
    // rangeOf only reads map and artByName besides its arguments.
    [play, selectedUnit, showRange, map, artByName],
  );

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
      if (range && selectedUnit) {
        const w = c.width / 16;
        for (const k of range.keys()) drawRangeSquare(g, k % w, Math.floor(k / w), RANGE_COLOURS[selectedUnit.team]);
      }
      const frame = idleFrame(now);
      // Top rows first, so taller sprites lower down overlap the ones behind them.
      for (const u of [...units].sort((a, b) => a.at[1] - b.at[1])) {
        const art = artByName.get(u.class);
        if (!art) continue;
        const [sx, sy] = spriteOrigin(art, u.at[0], u.at[1]);
        // Units that have moved are grey and stand still, as in FE.
        g.drawImage(u.moved ? art.frames.moved[0]! : art.frames[u.team][frame]!, sx, sy);
      }
      if (selectedUnit) drawCursor(g, selectedUnit.at[0], selectedUnit.at[1], now);
      if (units.length) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [mapImage, chapter.units, artByName, play, range, selectedUnit]);

  function updateChapter(change: Partial<typeof chapter>) {
    setProject({ ...project, chapters: [{ ...chapter, ...change }] });
  }

  function goTo(i: number) {
    const next = data.maps[i];
    if (!next) return;
    if (chapter.units.length && !window.confirm('Changing the map removes the units you placed. Change it anyway?')) return;
    updateChapter({ map: mapRef(next.chapter), units: [] });
  }

  function onMapTap(event: MouseEvent<HTMLCanvasElement>) {
    const c = event.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * (c.width / 16));
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * (c.height / 16));
    if (play) return onPlayTap(play, x, y);
    const art = data.art[artIndex];
    if (!map || !art || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const here = chapter.units.find((u) => u.at[0] === x && u.at[1] === y);
    if (here) {
      updateChapter({ units: chapter.units.filter((u) => u !== here) });
    } else {
      const cls = art.entry.name;
      updateChapter({ units: [...chapter.units, { id: nextUnitId(chapter.units, cls), class: cls, team, level: 1, at: [x, y] }] });
    }
  }

  function onPlayTap(state: PlayState, x: number, y: number) {
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const here = unitAt(state, x, y);
    if (canMove && selectedUnit && range?.has(y * map.width + x)) {
      // Tapping the unit's own square makes it wait where it is.
      setPlay(moveUnit(state, selectedUnit.id, [x, y]));
      setSelected(null);
    } else if (here && here.id !== selected) {
      setSelected(here.id);
    } else {
      setSelected(null);
    }
  }

  function setMode(playing: boolean) {
    setPlay(playing ? startPlay(chapter) : null);
    setSelected(null);
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

          {play && <PlayStatus play={play} selected={selectedUnit} canMove={canMove} label={(u) => artByName.get(u.class)?.entry.label ?? u.class} onEndTurn={() => { setPlay(endTurn(play)); setSelected(null); }} />}

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
              <p className="note">Tap the map to place a unit. Tap it again to remove it.</p>
            </div>
          )}

          <canvas ref={canvas} className="map" aria-label="Chapter map" onClick={onMapTap} />
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
  if (selected && canMove) hint = `Tap a blue square to move your ${label(selected)}, or tap it again to wait where it is.`;
  else if (selected && selected.team === 'player') hint = `Your ${label(selected)} has already moved this turn.`;
  else if (selected) hint = `This ${TEAM_LABELS[selected.team].toLowerCase()} ${label(selected)} can reach the highlighted squares.`;
  else if (allMoved) hint = 'All your units have moved. Tap End turn.';
  else hint = 'Tap one of your units to move it. Tap an enemy to see how far it can move.';
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
      <p className="note">Test play doesn't change your chapter. Enemies don't move yet.</p>
    </div>
  );
}
