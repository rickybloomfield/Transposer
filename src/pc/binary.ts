/** Little-endian binary reader helpers. */
export class Reader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  pos = 0;
  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }
  get length(): number { return this.bytes.length; }
  u8(at = this.pos): number { return this.bytes[at]; }
  i8(at = this.pos): number { return this.view.getInt8(at); }
  u16(at = this.pos): number { return this.view.getUint16(at, true); }
  i16(at = this.pos): number { return this.view.getInt16(at, true); }
  u32(at = this.pos): number { return this.view.getUint32(at, true); }
  readU8(): number { return this.bytes[this.pos++]; }
  readU16(): number { const v = this.u16(); this.pos += 2; return v; }
  readI16(): number { const v = this.i16(); this.pos += 2; return v; }
  readU32(): number { const v = this.u32(); this.pos += 4; return v; }
  slice(start: number, end: number): Uint8Array { return this.bytes.subarray(start, end); }
  latin1(start: number, len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.bytes[start + i]);
    return s;
  }
  /** Find an ASCII tag at or after `from`; returns -1 if absent. */
  find(tag: string, from = 0): number {
    const first = tag.charCodeAt(0);
    outer: for (let i = from; i <= this.bytes.length - tag.length; i++) {
      if (this.bytes[i] !== first) continue;
      for (let j = 1; j < tag.length; j++) if (this.bytes[i + j] !== tag.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  }
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
