// Sharing the chapter as a web game (decision 33): a Play link that carries the whole chapter. Players
// open it, choose their own ROM and play. The link changes whenever the chapter does.

import { useEffect, useState } from 'react';
import type { Project } from '../core/project';
import { playFragment } from '../export/share';

export function ShareGame({ project }: { project: Project }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setCopied(false);
    playFragment(project).then(
      (fragment) => live && setLink(new URL(import.meta.env.BASE_URL + fragment, window.location.origin).href),
      () => live && setLink(null),
    );
    return () => {
      live = false;
    };
  }, [project]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const canShare = typeof navigator.share === 'function';
  return (
    <div className="share-game">
      <h3>Web game</h3>
      <p className="note">
        Anyone with this link can play your chapter in their browser, on a phone too. They choose their own clean Sacred Stones (US)
        ROM; the link holds only your chapter. It changes when your chapter does, so share it again after changes.
      </p>
      {link ? (
        <>
          <input className="share-link" type="text" readOnly value={link} aria-label="Play link" onFocus={(e) => e.currentTarget.select()} />
          <div className="stepper">
            {canShare ? (
              <button type="button" className="button" onClick={() => navigator.share({ title: project.name, url: link }).catch(() => {})}>
                Share link
              </button>
            ) : (
              <button type="button" className="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            )}
            <a className="button button-secondary" href={link} target="_blank" rel="noreferrer">
              Try it
            </a>
          </div>
        </>
      ) : (
        <p className="note">Making the link…</p>
      )}
    </div>
  );
}
