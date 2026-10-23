// Playing a chapter: the map with units, cursor, ranges and walking, battles, the computer's phases,
// the windows around them and the GBA controls. Shared by the editor's test play and the web game's
// Play page (decision 33). Play's rules, drawing and the ROM catalog live in src/play.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { battleFrame, type BattleFrame } from '../core/battle-anim';
import { randomNumbers, withBonus } from '../core/combat';
import { attackRange } from '../core/movement';
import { startPlay, unitAt } from '../core/play';
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
import type { ProjectChapter } from '../core/project';
import { unitStats, weaponRanges, weaponsOf, type ClassArt } from '../play/catalog';
import { ATTACK_COLOURS, drawArrow, drawCursor, drawRangeSquare, MOVE_COLOURS } from '../play/draw';
import { chapterRules } from '../play/rules';
import { idleFrame, spriteOrigin } from '../rom/fe8-map-sprites';
import type { ChapterMap } from '../rom/fe8-maps';
import { GbaControls } from './controls';
import { unitCharacters, type EditorRom } from './project-io';
import { BattleHud, BattlePopup, ForecastBox, PlayStatus } from './TestPlayPanels';

/** How long a phase banner shows, and the pause between computer units' actions. */
const BANNER_MS = 1000;
const AI_PAUSE_MS = 700;

