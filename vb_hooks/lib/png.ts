// A tiny PNG encoder (RGB, no filtering), so the mock provider and the seed
// fixtures can make test images without an image library.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export type Pixel = (x: number, y: number) => [number, number, number];

export function encodePng(width: number, height: number, pixel: Pixel): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[i++] = r; raw[i++] = g; raw[i++] = b;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A warm-toned test image: a gradient with a "coffee bag" block. Variant 0 or 1. */
export function testImage(variant: number, size = 256): Uint8Array {
  const v = variant % 2;
  return encodePng(size, size, (x, y) => {
    const bag = x > size * 0.3 && x < size * 0.7 && y > size * (v ? 0.25 : 0.35) && y < size * 0.85;
    if (bag) return v ? [92, 58, 38] : [58, 38, 28];
    const t = (x + y) / (2 * size);
    return v ? [230 - t * 40, 150 - t * 50, 80 - t * 30].map(Math.round) as [number, number, number]
      : [245 - t * 30, 200 - t * 60, 140 - t * 60].map(Math.round) as [number, number, number];
  });
}
