// The chapter editor: name, map and units in Edit mode, and test play on the same map through the
// shared PlayScreen. Play's rules, drawing and the ROM catalog live in src/play.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { isLordClass, mapRef, MAX_LEVEL, newProject, projectToJson, TEAMS, type Problem, type Project, type ProjectUnit, type Team } from '../core/project';
import { defaultItems, toCanvas } from '../play/catalog';
import { drawCursor } from '../play/draw';
import { pickCharacter } from '../rom/fe8-character-names';
import { idleFrame, spriteOrigin } from '../rom/fe8-map-sprites';
import { renderMap } from '../rom/fe8-maps';
import { deviceStore, readAutosave, writeAutosave } from './autosave';
import { GoalPanel } from './GoalPanel';
import { TEAM_LABELS } from './labels';
import { PatchExport } from './PatchExport';
import { PlayScreen } from './PlayScreen';
import { ShareGame } from './ShareGame';
import { findMap, loadProject, nextUnitId, saveFile, startingLevel, unitCharacters, type EditorRom } from './project-io';
import { UnitPanel } from './UnitPanel';

/** The square to seize on Edit mode's map: a gold outline, so it shows on any terrain. */
function drawSeizeMark(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = 'rgba(248, 216, 64, 0.35)';
  g.fillRect(x * 16, y * 16, 16, 16);
  g.strokeStyle = '#f8d840';
  g.lineWidth = 2;
  g.strokeRect(x * 16 + 1, y * 16 + 1, 14, 14);
}

