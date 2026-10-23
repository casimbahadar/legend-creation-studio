// Making any name spellable in FE8's text. The game's Huffman tree holds letters only in pairs that
// its own text uses, so a name like "Xavier" can't be written with it. Rather than re-encode all of
// the game's text (which would put its whole script into every shared patch, against decision 9),
// the tree is extended: the least used leaf is pushed one level down, beside a new branch holding a
// single-letter leaf for every printable character the tree lacks. Only the few strings that use
// that leaf change code, so only they are re-encoded. The extended tree is written to the added area
// and the game's two pointers to it are moved (see FE8U_TREE_LITERAL and FE8U_ROOT_POINTER_LITERAL).

import type { GbaRom } from './gba-rom';
import { decodeTextBytes, type TextTable } from './text';
import { codesOfNodes, type HuffmanCodes } from './text-encode';

/** Characters a name can use: printable ASCII. */
export const FIRST_PRINTABLE = 0x20;
export const LAST_PRINTABLE = 0x7e;

const LEAF = 0x80000000;
/** Leaves as the game writes them: 0xFFFF in the top half. */
const leafWord = (value: number) => (0xffff0000 | value) >>> 0;
const nodeWord = (left: number, right: number) => ((right << 16) | left) >>> 0;

export interface ExtendedTree {
  /** Every node of the new tree, the old ones first, as words to write. */
  readonly words: readonly number[];
  readonly root: number;
  readonly codes: HuffmanCodes;
  /** Text ids whose code changed, so they must be re-encoded with `codes`. */
  readonly changed: readonly number[];
}

/** Each text entry's leaves, by node index, walking the tree as the game's decoder does. */
function leavesUsed(rom: GbaRom, t: TextTable, id: number): Set<number> {
  const used = new Set<number>();
  const p = rom.u32(t.table + id * 4);
  if (!rom.isPointer(p) || p & 0x80000000) return used;
  let at = rom.offsetOf(p);
  let bit = 0;
  let node = t.root;
  for (let steps = 0; steps < 0x40000; steps++) {
    const w = rom.u32(node);
    if (w & LEAF) {
      used.add((node - t.nodes) / 4);
      if ((w & 0xffff) === 0) break;
      node = t.root;
      continue;
    }
    if (at >= rom.size) break;
    const b = (rom.u8(at) >> bit) & 1;
    if (++bit === 8) {
      bit = 0;
      at++;
    }
    node = t.nodes + (b ? w >>> 16 : w & 0xffff) * 4;
  }
  return used;
}

export function extendTree(rom: GbaRom, t: TextTable): ExtendedTree {
  const count = (t.root - t.nodes) / 4 + 1;
  const words = Array.from({ length: count }, (_, i) => rom.u32(t.nodes + i * 4) >>> 0);
  const isLeaf = (i: number) => (words[i]! & LEAF) !== 0;

  // How many entries use each leaf, to give up the least used one.
  const users = new Map<number, number[]>();
  for (let id = 0; id < t.count; id++) {
    for (const leaf of leavesUsed(rom, t, id)) users.set(leaf, [...(users.get(leaf) ?? []), id]);
  }
  let pushed = -1;
  for (let i = 0; i < count; i++) {
    if (!isLeaf(i) || (words[i]! & 0xffff) === 0) continue;
    if (pushed < 0 || (users.get(i)?.length ?? 0) < (users.get(pushed)?.length ?? 0)) pushed = i;
  }
  const parent = words.findIndex((w, i) => !isLeaf(i) && ((w & 0xffff) === pushed || w >>> 16 === pushed));
  if (pushed < 0 || parent < 0) throw new Error("This ROM's text tree can't be extended.");

  // New single-letter leaves for the printable characters the tree has no single leaf for.
  const singles = new Set(words.filter((w, i) => isLeaf(i) && (w & 0xffff) < 0x100).map((w) => w & 0xffff));
  let level: number[] = [];
  for (let c = FIRST_PRINTABLE; c <= LAST_PRINTABLE; c++) {
    if (singles.has(c)) continue;
    level.push(words.length);
    words.push(leafWord(c));
  }
  // A balanced branch over them, then a node holding the pushed leaf (0) and that branch (1).
  while (level.length > 1) {
    const next: number[] = [];
    for (let k = 0; k < level.length; k += 2) {
      if (k + 1 === level.length) next.push(level[k]!);
      else {
        next.push(words.length);
        words.push(nodeWord(level[k]!, level[k + 1]!));
      }
    }
    level = next;
  }
  const join = words.length;
  words.push(nodeWord(pushed, level[0] ?? pushed));
  const w = words[parent]!;
  words[parent] = (w & 0xffff) === pushed ? nodeWord(join, w >>> 16) : nodeWord(w & 0xffff, join);

  const root = count - 1;
  return { words, root, codes: codesOfNodes((i) => words[i], root), changed: users.get(pushed) ?? [] };
}

/** Each changed entry's text, decoded with the old tree, to re-encode with the extended one. */
export function changedTexts(rom: GbaRom, t: TextTable, tree: ExtendedTree): { id: number; bytes: number[] }[] {
  return tree.changed.map((id) => ({ id, bytes: Array.from(decodeTextBytes(rom, t, id)) }));
}
