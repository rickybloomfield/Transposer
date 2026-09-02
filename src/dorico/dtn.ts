/**
 * Decoder for Dorico's .dtn serialization (score.dtn inside a .dorico ZIP).
 *
 * Layout: u32 4, u32 1, a table of key names, a table of value strings (both u32 count +
 * NUL-terminated UTF-8 strings), then u32 node count and a tree of nodes.  Node tags use the
 * low nibble as the type: 0 attribute (key varint, value varint), 1 empty node (key, zero byte),
 * 2 object and 3 list (key, zero byte, child count, child key varints, then the children).
 */

export type DtnValue = string | null | DtnObject | DtnList;
export interface DtnObject { [key: string]: DtnValue }
export type DtnList = [string, DtnValue][];

export function decodeDtn(bytes: Uint8Array): { root: DtnObject; rootKey: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  const readTable = (): string[] => {
    const n = view.getUint32(pos, true); pos += 4;
    const out: string[] = [];
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < n; i++) {
      let e = pos;
      while (bytes[e] !== 0) e++;
      out.push(dec.decode(bytes.subarray(pos, e)));
      pos = e + 1;
    }
    return out;
  };
  const keys = readTable();
  const vals = readTable();
  pos += 4; // node count
  const K = (n: number): string => keys[n] ?? `#${n}`;
  const V = (n: number): string => vals[n] ?? '';
  const varint = (): number => {
    let r = 0, sh = 0;
    for (;;) {
      const c = bytes[pos++];
      r += (c & 0x7f) * 2 ** sh;
      sh += 7;
      if (c < 0x80) return r;
    }
  };
  function parse(): [string, DtnValue] {
    const tag = bytes[pos++];
    const type = tag & 0x0f;
    if (type === 0) {
      const k = varint(); const v = varint();
      return [K(k), V(v)];
    }
    if (type === 1) {
      const k = varint(); pos++;
      return [K(k), null];
    }
    if (type === 2 || type === 3) {
      const k = varint(); pos++;
      const n = varint();
      const childKeys: number[] = [];
      for (let i = 0; i < n; i++) childKeys.push(varint());
      if (type === 2) {
        const obj: DtnObject = {};
        for (let i = 0; i < n; i++) { const [ck, cv] = parse(); obj[ck] = cv; }
        return [K(k), obj];
      }
      const list: DtnList = [];
      for (let i = 0; i < n; i++) list.push(parse());
      return [K(k), list];
    }
    throw new Error(`Unexpected node tag 0x${tag.toString(16)} at offset ${pos - 1}`);
  }
  const [rootKey, root] = parse();
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('Unexpected root node in Dorico data.');
  return { root, rootKey };
}

/** Helpers for walking the decoded tree. */
export function obj(v: DtnValue | undefined): DtnObject | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
}
export function list(v: DtnValue | undefined): DtnList {
  if (Array.isArray(v)) return v;
  const o = obj(v);
  if (o && Array.isArray(o.array)) return o.array;
  return [];
}
export function str(v: DtnValue | undefined): string {
  return typeof v === 'string' ? v : '';
}
/** Parse a Dorico rational like "47/2" or "3" into a number. */
export function rational(v: DtnValue | undefined): number {
  const s = str(v);
  if (!s) return 0;
  const m = s.match(/^(-?\d+)(?:\/(\d+))?$/);
  if (!m) return Number(s) || 0;
  return Number(m[1]) / (m[2] ? Number(m[2]) : 1);
}