export function PlayScreen({
  data,
  chapter,
  map,
  mapImage,
  artByName,
  exitLabel,
  onExit,
  note,
}: {
  data: EditorRom;
  chapter: ProjectChapter;
  map: ChapterMap;
  mapImage: HTMLCanvasElement;
  artByName: ReadonlyMap<string, ClassArt>;
  /** The second button on the result screen, beside Play again. */
  exitLabel: string;
  onExit: () => void;
  /** A line under the controls. */
  note?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // One stream of random numbers per play session.
  const rng = useRef(randomNumbers(Date.now()));
  const characters = useMemo(() => unitCharacters(data, chapter.units), [data, chapter.units]);
  const start = () => {
    rng.current = randomNumbers(Date.now());
    return startView(startPlay(chapter, (u) => withBonus(unitStats(artByName.get(u.class), characters.get(u.id), u.level), u.statBonus)));
  };
  const [view, setView] = useState<PlayView>(start);
  const play = view.state;
  const selectedUnit = selectedOf(view);

  // The rules change only with the map or the ROM data.
  const chapterPlay = useMemo(() => chapterRules(map, artByName, data.items, () => rng.current()), [map, artByName, data.items]);
  const rules = chapterPlay.rules;
  const canMove = unitCanMove(selectedUnit);
  // A unit of yours that has already moved shows no range, as in FE.
  const showRange = !!selectedUnit && (selectedUnit.team !== 'player' || canMove);
  const range = useMemo(() => {
    if (!selectedUnit || !showRange) return null;
    const stops = rules.searchOf(selectedUnit, play).stops;
    const attack = attackRange(stops, map.width, map.height, weaponRanges(artByName.get(selectedUnit.class), selectedUnit.items, data.items));
    return { stops, attack };
  }, [play, selectedUnit, showRange, map, artByName, rules, data.items]);
  /** A unit's name: its own, its character's, or its class's. */
  const unitLabel = (u: { id: string; class: string }) =>
    chapter.units.find((x) => x.id === u.id)?.name ?? characters.get(u.id)?.name ?? artByName.get(u.class)?.entry.label ?? u.class;

  const arrow = visibleRoute(view, rules);
  // When a walk starts, note the time; the draw loop moves the unit along its route from then on.
  const walk = view.walking;
  const walkStart = useRef(0);
  useEffect(() => {
    if (walk) walkStart.current = performance.now();
  }, [walk]);
  // The same for a battle; the HUD (HP bars, damage) updates only when a blow lands, not every frame.
  const battle = view.battle;
  const battleStart = useRef(0);
  const battleFrom = useRef({ attackerHp: 0, defenderHp: 0 });
  const [hud, setHud] = useState<BattleFrame | null>(null);
  const hudKey = useRef('');
  useEffect(() => {
    if (!battle) {
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
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[e.key];
      if (dir) setView((v) => moveCursor(v, dir[0], dir[1], rules));
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'Enter') setView((v) => pressA(v, rules));
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Escape') setView((v) => pressB(v, rules));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rules]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    c.width = mapImage.width;
    c.height = mapImage.height;
    g.imageSmoothingEnabled = false;
    let raf = 0;
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
      const placed = play.units.map((u) => {
        if (battle && bf && striking) {
          // The striker lunges a quarter square toward the unit it hits.
          const strikerId = striking.by === 'attacker' ? battle.attacker : battle.defender;
          const otherId = striking.by === 'attacker' ? battle.defender : battle.attacker;
          const other = play.units.find((p) => p.id === otherId);
          if (u.id === strikerId && other) {
            const dx = Math.sign(other.at[0] - u.at[0]);
            const dy = Math.sign(other.at[1] - u.at[1]);
            return { u, x: u.at[0] + dx * bf.lunge * 0.25, y: u.at[1] + dy * bf.lunge * 0.25, walking: false };
          }
        }
        if (!walk || walk.id !== u.id) return { u, x: u.at[0], y: u.at[1], walking: false };
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
      if (walkDone) setView((v) => finishWalk(v, rules));
      if (bf) {
        const key = `${bf.index}:${bf.landed ? battle!.strikes.indexOf(bf.landed) : -1}`;
        if (key !== hudKey.current) {
          hudKey.current = key;
          setHud(bf);
        }
        if (bf.done) setView((v) => finishBattle(v));
      }
      if (!battle) drawCursor(g, view.cursor[0], view.cursor[1], now);
      raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [mapImage, artByName, play, range, view, arrow, walk, battle, rules]);

  // The computer's phases: a pause on each phase banner, then one unit at a time.
  const aiTurn = (view.phase !== 'player' || !!view.banner) && !view.walking && !view.battle;
  useEffect(() => {
    if (!aiTurn) return;
    const t = window.setTimeout(() => setView((v) => stepAI(v, rules)), view.banner ? BANNER_MS : AI_PAUSE_MS);
    return () => window.clearTimeout(t);
  }, [aiTurn, view, rules]);

  function onMapTap(event: MouseEvent<HTMLCanvasElement>) {
    const c = event.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * (c.width / 16));
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * (c.height / 16));
    // A tap moves the cursor there and presses A.
    setView(tapAt(view, x, y, rules));
  }

  return (
    <>
      <PlayStatus
        play={play}
        selected={selectedUnit}
        canMove={canMove}
        phase={view.outcome ? 'over' : view.phase !== 'player' ? view.phase : view.battle ? 'battle' : view.walking ? 'walk' : (view.action?.kind ?? null)}
        label={(u) => artByName.get(u.class)?.entry.label ?? u.class}
        onEndTurn={() => setView((v) => endPlayerTurn(v))}
      />
      <div className="play-window" aria-live="polite">
        {(() => {
          const a = view.action;
          if (a?.kind === 'target') {
            const atk = play.units.find((u) => u.id === a.unit);
            const def = play.units.find((u) => u.id === a.targets[a.index]);
            if (!atk || !def) return null;
            const f = chapterPlay.preview(atk, def);
            return <ForecastBox a={atk} d={def} f={f.forecast} aWeapon={f.attackerWeapon?.entry.gameName} dWeapon={f.defenderWeapon?.entry.gameName} label={unitLabel} />;
          }
          if (battle && hud) {
            return <BattleHud battle={battle} frame={hud} units={play.units} maxHp={(id: string) => play.units.find((u) => u.id === id)?.stats.hp ?? 1} label={unitLabel} />;
          }
          const u = unitAt(play, view.cursor[0], view.cursor[1]);
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
      <div className="map-wrap">
        <canvas ref={canvas} className="map" aria-label="Chapter map" onClick={onMapTap} />
        {view.action?.kind === 'menu' &&
          (() => {
            const u = play.units.find((x) => x.id === view.action!.unit);
            // The menu opens on the side of the map away from the unit, as in FE.
            const side = u && u.at[0] >= rules.width / 2 ? 'left' : 'right';
            return (
              <div className={`action-menu ${side}`} role="menu">
                {menuOptions(view, rules).map((o, i) => (
                  <button key={o} type="button" role="menuitem" aria-current={view.action?.index === i} onClick={() => setView((v) => chooseOption(v, o, rules))}>
                    {o === 'attack' ? 'Attack' : 'Wait'}
                  </button>
                ))}
              </div>
            );
          })()}
        {view.outcome && (
          <div className={`result-screen ${view.outcome.result}`} role="alertdialog" aria-label={view.outcome.result === 'victory' ? 'Chapter clear' : 'Defeat'}>
            <strong>{view.outcome.result === 'victory' ? 'Chapter Clear!' : 'Defeat'}</strong>
            <span>
              {view.outcome.result === 'victory'
                ? `Every enemy defeated on turn ${play.turn}.`
                : view.outcome.fallen
                  ? `${unitLabel(view.outcome.fallen)} has fallen.`
                  : 'All your units have fallen.'}
            </span>
            {play.fallen.some((u) => u.team === 'player') && view.outcome.result === 'victory' && (
              <span className="note">Lost: {play.fallen.filter((u) => u.team === 'player').map(unitLabel).join(', ')}</span>
            )}
            <div className="stepper">
              <button type="button" className="button" onClick={() => setView(start())}>
                Play again
              </button>
              <button type="button" className="button button-secondary" onClick={onExit}>
                {exitLabel}
              </button>
            </div>
          </div>
        )}
        {view.banner && (
          <div className={`phase-banner phase-${view.banner}`} role="status">
            {view.banner === 'player' ? 'Player Phase' : view.banner === 'enemy' ? 'Enemy Phase' : 'Ally Phase'}
          </div>
        )}
        {battle && hud && <BattlePopup battle={battle} frame={hud} units={play.units} width={map.width} height={map.height} />}
      </div>
      <GbaControls onDirection={(dx, dy) => setView((v) => moveCursor(v, dx, dy, rules))} onA={() => setView((v) => pressA(v, rules))} onB={() => setView((v) => pressB(v, rules))} />
      <p className="note">
        You can also tap a square: that moves the cursor there and presses A. On a computer, use the arrow keys, Z for A and X for B.
        {note ? ` ${note}` : ''}
      </p>
    </>
  );
}

