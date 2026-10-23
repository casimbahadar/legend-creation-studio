import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlayPage } from '../export/PlayPage';
import { PLAY_PREFIX } from '../export/share';
import { App } from './App';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/** A Play link (decision 33) opens the Play page; anything else opens the editor. */
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return hash.startsWith(PLAY_PREFIX) ? <PlayPage key={hash} fragment={hash} /> : <App />;
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
