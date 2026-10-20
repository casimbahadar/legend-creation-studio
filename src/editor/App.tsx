import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { crc32, formatCrc32 } from '../rom/crc32';
import { FE8_US_CRC32 } from '../rom/fe8';
import { readClasses } from '../rom/fe8-classes';
import {
  idleFrame,
  readMapSprite,
  readTeamPalettes,
  renderMapSprite,
  spriteOrigin,
  type TeamColour,
} from '../rom/fe8-map-sprites';
import { readAllChapterMaps, renderMap, type ChapterMap } from '../rom/fe8-maps';
import type { Image } from '../rom/gba-graphics';
import { readRom, type GbaRom } from '../rom/gba-rom';
import { decodeText, findTextTable, type TextTable } from '../rom/text';

type RomCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'clean'; rom: GbaRom; text: TextTable | null; maps: ChapterMap[]; unitArt: UnitArt[] }
  | { state: 'other'; crc: string }
  | { state: 'error' };

export function App() {
  const [check, setCheck] = useState<RomCheck>({ state: 'idle' });
  const [textId, setTextId] = useState('');

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = '';
    if (!file) return;

    setCheck({ state: 'checking' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const crc = crc32(bytes);
      if (crc === FE8_US_CRC32) {
        const rom = readRom(bytes);
        const text = findTextTable(rom);
        setCheck({ state: 'clean', rom, text, maps: readAllChapterMaps(rom), unitArt: text ? readUnitArt(rom, text) : [] });
      } else {
        setCheck({ state: 'other', crc: formatCrc32(crc) });
      }
    } catch {
      setCheck({ state: 'error' });
    }
  }

  return (
    <main className="page">
      <h1>Legend Creation Studio</h1>
      <p className="tagline">A tactics RPG maker for Fire Emblem fans, with Sacred Stones ROM hacking.</p>

      <label className="button">
        Choose your FE8 (US) ROM
        <input type="file" className="visually-hidden" onChange={onFileChosen} />
      </label>
      <p className="note">Your ROM is read on this device. It is not uploaded or stored.</p>

      <p className="result" role="status" aria-live="polite">
        {check.state === 'checking' && 'Checking…'}
        {check.state === 'clean' && <span className="good">Clean Sacred Stones (US) ROM found</span>}
        {check.state === 'other' && (
          <span className="bad">This isn't a clean Sacred Stones (US) ROM (CRC32 {check.crc})</span>
        )}
        {check.state === 'error' && <span className="bad">Couldn't read that file. Try choosing it again.</span>}
      </p>

      {check.state === 'clean' && (
        <section className="panel">
          <h2>ROM text check</h2>
          {check.text ? (
            <>
              <p>Read {check.text.count.toLocaleString()} text entries from your ROM.</p>
              <label className="field">
                Text number (0 to {check.text.count - 1})
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={textId}
                  onChange={(e) => setTextId(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              {textId !== '' && (
                <pre className="text-out">{decodeText(check.rom, check.text, Number(textId)) || '(empty)'}</pre>
              )}
            </>
          ) : (
            <p className="bad">Couldn't find the text table in this ROM.</p>
          )}
        </section>
      )}

      {check.state === 'clean' && <MapCheck maps={check.maps} unitArt={check.unitArt} />}

      <footer className="footer">
        Non-commercial fan tool. Not affiliated with Nintendo or Intelligent Systems.
      </footer>
    </main>
  );
}

type Team = Exclude<TeamColour, 'moved'>;
const TEAMS: { team: Team; label: string }[] = [
  { team: 'player', label: 'Player' },
  { team: 'enemy', label: 'Enemy' },
  { team: 'ally', label: 'Ally' },
];

/** One class's standing frames, drawn in each team's colours. */
interface UnitArt {
  readonly name: string;
  readonly frames: Record<Team, HTMLCanvasElement[]>;
  readonly width: number;
  readonly height: number;
}

function toCanvas(image: Image): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d')?.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return c;
}

function readUnitArt(rom: GbaRom, text: TextTable): UnitArt[] {
  const palettes = readTeamPalettes(rom);
  const out: UnitArt[] = [];
  for (const c of readClasses(rom, text)) {
    if (!c.name) continue;
    try {
      const sprite = readMapSprite(rom, c.mapSprite);
      const framesFor = (team: Team) => [0, 1, 2].map((f) => toCanvas(renderMapSprite(sprite, palettes[team], f)));
      out.push({ name: c.name, width: sprite.width, height: sprite.height, frames: { player: framesFor('player'), enemy: framesFor('enemy'), ally: framesFor('ally') } });
    } catch {
      // class slot without a usable map sprite
    }
  }
  return out;
}

/** Class name, numbered when several classes share it (e.g. "Lord 2"). */
function optionLabel(art: UnitArt[], i: number): string {
  const name = art[i]!.name;
  if (art.filter((a) => a.name === name).length < 2) return name;
  return `${name} ${art.slice(0, i + 1).filter((a) => a.name === name).length}`;
}

interface PlacedUnit {
  readonly x: number;
  readonly y: number;
  readonly art: number;
  readonly team: Team;
}

function MapCheck({ maps, unitArt }: { maps: ChapterMap[]; unitArt: UnitArt[] }) {
  const [index, setIndex] = useState(0);
  const [artIndex, setArtIndex] = useState(0);
  const [team, setTeam] = useState<Team>('player');
  const [units, setUnits] = useState<PlacedUnit[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = maps[index];
  const mapImage = useMemo(() => (map ? toCanvas(renderMap(map)) : null), [map]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g || !mapImage || !map) return;
    c.width = mapImage.width;
    c.height = mapImage.height;
    g.imageSmoothingEnabled = false;
    let raf = 0;
    const draw = (now: number) => {
      g.drawImage(mapImage, 0, 0);
      const frame = idleFrame(now);
      // Draw top rows first so taller sprites lower down overlap the ones behind them.
      for (const u of [...units].sort((a, b) => a.y - b.y)) {
        const art = unitArt[u.art];
        if (!art) continue;
        const [sx, sy] = spriteOrigin(art, u.x, u.y);
        g.drawImage(art.frames[u.team][frame]!, sx, sy);
      }
      if (units.length) raf = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [map, mapImage, units, unitArt]);

  if (!map) {
    return (
      <section className="panel">
        <h2>ROM map check</h2>
        <p className="bad">Couldn't find any chapter maps in this ROM.</p>
      </section>
    );
  }

  function goTo(i: number) {
    setIndex(i);
    setUnits([]);
  }

  function onMapTap(event: MouseEvent<HTMLCanvasElement>) {
    const c = event.currentTarget;
    const rect = c.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * (c.width / 16));
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * (c.height / 16));
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const here = units.find((u) => u.x === x && u.y === y);
    setUnits(here ? units.filter((u) => u !== here) : [...units, { x, y, art: artIndex, team }]);
  }

  return (
    <section className="panel">
      <h2>ROM map check</h2>
      <p>
        Map {index + 1} of {maps.length} (chapter entry {map.chapter}), {map.width} × {map.height} tiles
      </p>
      <div className="stepper">
        <button type="button" className="button" disabled={index === 0} onClick={() => goTo(index - 1)}>
          Previous
        </button>
        <button type="button" className="button" disabled={index === maps.length - 1} onClick={() => goTo(index + 1)}>
          Next
        </button>
      </div>

      {unitArt.length > 0 && (
        <div className="unit-controls">
          <label className="field">
            Class
            <select value={artIndex} onChange={(e) => setArtIndex(Number(e.target.value))}>
              {unitArt.map((a, i) => (
                <option key={i} value={i}>
                  {optionLabel(unitArt, i)}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label="Team">
            {TEAMS.map((t) => (
              <button key={t.team} type="button" aria-pressed={team === t.team} onClick={() => setTeam(t.team)}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="note">Tap the map to place a unit. Tap it again to remove it.</p>
        </div>
      )}

      <canvas ref={canvas} className="map" aria-label={`Map ${index + 1}`} onClick={onMapTap} />
    </section>
  );
}
