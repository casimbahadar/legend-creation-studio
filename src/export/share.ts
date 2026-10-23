// Sharing a chapter as a link (decision 33): the project file, compressed and written into the link's
// fragment (after "#"), which browsers never send to a server. Opening the link shows the Play page.
// The project holds no ROM data (decision 9), so neither does the link.

import { projectToJson, type Project } from '../core/project';

/** Fragment prefix of a Play link. */
export const PLAY_PREFIX = '#play=';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** The fragment that carries `project`: "#play=" and the compressed project file. */
export async function playFragment(project: Project): Promise<string> {
  const json = new TextEncoder().encode(projectToJson(project));
  return PLAY_PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The project file a Play fragment carries, parsed but not yet checked; throws if it isn't one. */
export async function readPlayFragment(fragment: string): Promise<unknown> {
  if (!fragment.startsWith(PLAY_PREFIX)) throw new Error("This isn't a Play link.");
  try {
    const json = await pipe(fromBase64Url(fragment.slice(PLAY_PREFIX.length)), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new Error('This link is damaged or cut short. Ask for it again.');
  }
}
