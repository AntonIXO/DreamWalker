/**
 * Tile candidates — four per role, for the Lord to choose between.
 *
 * This module is the art seam. §7 argues that raw generated pixel art is not drop-in, that
 * studios answer with human paintover, and that demanding Aseprite skills from a Lord would
 * kill the whole UGC idea. What is left is a human as *selector*: generate four, let a
 * person point at the best one. That interaction is in `commands/art.ts` and does not care
 * where the candidates came from.
 *
 * A candidate is now a whole **tileset**, not a tile: an autotiled terrain is forty-seven
 * frames that have to belong to each other, so offering the Lord one frame at a time would
 * be offering a choice they cannot evaluate. They are shown the representative frame — the
 * one with neighbours on every side, which is what most of the ground actually looks like —
 * and the whole set follows their pick.
 *
 * The drawing itself lives in `src/shared/art/terrain.ts` rather than here, because the
 * *player* has to run it too: when the sleeper invents a terrain mid-play, the browser
 * mints it with this exact code, so it cannot come out looking like a different game.
 * Replacing the body of `generate` with a Retro Diffusion call (POST /v1/inferences,
 * `input_palette`, `tile_x`/`tile_y`) changes what the Lord is choosing between and
 * nothing else — and stays author-time, never runtime.
 */

import { autotileOf } from "../../../src/shared/autotile";
import type { Palette } from "../../../src/shared/dream";
import type { StyleProfile } from "../../../src/shared/art/style";
import {
  TILE_PX,
  drawBlobSet,
  drawEdgeSet,
  drawPlain,
} from "../../../src/shared/art/terrain";
import { REQUIRED_TILE_ROLES } from "../../../src/shared/tilecodes";
import type { Raster } from "../../../src/shared/art/raster";

export { TILE_PX };
export const CANDIDATES_PER_ROLE = 4;

export interface Candidate {
  role: string;
  variant: number;
  /** Every frame of this role, in the order the atlas and the renderer both expect. */
  frames: Raster[];
  /** The one to show the Lord: fully surrounded, which is most of what they will see. */
  preview: Raster;
}

export interface CandidateSource {
  readonly name: string;
  generate(
    role: string,
    palette: Palette,
    style: StyleProfile,
    styleWords: readonly string[],
    seed: string,
    count: number,
  ): Promise<Candidate[]>;
}

export const TILE_ROLES: readonly string[] = REQUIRED_TILE_ROLES;

function framesFor(
  role: string,
  palette: Palette,
  style: StyleProfile,
  variant: number,
): Raster[] {
  switch (autotileOf(role)) {
    case "blob":
      return drawBlobSet(role, palette, style, variant);
    case "edge":
      return drawEdgeSet(role, palette, style, variant);
    default:
      return [drawPlain(role, palette, style, variant)];
  }
}

export const proceduralCandidates: CandidateSource = {
  name: "procedural",
  async generate(role, palette, style, _styleWords, seed, count) {
    void seed;
    const out: Candidate[] = [];
    for (let variant = 0; variant < count; variant++) {
      const frames = framesFor(role, palette, style, variant);
      out.push({
        role,
        variant,
        frames,
        // Masks are numbered in ascending order, so the all-neighbours case is always
        // last — for a blob set and an edge set alike.
        preview: frames[frames.length - 1]!,
      });
    }
    return out;
  },
};
