// UPS patches (byuu's format, as Flips and other patchers read it): how GBA hacks are shared
// (decision 9), since a patch holds only the changes and works only on the player's own clean ROM.
// Layout: "UPS1", source size, target size, then blocks of (bytes to skip, XOR bytes ending in 0),
// then the CRC32s of the source, the target and the patch so far.

import { crc32 } from './crc32';

const MAGIC = [0x55, 0x50, 0x53, 0x31]; // "UPS1"

/** UPS's variable-length number. */
export function encodeNumber(n: number, out: number[]): void {
  let x = n;
  for (;;) {
    const b = x & 0x7f;
    x = Math.floor(x / 128);
    if (x === 0) {
      out.push(0x80 | b);
      return;
    }
    out.push(b);
    x--;
  }
}

function decodeNumber(bytes: Uint8Array, at: { i: number }): number {
  let value = 0;
  let shift = 1;
  for (;;) {
    if (at.i >= bytes.length) throw new Error('This patch is cut short.');
    const x = bytes[at.i++]!;
    value += (x & 0x7f) * shift;
    if (x & 0x80) return value;
    shift *= 128;
    value += shift;
  }
}

function push32(out: number[], v: number) {
  out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

const read32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** A UPS patch that turns `source` into `target`. */
export function createUps(source: Uint8Array, target: Uint8Array): Uint8Array {
  const out: number[] = [...MAGIC];
  encodeNumber(source.length, out);
  encodeNumber(target.length, out);
  const at = (b: Uint8Array, i: number) => (i < b.length ? b[i]! : 0);
  let last = 0;
  for (let i = 0; i < target.length; i++) {
    if (at(source, i) === target[i]) continue;
    encodeNumber(i - last, out);
    while (i < target.length && at(source, i) !== target[i]) {
      out.push(at(source, i) ^ target[i]!);
      i++;
    }
    // The terminating 0 also stands for the unchanged byte at i.
    out.push(0);
    last = i + 1;
  }
  push32(out, crc32(source));
  push32(out, crc32(target));
  const body = Uint8Array.from(out);
  const result = new Uint8Array(body.length + 4);
  result.set(body);
  new DataView(result.buffer).setUint32(body.length, crc32(body), true);
  return result;
}

/** Applies a UPS patch to `source`. Throws with a plain-words message if it doesn't fit. */
export function applyUps(patch: Uint8Array, source: Uint8Array): Uint8Array {
  if (patch.length < 4 + 2 + 12 || MAGIC.some((m, i) => patch[i] !== m)) throw new Error("This isn't a UPS patch.");
  const end = patch.length - 12;
  if (crc32(patch.subarray(0, patch.length - 4)) !== read32(patch, patch.length - 4)) throw new Error('This patch is damaged.');
  if (crc32(source) !== read32(patch, end)) throw new Error("This patch is for a different ROM.");
  const at = { i: 4 };
  const sourceSize = decodeNumber(patch, at);
  const targetSize = decodeNumber(patch, at);
  if (sourceSize !== source.length) throw new Error("This patch is for a different ROM.");
  const out = new Uint8Array(targetSize);
  out.set(source.subarray(0, Math.min(source.length, targetSize)));
  let pos = 0;
  while (at.i < end) {
    pos += decodeNumber(patch, at);
    for (;;) {
      if (at.i >= end) throw new Error('This patch is cut short.');
      const x = patch[at.i++]!;
      if (pos < targetSize) out[pos] = (pos < source.length ? source[pos]! : 0) ^ x;
      pos++;
      if (x === 0) break;
    }
  }
  if (crc32(out) !== read32(patch, end + 4)) throw new Error('This patch gave the wrong result.');
  return out;
}