export function ChapterEditor({ data }: { data: EditorRom }) {
  const store = useMemo(() => deviceStore(), []);
  // Restore the autosaved chapter if it still checks out against this ROM; otherwise start fresh.
  const [start] = useState(() => {
    const saved = readAutosave(store);
    const loaded = saved ? loadProject(data, saved.project) : null;
    const restored = loaded?.project;
    if (restored) return { project: restored, savedJson: saved!.savedJson, freshJson: null, restored: true, notes: loaded.notes };
    const fresh = newProject('My First Chapter', mapRef(data.maps[0]?.chapter ?? 0));
    return { project: fresh, savedJson: null, freshJson: projectToJson(fresh), restored: false, notes: [] };
  });
  const [project, setProject] = useState<Project>(start.project);
  const [savedJson, setSavedJson] = useState<string | null>(start.savedJson);
  const [autosaveOk, setAutosaveOk] = useState(true);
  const [artIndex, setArtIndex] = useState(0);
  const [team, setTeam] = useState<Team>('player');
  const [status, setStatus] = useState<{ ok: boolean; text: string; problems?: Problem[] } | null>(
    start.restored ? { ok: true, text: `Picked up "${start.project.name}" where you left off.`, problems: start.notes.map((message) => ({ path: '', message })) } : null,
  );
  const json = projectToJson(project);
  // An untouched new chapter has nothing to lose, so it doesn't count as unsaved.
  const untouched = savedJson === null && json === start.freshJson;
  const unsaved = !untouched && json !== savedJson;

  useEffect(() => {
    setAutosaveOk(writeAutosave(store, { project, savedJson }));
  }, [store, project, savedJson]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  /** The placed unit whose panel is open in Edit mode. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Whether the next map tap chooses the square to seize. */
  const [pickingSeize, setPickingSeize] = useState(false);

  const chapter = project.chapters[0]!;
  const mapIndex = findMap(data, chapter.map);
  const map = data.maps[mapIndex];
  const artByName = useMemo(() => new Map(data.art.map((a) => [a.entry.name, a])), [data.art]);
  const mapImage = useMemo(() => (map ? toCanvas(renderMap(map)) : null), [map]);
  const characters = useMemo(() => unitCharacters(data, chapter.units), [data, chapter.units]);
  const cursorCorner = useMemo(() => (data.cursor ? toCanvas(data.cursor) : null), [data.cursor]);

  // Edit mode's map: the placed units, idling, and a cursor on the one being edited.
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (playing || !c || !g || !mapImage) return;
    c.width = mapImage.width;
    c.height = mapImage.height;
    g.imageSmoothingEnabled = false;
    let raf = 0;
    const draw = (now: number) => {
      g.drawImage(mapImage, 0, 0);
      if (chapter.goal === 'seize' && chapter.seizeAt) drawSeizeMark(g, chapter.seizeAt[0], chapter.seizeAt[1]);
      const frame = idleFrame(now);
      // Top rows first, so taller sprites lower down overlap the ones behind them.
      for (const u of [...chapter.units].sort((a, b) => a.at[1] - b.at[1])) {
        const art = artByName.get(u.class);
        if (!art) continue;
        const [sx, sy] = spriteOrigin(art, u.at[0], u.at[1]);
        g.drawImage(art.frames[u.team][frame]!, Math.round(sx), Math.round(sy));
      }
      const edited = editing ? chapter.units.find((u) => u.id === editing) : undefined;
      if (edited) drawCursor(g, edited.at[0], edited.at[1], now, cursorCorner);
      if (chapter.units.length) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [playing, mapImage, chapter.units, chapter.goal, chapter.seizeAt, artByName, editing, cursorCorner]);

  function updateChapter(change: Partial<typeof chapter>) {
    setProject({ ...project, chapters: [{ ...chapter, ...change }] });
  }

  function goTo(i: number) {
    const next = data.maps[i];
    if (!next) return;
    if (chapter.units.length && !window.confirm('Changing the map removes the units you placed. Change it anyway?')) return;
    setEditing(null);
    setPickingSeize(false);
    updateChapter({ map: mapRef(next.chapter), units: [], seizeAt: undefined });
  }

  function onMapTap(event: MouseEvent<HTMLCanvasElement>) {
    const c = event.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * (c.width / 16));
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * (c.height / 16));
    const art = data.art[artIndex];
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    if (pickingSeize) {
      setPickingSeize(false);
      updateChapter({ seizeAt: [x, y] });
      return;
    }
    if (!art) return;
    const here = chapter.units.find((u) => u.at[0] === x && u.at[1] === y);
    if (here) {
      setEditing(here.id === editing ? null : here.id);
    } else if (editing) {
      // With a unit's panel open, a tap on an empty square only closes it, so a stray tap never places a unit.
      setEditing(null);
    } else {
      const cls = art.entry.name;
      // Player units become an FE8 character (decision 28), picked here so the panel shows which.
      const taken = new Set(chapter.units.flatMap((u) => (u.character ? [u.character] : [])));
      const character = team === 'player' ? pickCharacter(cls, art.entry.id, taken, (id) => data.characters[id - 1]?.defaultClass) : null;
      const unit: ProjectUnit = {
        id: nextUnitId(chapter.units, cls),
        class: cls,
        team,
        // A character starts at the level it joins at in vanilla, as its stats are written for it.
        level: startingLevel(data, character ?? undefined),
        at: [x, y],
        // Lords on the player's side must survive, as in FE (decision 26).
        ...(team === 'player' && isLordClass(cls) ? { mustSurvive: true } : {}),
        ...(character ? { character } : {}),
      };
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

  function setMode(play: boolean) {
    setEditing(null);
    setPickingSeize(false);
    setPlaying(play);
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
    const { project: opened, problems, notes } = loadProject(data, parsed);
    if (!opened || problems.length) {
      setStatus({ ok: false, text: `Couldn't open ${file.name}:`, problems });
      return;
    }
    if (unsaved && !window.confirm(`Opening ${file.name} replaces changes you haven't saved to a file. Open it anyway?`)) return;
    setMode(false);
    setProject(opened);
    setSavedJson(projectToJson(opened));
    setStatus({ ok: true, text: `Opened "${opened.name}".`, problems: notes.map((message) => ({ path: '', message })) });
  }

  const counts = TEAMS.map((t) => [t, chapter.units.filter((u) => u.team === t).length] as const).filter(([, n]) => n > 0);

  return (
    <section className="panel">
      <h2>Your chapter</h2>
      <p className="note">Whatever the goal, the chapter is lost if a unit marked Must survive falls, or all your units fall.</p>

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
            <strong>{data.chapterTitles[map.chapter] || `Chapter entry ${map.chapter}`}</strong>
            <br />
            <span className="note">
              Map {mapIndex + 1} of {data.maps.length} · {map.width} × {map.height} squares · chapter entry {map.chapter}
            </span>
          </p>
          <div className="stepper">
            <button type="button" className="button" disabled={mapIndex <= 0 || playing} onClick={() => goTo(mapIndex - 1)}>
              Previous map
            </button>
            <button type="button" className="button" disabled={mapIndex >= data.maps.length - 1 || playing} onClick={() => goTo(mapIndex + 1)}>
              Next map
            </button>
          </div>

          <div className="segmented" role="group" aria-label="Mode">
            <button type="button" aria-pressed={!playing} onClick={() => setMode(false)}>
              Edit
            </button>
            <button type="button" aria-pressed={playing} disabled={!chapter.units.length} onClick={() => setMode(true)}>
              Test play
            </button>
          </div>

          {playing && mapImage ? (
            <PlayScreen
              data={data}
              chapter={chapter}
              map={map}
              mapImage={mapImage}
              artByName={artByName}
              exitLabel="Back to editing"
              onExit={() => setMode(false)}
              note="Test play doesn't change your chapter."
            />
          ) : (
            <>
              <GoalPanel chapter={chapter} picking={pickingSeize} onPicking={setPickingSeize} onChange={updateChapter} />
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
                  <p className="note">Tap an empty square to place a unit. Tap a unit to change its items or remove it.</p>
                </div>
              )}
              <div className="map-wrap">
                <canvas ref={canvas} className="map" aria-label="Chapter map" onClick={onMapTap} />
              </div>
              {editing &&
                (() => {
                  const unit = chapter.units.find((u) => u.id === editing);
                  return unit ? (
                    <UnitPanel
                      key={unit.id}
                      unit={unit}
                      art={artByName.get(unit.class)}
                      classes={data.art}
                      items={data.items}
                      character={characters.get(unit.id)}
                      textCodes={data.textCodes}
                      startingLevel={(name) => startingLevel(data, name)}
                      takenCharacters={new Set(chapter.units.flatMap((u) => (u.id !== unit.id && u.character ? [u.character] : [])))}
                      onChange={(change) => updateUnit(unit.id, change)}
                      onLevelStep={(delta) => stepLevel(unit.id, delta)}
                      onClose={() => setEditing(null)}
                    />
                  ) : null;
                })()}
            </>
          )}
          <p className="note">
            {counts.length
              ? `${chapter.units.length} ${chapter.units.length === 1 ? 'unit' : 'units'}: ${counts.map(([t, n]) => `${n} ${TEAM_LABELS[t].toLowerCase()}`).join(', ')}`
              : 'No units yet.'}
          </p>
          {!playing && <PatchExport data={data} project={project} chapter={chapter} onChange={(replaces) => updateChapter({ replaces })} />}
          {!playing && <ShareGame project={project} />}
        </>
      ) : (
        <p className="bad">Couldn't find any chapter maps in this ROM.</p>
      )}

    </section>
  );
}
