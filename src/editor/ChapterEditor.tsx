// The chapter editor: name, map and units in Edit mode, and test play on the same map. Play's rules,
// drawing and the ROM catalog live in src/play; this file wires them to the screen.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { battleFrame, type BattleFrame } from '../core/battle-anim';
import { randomNumbers, withBonus } from '../core/combat';
import { attackRange } from '../core/movement';
import { startPlay, unitAt, type PlayUnit } from '../core/play';
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
  type PlayView,
} from '../core/play-input';
import { isLordClass, mapRef, MAX_LEVEL, newProject, projectToJson, TEAMS, type Problem, type Project, type ProjectUnit, type Team } from '../core/project';
import { defaultItems, toCanvas, unitStats, weaponRanges, weaponsOf } from '../play/catalog';
import { ATTACK_COLOURS, drawArrow, drawCursor, drawRangeSquare, MOVE_COLOURS } from '../play/draw';
import { chapterRules } from '../play/rules';
import { pickCharacter } from '../rom/fe8-character-names';
import { idleFrame, spriteOrigin } from '../rom/fe8-map-sprites';
import { renderMap } from '../rom/fe8-maps';
import { deviceStore, readAutosave, writeAutosave } from './autosave';
import { GbaControls } from './controls';
import { TEAM_LABELS } from './labels';
import { findMap, loadProject, nextUnitId, playerCharacters, saveFile, startingLevel, type EditorRom } from './project-io';
import { PatchExport } from './PatchExport';
import { BattleHud, BattlePopup, ForecastBox, PlayStatus } from './TestPlayPanels';
import { UnitPanel } from './UnitPanel';

/** How long a phase banner shows, and the pause between computer units' actions. */
const BANNER_MS = 1000;
const AI_PAUSE_MS = 700;

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

  // One stream of random numbers per test play session.
  const rng = useRef(randomNumbers(Date.now()));
  // The rules change only with the map or the ROM data.
  const chapterPlay = useMemo(() => (map ? chapterRules(map, artByName, data.items, () => rng.current()) : null), [map, artByName, data.items]);
  const rules = chapterPlay?.rules ?? null;
  const forecastOf = (a: PlayUnit, d: PlayUnit) => chapterPlay!.preview(a, d);
  const canMove = unitCanMove(selectedUnit);
  // A unit of yours that has already moved shows no range, as in FE.
  const showRange = !!selectedUnit && (selectedUnit.team !== 'player' || canMove);
  const range = useMemo(() => {
    if (!play || !selectedUnit || !showRange || !map || !rules) return null;
    const stops = rules!.searchOf(selectedUnit, play).stops;
    const attack = attackRange(stops, map.width, map.height, weaponRanges(artByName.get(selectedUnit.class), selectedUnit.items, data.items));
    return { stops, attack };
  },
    [play, selectedUnit, showRange, map, artByName, rules],
  );
  const characters = useMemo(() => playerCharacters(data, chapter.units), [data, chapter.units]);
  /** A unit's name in test play: its own, its character's, or its class's. */
  const unitLabel = (u: { id: string; class: string }) =>
    chapter.units.find((x) => x.id === u.id)?.name ?? characters.get(u.id)?.name ?? artByName.get(u.class)?.entry.label ?? u.class;


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

  function setMode(playing: boolean) {
    setEditing(null);
    rng.current = randomNumbers(Date.now());
    const characters = playerCharacters(data, chapter.units);
    setView(playing ? startView(startPlay(chapter, (u) => withBonus(unitStats(artByName.get(u.class), characters.get(u.id), u.level), u.statBonus))) : null);
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
      <p className="note">
        Goal: defeat every enemy. The chapter is lost if a unit marked Must survive falls, or all your units fall.
      </p>

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
              phase={view?.outcome ? 'over' : view && view.phase !== 'player' ? view.phase : view?.battle ? 'battle' : view?.walking ? 'walk' : (view?.action?.kind ?? null)}
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
            {view?.outcome && (
              <div className={`result-screen ${view.outcome.result}`} role="alertdialog" aria-label={view.outcome.result === 'victory' ? 'Chapter clear' : 'Defeat'}>
                <strong>{view.outcome.result === 'victory' ? 'Chapter Clear!' : 'Defeat'}</strong>
                <span>
                  {view.outcome.result === 'victory'
                    ? `Every enemy defeated on turn ${view.state.turn}.`
                    : view.outcome.fallen
                      ? `${unitLabel(view.outcome.fallen)} has fallen.`
                      : 'All your units have fallen.'}
                </span>
                {view.state.fallen.some((u) => u.team === 'player') && view.outcome.result === 'victory' && (
                  <span className="note">Lost: {view.state.fallen.filter((u) => u.team === 'player').map(unitLabel).join(', ')}</span>
                )}
                <div className="stepper">
                  <button type="button" className="button" onClick={() => setMode(true)}>
                    Play again
                  </button>
                  <button type="button" className="button button-secondary" onClick={() => setMode(false)}>
                    Back to editing
                  </button>
                </div>
              </div>
            )}
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
          {!view && <PatchExport data={data} project={project} chapter={chapter} onChange={(replaces) => updateChapter({ replaces })} />}
        </>
      ) : (
        <p className="bad">Couldn't find any chapter maps in this ROM.</p>
      )}

    </section>
  );
}
