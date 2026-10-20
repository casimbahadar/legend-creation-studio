// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320), as used by zip, PNG and ROM databases.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 of `bytes` as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Formats a CRC32 as 8 uppercase hex digits, e.g. "A47246AE". */
export function formatCrc32(crc: number): string {
  return crc.toString(16).toUpperCase().padStart(8, '0');
}
