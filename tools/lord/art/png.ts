/**
 * A minimal indexed-colour PNG writer.
 *
 * Indexed rather than RGBA on purpose. §7.1 fixes the dream's palette at twelve to
 * sixteen colours, and an 8-bit palettised PNG makes that a property of the file rather
 * than a promise: there is literally nowhere in the format to put a seventeenth colour.
 * Any later art source — Retro Diffusion included — has to come through this encoder
 * and therefore has to obey the palette.
 *
 * Index 0 is reserved for transparency, so a dream palette index `i` is stored as `i+1`.
 */

import { deflateSync } from "node:zlib";

import { TRANSPARENT, type IndexedImage } from "../../../src/shared/art/raster";

export { TRANSPARENT, type IndexedImage };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * @param colors dream palette, `#rrggbb`. Max 255 entries — index 0 goes to transparency.
 */
export function encodeIndexedPng(
  image: IndexedImage,
  colors: readonly string[],
): Buffer {
  if (colors.length > 255)
    throw new Error(`palette has ${colors.length} colours, max 255`);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(3, 9); // colour type 3 = indexed
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Entry 0 is the transparent one; the dream's colours follow, shifted by one.
  const plte = Buffer.alloc((colors.length + 1) * 3);
  plte.writeUInt8(0, 0);
  plte.writeUInt8(0, 1);
  plte.writeUInt8(0, 2);
  colors.forEach((hex, i) => {
    const value = hex.replace("#", "");
    plte.writeUInt8(parseInt(value.slice(0, 2), 16), (i + 1) * 3);
    plte.writeUInt8(parseInt(value.slice(2, 4), 16), (i + 1) * 3 + 1);
    plte.writeUInt8(parseInt(value.slice(4, 6), 16), (i + 1) * 3 + 2);
  });

  const trns = Buffer.alloc(1); // only entry 0 is transparent; the rest default to opaque
  trns.writeUInt8(0, 0);

  // Each scanline is prefixed with its filter type. Filter 0 (none) keeps this simple,
  // and at atlas sizes the deflate pass gets it small enough regardless.
  const stride = image.width + 1;
  const raw = Buffer.alloc(stride * image.height);
  for (let y = 0; y < image.height; y++) {
    raw.writeUInt8(0, y * stride);
    for (let x = 0; x < image.width; x++) {
      const value = image.pixels[y * image.width + x]!;
      raw.writeUInt8(value === TRANSPARENT ? 0 : value + 1, y * stride + 1 + x);
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("tRNS", trns),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
