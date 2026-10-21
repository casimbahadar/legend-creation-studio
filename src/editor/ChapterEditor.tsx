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
import { idleFrame, readMapSprite, readTeamPalettes, renderMapSprite, spriteOrigin } from '../rom/fe8-map-sprites';
import { readChapterMap, renderMap, type ChapterMap } from '../rom/fe8-maps';
import { checkClassNames, FE8_CLASS_NAMES, type ClassName, type NameMismatch } from '../rom/fe8-names';
import type { Image } from '../rom/gba-graphics';
import type { GbaRom } from '../rom/gba-rom';
import type { TextTable } from '../rom/text';
import { deviceStore, readAutosave, writeAutosave } from './autosave';

const TEAM_LABELS: Record<Team, string> = { player: 'Player', enemy: 'Enemy', ally: 'Ally' };

/** A listed class with its standing frames in each team's colours. */
export interface ClassArt {
  readonly entry: ClassName;
  readonly frames: Record<Team, HTMLCanvasElement[]>;
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
      const framesFor = (team: Team) => [0, 1, 2].map((f) => toCanvas(renderMapSprite(sprite, palettes[team], f)));
      art.push({ entry, width: sprite.width, height: sprite.height, frames: { player: framesFor('player'), enemy: framesFor('enemy'), ally: framesFor('ally') } });
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

  const chapter = project.chapters[0]!;
  const mapIndex = findMap(data, chapter.map);
  const map = data.maps[mapIndex];
  const artByName = useMemo(() => new Map(data.art.map((a) => [a.entry.name, a])), [data.art]);
  const mapImage = useMemo(() => (map ? toCanvas(renderMap(map)) : null), [map]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g || !mapImage) return;
    c.width = mapImage.width;
    c.height = mapImage.height;
    g.imageSmoothingEnabled = false;
    let raf = 0;
    const draw = (now: number) => {
      g.drawImage(mapImage, 0, 0);
      const frame = idleFrame(now);
      // Top rows first, so taller sprites lower down overlap the ones behind them.
      for (const u of [...chapter.units].sort((a, b) => a.at[1] - b.at[1])) {
        const art = artByName.get(u.class);
        if (!art) continue;
        const [sx, sy] = spriteOrigin(art, u.at[0], u.at[1]);
        g.drawImage(art.frames[u.team][frame]!, sx, sy);
      }
      if (chapter.units.length) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [mapImage, chapter.units, artByName]);

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
            <button type="button" className="button" disabled={mapIndex <= 0} onClick={() => goTo(mapIndex - 1)}>
              Previous map
            </button>
            <button type="button" className="button" disabled={mapIndex >= data.maps.length - 1} onClick={() => goTo(mapIndex + 1)}>
              Next map
            </button>
          </div>

          {data.art.length > 0 && (
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
