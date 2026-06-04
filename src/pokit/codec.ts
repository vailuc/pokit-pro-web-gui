/**
 * Little-endian binary read/write helpers for Pokit BLE characteristics.
 *
 * All Pokit characteristics use little-endian byte order with 32-bit floats.
 */

/** Sequential little-endian writer backed by a growable byte array. */
export class ByteWriter {
  private bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  /** 32-bit IEEE-754 float, little-endian. */
  f32(value: number): this {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    const view = new Uint8Array(buf);
    this.bytes.push(view[0], view[1], view[2], view[3]);
    return this;
  }

  toBuffer(): ArrayBuffer {
    return new Uint8Array(this.bytes).buffer;
  }

  get length(): number {
    return this.bytes.length;
  }
}

/** Sequential little-endian reader over a DataView. */
export class ByteReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(data: DataView | ArrayBuffer) {
    this.view = data instanceof DataView ? data : new DataView(data);
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  get byteLength(): number {
    return this.view.byteLength;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Read `count` raw bytes as a Uint8Array. */
  bytes(count: number): Uint8Array {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = this.view.getUint8(this.offset + i);
    this.offset += count;
    return out;
  }

  /** Skip `count` bytes. */
  skip(count: number): this {
    this.offset += count;
    return this;
  }
}

/** Format a 6-byte MAC address (read big-endian/display order) as a colon string. */
export function formatMac(bytes: Uint8Array): string {
  return Array.from(bytes)
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
}
