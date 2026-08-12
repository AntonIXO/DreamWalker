/**
 * Baking the chosen art into one atlas.
 *
 * Everything the player draws comes from a single indexed PNG plus a manifest of frame
 * rectangles. One image means one texture, which means the whole dream batches into
 * very few draw calls — and because the PNG is palettised, the dream's colours are
 * enforced by the file format rather than by anyone remembering (§7.1).
 *
 * The manifest also records *which* candidate the Lord picked per role. That is
 * provenance, not decoration: it is the record of the human choice §7.4 is built on,
 * and it survives regenerating the art later.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DREAM_FORMAT_VERSION,
  type AtlasFrame,
  type AtlasManifest,
  type Palette,
} from "../../../src/shared/dream";
import { encodeIndexedPng, TRANSPARENT, type IndexedImage } from "./png";
import { TILE_PX } from "./candidates";
import type { Raster } from "../../../src/shared/art/raster";

/**
 * Atlas width in frames. Sixteen, because autotiled terrain turned a dozen frames into a
 * few hundred and an eight-wide sheet would be a very tall ribbon — which wastes texture
 * memory on most GPUs, since they pad to a power of two in both directions anyway.
 */
const COLUMNS = 16;

export interface AtlasInput {
  /** Frame name -> image. Tile roles, player frames and figure frames all live here. */
  frames: Record<string, Raster>;
  /** Role -> the frame names that satisfy it, in preference order. */
  roleFrames: Record<string, string[]>;
  /** Role -> which candidate index the Lord chose. */
  chosen: Record<string, number>;
  palette: Palette;
}

export interface BakedAtlas {
  manifest: AtlasManifest;
  png: Buffer;
}

export function bakeAtlas(input: AtlasInput): BakedAtlas {
  const names = Object.keys(input.frames).sort();
  if (names.length === 0) throw new Error("nothing to bake — no frames");

  for (const name of names) {
    const frame = input.frames[name]!;
    if (frame.width !== TILE_PX || frame.height !== TILE_PX) {
      throw new Error(
        `frame "${name}" is ${frame.width}x${frame.height}, atlas expects ${TILE_PX}x${TILE_PX}`,
      );
    }
  }

  const rows = Math.ceil(names.length / COLUMNS);
  const width = COLUMNS * TILE_PX;
  const height = rows * TILE_PX;

  const sheet: IndexedImage = {
    width,
    height,
    pixels: new Uint8Array(width * height).fill(TRANSPARENT),
  };

  const frames: Record<string, AtlasFrame> = {};

  names.forEach((name, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const ox = col * TILE_PX;
    const oy = row * TILE_PX;
    const source = input.frames[name]!;

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        sheet.pixels[(oy + y) * width + ox + x] = source.get(x, y);
      }
    }

    frames[name] = { x: ox, y: oy, w: TILE_PX, h: TILE_PX };
  });

  for (const [role, list] of Object.entries(input.roleFrames)) {
    for (const name of list) {
      if (!(name in frames))
        throw new Error(`role "${role}" names missing frame "${name}"`);
    }
  }

  const manifest: AtlasManifest = {
    format: DREAM_FORMAT_VERSION,
    image: "atlas.png",
    tileSize: TILE_PX,
    frames,
    roleFrames: input.roleFrames,
    chosen: input.chosen,
  };

  return { manifest, png: encodeIndexedPng(sheet, input.palette.colors) };
}

export async function writeAtlas(
  dir: string,
  baked: BakedAtlas,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "atlas.png"), baked.png);
  await writeFile(
    join(dir, "atlas.json"),
    `${JSON.stringify(baked.manifest, null, 2)}\n`,
    "utf8",
  );
}
