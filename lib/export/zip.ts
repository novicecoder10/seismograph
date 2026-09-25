/**
 * A minimal store-only (uncompressed) ZIP writer: enough for KMZ and XLSX,
 * without a dependency. PKWARE APPNOTE 6.3.x, UTF-8 names (flag bit 11).
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const entries = files.map((f) => ({ name: enc.encode(f.name), data: typeof f.data === "string" ? enc.encode(f.data) : f.data }));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  // 1980-01-01 00:00 in DOS format: a fixed timestamp keeps output reproducible.
  const dosTime = 0, dosDate = (0 << 9) | (1 << 5) | 1;
  for (const e of entries) {
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, e.name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), e.name, e.data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, e.data.length, true);
    central.setUint32(24, e.data.length, true);
    central.setUint16(28, e.name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), e.name);
    offset += 30 + e.name.length + e.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Read back a store-only archive (for tests and round-trips). */
export function unzipStored(buf: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Map<string, Uint8Array>();
  let o = 0;
  const dec = new TextDecoder();
  while (o + 4 <= buf.length && v.getUint32(o, true) === 0x04034b50) {
    const size = v.getUint32(o + 18, true), nameLen = v.getUint16(o + 26, true), extra = v.getUint16(o + 28, true);
    const name = dec.decode(buf.subarray(o + 30, o + 30 + nameLen));
    const start = o + 30 + nameLen + extra;
    out.set(name, buf.subarray(start, start + size));
    o = start + size;
  }
  return out;
}
