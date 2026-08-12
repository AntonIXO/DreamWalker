/**
 * Cutting one generated canvas into the sprites it contains.
 *
 * Retro Diffusion's sheet styles — `rd_plus__item_sheet`, `rd_pro__inventory_items`,
 * every `rd_animation__*` — return **one image**, never `num_images` images. That is the
 * whole reason they are cheap: the price is per canvas, so a dozen props on a 256×256
 * sheet cost what one prop would. The saving is real but it is paid for here, in slicing.
 *
 * Cells that came back empty are dropped rather than written as blank files, because a
 * model asked for twelve objects reliably draws ten or eleven.
 */

import { deflateSync } from "node:zlib";

import type { DecodedImage } from "./reference";

/** Cut a canvas into `cell`-sized squares, left to right, top to bottom. */
export function sliceSheet(image: DecodedImage, cell: number): DecodedImage[] {
  const cols = Math.floor(image.width / cell);
  const rows = Math.floor(image.height / cell);
  const out: DecodedImage[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const data = new Uint8Array(cell * cell * 4);
      for (let y = 0; y < cell; y++) {
        const from = ((row * cell + y) * image.width + col * cell) * 4;
        data.set(image.data.subarray(from, from + cell * 4), y * cell * 4);
      }
      const piece = { width: cell, height: cell, data };
      if (!isBlank(piece)) out.push(piece);
    }
  }
  return out;
}

/**
 * Whether a cell holds anything worth keeping.
 *
 * Both tests are needed: a transparent cell is empty, and so is one filled edge to edge
 * with a single flat colour, which is what the background of an item sheet looks like
 * once it has been cut into squares.
 */
export function isBlank(image: DecodedImage): boolean {
  let opaque = 0;
  const seen = new Set<number>();
  for (let i = 0; i < image.data.length; i += 4) {
    if ((image.data[i + 3] ?? 0) < 128) continue;
    opaque++;
    seen.add(
      ((image.data[i] ?? 0) << 16) |
        ((image.data[i + 1] ?? 0) << 8) |
        (image.data[i + 2] ?? 0),
    );
  }
  const area = image.width * image.height;
  if (opaque < area * 0.02) return true;
  return seen.size <= 2 && opaque > area * 0.95;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(body, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

let table: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A truecolour-with-alpha PNG.
 *
 * `art/png.ts` writes the *indexed* atlas and cannot hold more than sixteen colours by
 * design — that constraint is the point of the atlas. A sliced sprite is a loose asset
 * that has not been palette-locked yet, so it needs an encoder without that ceiling.
 */
export function encodePngRgba(image: DecodedImage): Buffer {
  const raw = new Uint8Array(image.height * (image.width * 4 + 1));
  for (let y = 0; y < image.height; y++) {
    const row = y * (image.width * 4 + 1);
    raw[row] = 0; // filter: none
    raw.set(
      image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
      row + 1,
    );
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(chunk("IHDR", ihdr)),
    Buffer.from(chunk("IDAT", deflateSync(Buffer.from(raw), { level: 9 }))),
    Buffer.from(chunk("IEND", new Uint8Array(0))),
  ]);
}

/**
 * Key out an item sheet's flat background, locally and for free.
 *
 * `rd_plus__item_sheet` draws its objects on a solid colour, and neither of the free edit
 * tools removes it — `palette_converter` only recolours. `background_remover` would, at
 * $0.01 an image, which is $1 for a hundred props and pointless when the background is a
 * single flat colour by construction.
 *
 * So: take the colour from the corners, where an object never is, and clear every pixel
 * matching it that is reachable from the edge. Flood fill rather than a global match, so
 * a prop that happens to *contain* the background colour keeps its insides.
 */
export function keyOutBackground(
  image: DecodedImage,
  tolerance = 24,
): DecodedImage {
  const { width, height, data } = image;
  const out = new Uint8Array(data);
  const at = (x: number, y: number): number => (y * width + x) * 4;

  const corners = [
    at(0, 0),
    at(width - 1, 0),
    at(0, height - 1),
    at(width - 1, height - 1),
  ];
  const key = corners.map((i) => [data[i]!, data[i + 1]!, data[i + 2]!]);
  const matches = (i: number): boolean =>
    key.some(
      ([r, g, b]) =>
        Math.abs(data[i]! - r!) <= tolerance &&
        Math.abs(data[i + 1]! - g!) <= tolerance &&
        Math.abs(data[i + 2]! - b!) <= tolerance,
    );

  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) {
    stack.push(x, x + (height - 1) * width);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, width - 1 + y * width);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!matches(i)) continue;
    out[i + 3] = 0;
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }
  return { width, height, data: out };
}
