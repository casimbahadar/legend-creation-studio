// The Play page (decision 33): what a shared Play link opens. It reads the chapter from the link,
// asks for the player's own clean Sacred Stones ROM (decision 9), and plays the chapter with the same
// PlayScreen as the editor's test play.

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { findMap, loadProject, readChosenRom, type ChosenRom } from '../editor/project-io';
import { PlayScreen } from '../editor/PlayScreen';
import { toCanvas } from '../play/catalog';
import { renderMap } from '../rom/fe8-maps';
import { readPlayFragment } from './share';

type Link = { state: 'reading' } | { state: 'read'; project: unknown; name: string } | { state: 'bad'; message: string };
type Rom = { state: 'none' } | { state: 'checking' } | ChosenRom | { state: 'error' };

/** The project's name and first chapter's name, for showing before the project is checked. */
function names(raw: unknown): string {
  const p = raw as { name?: unknown; chapters?: { name?: unknown }[] } | null;
  const chapter = p?.chapters?.[0]?.name;
  return [p?.name, chapter].filter((n): n is string => typeof n === 'string' && !!n.trim()).join(': ');
}

export function PlayPage({ fragment }: { fragment: string }) {
  const [link, setLink] = useState<Link>({ state: 'reading' });
  const [rom, setRom] = useState<Rom>({ state: 'none' });

  useEffect(() => {
    let live = true;
    readPlayFragment(fragment).then(
      (project) => live && setLink({ state: 'read', project, name: names(project) }),
      (e: Error) => live && setLink({ state: 'bad', message: e.message }),
    );
    return () => {
      live = false;
    };
  }, [fragment]);

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setRom({ state: 'checking' });
    try {
      setRom(readChosenRom(new Uint8Array(await file.arrayBuffer())));
    } catch {
      setRom({ state: 'error' });
    }
  }

  const data = rom.state === 'clean' ? rom.editor : null;
  const loaded = useMemo(() => (data && link.state === 'read' ? loadProject(data, link.project) : null), [data, link]);
  const chapter = loaded?.project?.chapters[0];
  const map = data && chapter ? data.maps[findMap(data, chapter.map)] : undefined;
  const mapImage = useMemo(() => (map ? toCanvas(renderMap(map)) : null), [map]);
  const artByName = useMemo(() => new Map((data?.art ?? []).map((a) => [a.entry.name, a])), [data]);
  const editor = import.meta.env.BASE_URL;

  return (
    <main className="page">
      <h1>{link.state === 'read' && link.name ? link.name : 'Legend Creation Studio'}</h1>
      <p className="tagline">A chapter made with Legend Creation Studio, a tactics RPG maker for Fire Emblem fans.</p>

      {link.state === 'reading' && <p className="note">Reading the chapter…</p>}
      {link.state === 'bad' && <p className="bad">{link.message}</p>}

      {link.state === 'read' && !(chapter && map && mapImage && data) && (
        <>
          <p>To play, choose your own clean copy of Fire Emblem: The Sacred Stones (US). The chapter's map and art come from it.</p>
          <label className="button">
            Choose your FE8 (US) ROM
            <input type="file" className="visually-hidden" onChange={onFileChosen} />
          </label>
          <p className="note">Your ROM is read on this device. It is not uploaded or stored.</p>
          <p className="result" role="status" aria-live="polite">
            {rom.state === 'checking' && 'Checking…'}
            {rom.state === 'other' && <span className="bad">This isn't a clean Sacred Stones (US) ROM (CRC32 {rom.crc})</span>}
            {rom.state === 'error' && <span className="bad">Couldn't read that file. Try choosing it again.</span>}
            {rom.state === 'clean' && !data && <span className="bad">Couldn't read the game's text in this ROM.</span>}
          </p>
          {loaded && !loaded.project && (
            <div className="bad">
              <p>This chapter can't be played:</p>
              <ul className="problems">
                {loaded.problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {chapter && map && mapImage && data && (
        <section className="panel">
          <p className="note">Goal: defeat every enemy. The chapter is lost if a unit marked Must survive falls, or all your units fall.</p>
          <PlayScreen
            data={data}
            chapter={chapter}
            map={map}
            mapImage={mapImage}
            artByName={artByName}
            exitLabel="Make your own chapter"
            onExit={() => window.location.assign(editor)}
          />
        </section>
      )}

      <p className="note">
        <a href={editor}>Make your own chapter with Legend Creation Studio</a>
      </p>
      <footer className="footer">Non-commercial fan tool. Not affiliated with Nintendo or Intelligent Systems.</footer>
    </main>
  );
}
