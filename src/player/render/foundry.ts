/**
 * Making a tile that was never baked.
 *
 * This is the one place the rule stated at the top of `main.ts` bends, and it bends on
 * purpose. The player generated nothing, because §8 makes a dream an authored artifact and
 * everything in it was chosen by a person. But §6 has the sleeper turning the world into
 * things that were not in it — "сгенерировалось то, чего не было: разум подкинул, он тут
 * хозяин" — and a world that can only ever rearrange tiles the Lord happened to bake is a
 * world whose imagination stops at the atlas.
 *
 * What keeps this honest is that nothing here *invents* anything. The frames are drawn by
 * `shared/art/terrain.ts` — the same function `lord art` used, from the same palette and
 * the same measured `StyleProfile` that came off the Lord's reference image. A tile minted
 * three minutes into a cycle is drawn by the same code, under the same constraints, as one
 * baked a week ago. It cannot come out in a colour the dream does not have, because
 * `Raster` works in palette indices and there is nowhere to put a seventeenth colour.
 *
 * So the seam is: the Lord chooses what the world is made of; the sleeper chooses what it
 * makes with it.
 */

import { BufferImageSource, Rectangle, Texture } from "pixi.js";

import { autotileOf, frameNamesFor } from "../../shared/autotile";
import type { DreamArtifact, Palette } from "../../shared/dream";
import type { StyleProfile } from "../../shared/art/style";
import {
  drawBlobSet,
  drawEdgeSet,
  drawPlain,
  TILE_PX,
} from "../../shared/art/terrain";
import { TRANSPARENT, type Raster } from "../../shared/art/raster";
import type { AtlasTextures } from "./atlasTextures";

/**
 * Where the frames come from.
 *
 * Procedural today, and deliberately so: §7 prices generated art at "$1–3, paid by the Lord
 * once", which is an author-time budget. A dream that called a model every time the sleeper
 * wanted a pond would bill the player for the sleeper's imagination. The seam exists so a
 * model-backed source *can* be dropped in — it mirrors the author-time `CandidateSource` in
 * `tools/lord/art/candidates.ts` — but the runtime must never depend on one being there.
 */
export interface TileSource {
  readonly name: string;
  frames(role: string, palette: Palette, style: StyleProfile): Raster[];
}

export const proceduralTiles: TileSource = {
  name: "procedural",
  frames(role, palette, style) {
    switch (autotileOf(role)) {
      case "blob":
        return drawBlobSet(role, palette, style);
      case "edge":
        return drawEdgeSet(role, palette, style);
      default:
        return [drawPlain(role, palette, style)];
    }
  },
};

/**
 * Palette index -> one packed pixel, built once.
 *
 * Written as a `Uint32Array` and uploaded as its byte view, so the packing has to match the
 * texture format declared below exactly. `rgba8unorm` means the bytes come out r, g, b, a —
 * which on a little-endian machine is this shift order and not the obvious one.
 */
function paletteToRgba(palette: Palette): Uint32Array {
  const table = new Uint32Array(256);
  palette.colors.forEach((hex, i) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    table[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  });
  table[TRANSPARENT] = 0;
  return table;
}

export class TileFoundry {
  private readonly rgba: Uint32Array;
  /** Roles already minted this session, so a terrain is drawn once however often used. */
  private readonly minted = new Set<string>();

  constructor(
    private readonly artifact: DreamArtifact,
    private readonly atlas: AtlasTextures,
    private readonly source: TileSource = proceduralTiles,
  ) {
    this.rgba = paletteToRgba(artifact.palette);
  }

  /** Whether the baked atlas can already draw this role. */
  has(role: string): boolean {
    const frames = this.atlas.roles.get(role);
    return frames !== undefined && frames.length > 0;
  }

  /**
   * Make sure a role is drawable, minting it if the Lord never baked it.
   *
   * @returns true when something new was made, so the caller knows to redraw.
   */
  ensure(role: string): boolean {
    if (this.has(role) || this.minted.has(role)) return false;
    this.minted.add(role);

    const rasters = this.source.frames(
      role,
      this.artifact.palette,
      this.artifact.style,
    );
    if (rasters.length === 0) return false;

    // One strip per role: a row of frames in a single texture, so a minted terrain costs
    // one extra draw call at most however many of its forty-seven shapes are on screen.
    const width = TILE_PX * rasters.length;
    const pixels = new Uint32Array(width * TILE_PX);

    rasters.forEach((raster, index) => {
      const ox = index * TILE_PX;
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          pixels[y * width + ox + x] = this.rgba[raster.get(x, y)] ?? 0;
        }
      }
    });

    // `BufferImageSource`, not the base `TextureSource`: only the former knows how to
    // upload a raw typed array, and the base class silently produces an empty texture —
    // which reads on screen as the ground having turned black rather than as an error.
    //
    // The format is stated rather than inferred. Pixi defaults a `Uint8Array` to
    // `bgra8unorm`, which would swap every red and blue in the dream.
    const source = new BufferImageSource({
      resource: new Uint8Array(pixels.buffer),
      width,
      height: TILE_PX,
      format: "rgba8unorm",
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "nearest",
      label: `foundry:${role}`,
    });

    const names = frameNamesFor(role);
    const textures = rasters.map((_, index) => {
      const name = names[index] ?? `${role}_${index}`;
      const texture = new Texture({
        source,
        frame: new Rectangle(index * TILE_PX, 0, TILE_PX, TILE_PX),
        label: name,
      });
      this.atlas.frames.set(name, texture);
      return texture;
    });

    this.atlas.roles.set(role, textures);
    console.info(
      `[foundry] minted ${textures.length} frames for "${role}" — the sleeper made something the Lord did not`,
    );
    return true;
  }

  /** Every role a set of tiles needs, minted in one pass. */
  ensureAll(roles: Iterable<string>): boolean {
    let made = false;
    for (const role of roles) made = this.ensure(role) || made;
    return made;
  }
}
