/**
 * Drawing a terrain, in all forty-seven of its shapes.
 *
 * Authoring forty-seven tiles by hand per material is what makes autotiling expensive, and
 * generating forty-seven independently is what makes it look like forty-seven materials.
 * The way out is the standard one: draw **quarter tiles**. Every 16×16 frame is four 8×8
 * corners, and there are only five kinds of corner —
 *
 *     interior      both cardinals join, and so does the diagonal
 *     inner corner  both cardinals join, the diagonal does not
 *     edge (h/v)    one cardinal joins
 *     outer corner  neither joins
 *
 * — so a material is five small drawings, and the forty-seven frames are assembled from
 * them. Every frame is therefore the same material by construction, which is exactly what
 * §7.1 is after, and it is why this can be run at *runtime* to mint a terrain the Lord
 * never baked without the result looking foreign (`player/render/foundry.ts`).
 *
 * Shared: no DOM, no node. Both the CLI and the browser draw with this.
 */

import { Neighbour, blobMaskFor, EDGE_FRAMES } from "../autotile";
import type { Palette } from "../dream";
import { Raster, TRANSPARENT } from "./raster";
import { dithers, rampAt, shade, type StyleProfile } from "./style";

export const TILE_PX = 16;
const HALF = TILE_PX / 2;

/** A deterministic value in 0..1 per pixel, for texture that survives a reload. */
function speck(x: number, y: number, salt: number): number {
  let hash = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

/**
 * How a material is painted, before any edges are considered.
 *
 * Named per role rather than derived, because the difference between grass and water is
 * not a colour — it is that one is flecked and the other is banded, and no amount of
 * palette work makes a flat fill read as either.
 */
export interface Material {
  /**
   * Which hue family this material takes, as an index into the style's ramps.
   *
   * A *number* rather than a name, and assigned rather than hashed. Hashing the role name
   * looked tidy and was wrong: it collided, and a world where grass, sand and the treeline
   * all came out the same tan is unreadable however correct its palette is. Materials that
   * meet each other on screen are given different families deliberately.
   */
  family: number;
  /**
   * How far up its ramp the flat surface sits, 0..1.
   *
   * This is the safety net. A dream whose reference has only one usable hue family — and
   * `ВоНеСиМо` nearly is one — falls back to telling materials apart by lightness alone,
   * so the spread here has to be wide enough to survive that.
   */
  level: number;
  /** What the surface does when nothing is happening. */
  texture: "flat" | "fleck" | "band" | "blade" | "grain";
  /** How strongly the texture reads, 0..1. */
  strength: number;
  /** Whether the shape gets an outline where it meets something else. */
  outline: boolean;
}

/**
 * Every role in `TILE_ROLE` needs an entry.
 *
 * A missing one used to fall through to a flat outlined square, which is how the treeline
 * first came out looking like corrugated iron: `treeCanopy` had no material, so every
 * second row of the border was drawn as a plain box with a line round it.
 */
const MATERIALS: Record<string, Material> = {
  // Ground — family 0, and the reference point everything else is read against.
  grass: {
    family: 0,
    level: 0.5,
    texture: "fleck",
    strength: 0.18,
    outline: false,
  },
  grassTall: {
    family: 0,
    level: 0.3,
    texture: "blade",
    strength: 0.55,
    outline: true,
  },
  flowers: {
    family: 3,
    level: 0.75,
    texture: "fleck",
    strength: 0.5,
    outline: false,
  },

  // Worn ground — family 1, lighter than grass so a road reads at a glance.
  path: {
    family: 1,
    level: 0.82,
    texture: "grain",
    strength: 0.18,
    outline: false,
  },
  sand: {
    family: 1,
    level: 0.68,
    texture: "grain",
    strength: 0.14,
    outline: false,
  },

  // Water — family 2, and the darkest thing on the ground plane.
  water: {
    family: 2,
    level: 0.42,
    texture: "band",
    strength: 0.35,
    outline: true,
  },
  waterDeep: {
    family: 2,
    level: 0.18,
    texture: "band",
    strength: 0.25,
    outline: false,
  },

  // Rises.
  cliff: {
    family: 1,
    level: 0.55,
    texture: "flat",
    strength: 0,
    outline: true,
  },
  cliffFace: {
    family: 1,
    level: 0.22,
    texture: "band",
    strength: 0.45,
    outline: true,
  },
  ledgeS: {
    family: 1,
    level: 0.34,
    texture: "band",
    strength: 0.5,
    outline: true,
  },
  ledgeE: {
    family: 1,
    level: 0.34,
    texture: "band",
    strength: 0.5,
    outline: true,
  },
  ledgeW: {
    family: 1,
    level: 0.34,
    texture: "band",
    strength: 0.5,
    outline: true,
  },

  // The treeline — family 3, dark, and the mass the whole map is framed by.
  tree: {
    family: 3,
    level: 0.22,
    texture: "fleck",
    strength: 0.35,
    outline: false,
  },
  treeCanopy: {
    family: 3,
    level: 0.38,
    texture: "fleck",
    strength: 0.4,
    outline: false,
  },

  // Built things.
  buildingWall: {
    family: 1,
    level: 0.4,
    texture: "band",
    strength: 0.3,
    outline: true,
  },
  buildingRoof: {
    family: 2,
    level: 0.62,
    texture: "band",
    strength: 0.4,
    outline: true,
  },
  warp: { family: 3, level: 0.12, texture: "flat", strength: 0, outline: true },
  sign: {
    family: 1,
    level: 0.3,
    texture: "grain",
    strength: 0.3,
    outline: true,
  },

  // Interiors.
  floor: {
    family: 1,
    level: 0.6,
    texture: "grain",
    strength: 0.1,
    outline: false,
  },
  floorAlt: {
    family: 1,
    level: 0.5,
    texture: "grain",
    strength: 0.2,
    outline: false,
  },
  threshold: {
    family: 1,
    level: 0.72,
    texture: "grain",
    strength: 0.15,
    outline: false,
  },
  wall: {
    family: 3,
    level: 0.35,
    texture: "band",
    strength: 0.3,
    outline: true,
  },
  // Darker than the wall above it, not lighter. A lit wall face reads as a light source,
  // and two of them at the corners of a room read as windows that are not there.
  wallFace: {
    family: 3,
    level: 0.24,
    texture: "band",
    strength: 0.35,
    outline: true,
  },

  // Gates. Marked out by the accent, which is handled after the surface is painted.
  doorOpen: {
    family: 1,
    level: 0.85,
    texture: "flat",
    strength: 0,
    outline: true,
  },
  doorKey: {
    family: 2,
    level: 0.5,
    texture: "band",
    strength: 0.3,
    outline: true,
  },
  doorLever: {
    family: 2,
    level: 0.5,
    texture: "band",
    strength: 0.3,
    outline: true,
  },
  doorPuzzle: {
    family: 2,
    level: 0.5,
    texture: "band",
    strength: 0.3,
    outline: true,
  },
  doorSealed: {
    family: 3,
    level: 0.28,
    texture: "band",
    strength: 0.5,
    outline: true,
  },

  // Dressing.
  prop: {
    family: 0,
    level: 0.65,
    texture: "fleck",
    strength: 0.4,
    outline: false,
  },
  propSolid: {
    family: 1,
    level: 0.45,
    texture: "band",
    strength: 0.35,
    outline: true,
  },
};

const FALLBACK: Material = {
  family: 0,
  level: 0.5,
  texture: "flat",
  strength: 0,
  outline: true,
};

export function materialFor(role: string): Material {
  return MATERIALS[role] ?? FALLBACK;
}

/** Roles that get a mark stamped on them in the accent colour, so a gate reads as a gate. */
const MARKED: Record<string, "key" | "lever" | "puzzle" | "sealed" | "warp"> = {
  doorKey: "key",
  doorLever: "lever",
  doorPuzzle: "puzzle",
  doorSealed: "sealed",
  warp: "warp",
};

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

/**
 * Paint the flat body of a material across the whole tile.
 *
 * Textures are drawn from a hash of the tile-local position rather than an RNG, so the
 * same material always comes out the same, whichever of the forty-seven frames is being
 * built and whichever side of the program is building it.
 */
function paintSurface(
  raster: Raster,
  material: Material,
  style: StyleProfile,
  seed: number,
): void {
  const ramp = rampAt(style, material.family + seed);
  const body = shade(ramp, material.level);
  const lighter = shade(ramp, Math.min(1, material.level + 0.28));
  const darker = shade(ramp, Math.max(0, material.level - 0.28));

  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      let value = body;
      const noise = speck(x, y, seed);

      switch (material.texture) {
        case "fleck":
          if (noise < material.strength * 0.4) value = darker;
          else if (noise > 1 - material.strength * 0.35) value = lighter;
          break;
        case "grain":
          if (noise < material.strength) value = darker;
          break;
        case "band":
          // Horizontal banding, offset per row group, so water and stone read as layered
          // rather than as noise.
          if ((y + Math.floor(noise * 2)) % 4 === 0) value = lighter;
          else if ((y + 2) % 4 === 0 && noise < material.strength)
            value = darker;
          break;
        case "blade":
          // Upright strokes: what makes tall grass read as something you push through.
          if (x % 3 === (y % 2) * 1 && noise < material.strength)
            value = darker;
          else if (noise > 1 - material.strength * 0.3) value = lighter;
          break;
        case "flat":
        default:
          break;
      }

      // Dithering only ever moves one step along the ramp, and only where the reference
      // dithered at all — for a flat-shaded reference this does nothing, by design.
      if (value === body && dithers(style, x, y)) value = darker;

      raster.set(x, y, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

type Corner = "nw" | "ne" | "sw" | "se";

const CORNER_OFFSET: Record<Corner, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  ne: { x: HALF, y: 0 },
  sw: { x: 0, y: HALF },
  se: { x: HALF, y: HALF },
};

/** The two cardinals and the diagonal that decide what a corner looks like. */
const CORNER_NEIGHBOURS: Record<
  Corner,
  { v: number; h: number; d: number; vx: number; hy: number }
> = {
  nw: { v: Neighbour.N, h: Neighbour.W, d: Neighbour.NW, vx: -1, hy: -1 },
  ne: { v: Neighbour.N, h: Neighbour.E, d: Neighbour.NE, vx: 1, hy: -1 },
  sw: { v: Neighbour.S, h: Neighbour.W, d: Neighbour.SW, vx: -1, hy: 1 },
  se: { v: Neighbour.S, h: Neighbour.E, d: Neighbour.SE, vx: 1, hy: 1 },
};

/**
 * Cut one quadrant back to the shape its neighbours imply.
 *
 * "Cut" is the operation, not "draw": the surface is already painted across the whole
 * tile, and an edge is where it gets rounded off and outlined. Doing it subtractively is
 * what guarantees the interior of every frame is identical — the thing that makes forty-
 * seven separately-drawn tiles look like forty-seven materials is precisely that their
 * middles differ.
 */
function cutCorner(
  raster: Raster,
  corner: Corner,
  mask: number,
  style: StyleProfile,
  material: Material,
): void {
  const { v, h, d } = CORNER_NEIGHBOURS[corner];
  const joinV = (mask & v) !== 0;
  const joinH = (mask & h) !== 0;
  const joinD = (mask & d) !== 0;

  // Fully surrounded: nothing to cut.
  if (joinV && joinH && joinD) return;

  const { x: ox, y: oy } = CORNER_OFFSET[corner];
  const outward = corner === "nw" || corner === "ne" ? -1 : 1;
  const sideways = corner === "nw" || corner === "sw" ? -1 : 1;

  const outline = material.outline ? style.outlineIndex : TRANSPARENT;

  for (let y = 0; y < HALF; y++) {
    for (let x = 0; x < HALF; x++) {
      // Distance from this pixel to the tile's outer edge, in each direction.
      const fromV = outward < 0 ? y : HALF - 1 - y;
      const fromH = sideways < 0 ? x : HALF - 1 - x;
      const px = ox + x;
      const py = oy + y;

      if (!joinV && !joinH) {
        // Outer corner: round it off, so terrain reads as blobs rather than boxes.
        if (fromV + fromH < 1) {
          raster.set(px, py, TRANSPARENT);
          continue;
        }
        if (fromV + fromH < 2) raster.set(px, py, outline);
        else if (fromV === 0 || fromH === 0) raster.set(px, py, outline);
      } else if (!joinV) {
        if (fromV === 0) raster.set(px, py, outline);
      } else if (!joinH) {
        if (fromH === 0) raster.set(px, py, outline);
      } else {
        // Both cardinals join but the diagonal does not: an inner corner, which is the
        // case a 16-tile set cannot express and the reason the blob set exists at all.
        if (fromV === 0 && fromH === 0) raster.set(px, py, outline);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

/**
 * A mark in the accent colour, so a gate is legible as a gate.
 *
 * §7 keeps one live colour per dream and spends it sparingly; this is what it is for. The
 * shapes are crude because at 16 pixels they have to be — what matters is that a key gate
 * and a lever gate are visibly *not the same thing*, so a player can learn which of them
 * they are still carrying nothing for.
 */
function stampMark(raster: Raster, kind: string, style: StyleProfile): void {
  const accent = style.accentIndex;
  const mid = Math.floor(TILE_PX / 2);
  const put = (x: number, y: number): void => raster.set(x, y, accent);

  switch (kind) {
    case "key":
      for (let y = mid - 2; y <= mid + 2; y++) put(mid, y);
      put(mid - 1, mid - 2);
      put(mid + 1, mid + 2);
      break;
    case "lever":
      for (let x = mid - 3; x <= mid + 3; x++) put(x, mid);
      put(mid + 3, mid - 1);
      put(mid + 3, mid + 1);
      break;
    case "puzzle":
      // Something to stare at rather than understand.
      for (let x = mid - 2; x <= mid + 2; x++) {
        put(x, mid - 2);
        put(x, mid + 2);
      }
      put(mid + 2, mid - 1);
      put(mid - 2, mid + 1);
      break;
    case "sealed":
      // Crossed out. The one gate the player can do nothing about.
      for (let i = -3; i <= 3; i++) {
        put(mid + i, mid + i);
        put(mid + i, mid - i);
      }
      break;
    case "warp":
      // A doorway: darker than its frame, open at the bottom.
      for (let y = mid - 4; y <= mid + 4; y++) {
        put(mid - 3, y);
        put(mid + 3, y);
      }
      for (let x = mid - 3; x <= mid + 3; x++) put(x, mid - 4);
      break;
  }
}

function draw(
  role: string,
  mask: number,
  palette: Palette,
  style: StyleProfile,
  seed: number,
): Raster {
  const material = materialFor(role);
  const raster = new Raster(TILE_PX, TILE_PX, palette);
  paintSurface(raster, material, style, seed);
  const mark = MARKED[role];
  if (mark) stampMark(raster, mark, style);
  for (const corner of ["nw", "ne", "sw", "se"] as Corner[]) {
    cutCorner(raster, corner, mask, style, material);
  }
  return raster;
}

/** All 47 frames of a blob terrain, in the order `blobIndex` numbers them. */
export function drawBlobSet(
  role: string,
  palette: Palette,
  style: StyleProfile,
  variant = 0,
): Raster[] {
  const frames: Raster[] = [];
  for (let index = 0; index < 47; index++) {
    frames.push(draw(role, blobMaskFor(index), palette, style, variant));
  }
  return frames;
}

/**
 * All 16 frames of an edge terrain. The mask is promoted to the eight-neighbour form with
 * every diagonal joined, so the same corner code draws both kinds of set.
 */
export function drawEdgeSet(
  role: string,
  palette: Palette,
  style: StyleProfile,
  variant = 0,
): Raster[] {
  const frames: Raster[] = [];
  for (let index = 0; index < EDGE_FRAMES; index++) {
    const n = (index & 1) !== 0;
    const e = (index & 2) !== 0;
    const s = (index & 4) !== 0;
    const w = (index & 8) !== 0;

    let mask = 0;
    if (n) mask |= Neighbour.N;
    if (e) mask |= Neighbour.E;
    if (s) mask |= Neighbour.S;
    if (w) mask |= Neighbour.W;
    // A diagonal counts only when both its cardinals do — the same rule the renderer
    // applies, so an edge set never shows an inner corner it has no frame for.
    if (n && e) mask |= Neighbour.NE;
    if (e && s) mask |= Neighbour.SE;
    if (s && w) mask |= Neighbour.SW;
    if (w && n) mask |= Neighbour.NW;

    frames.push(draw(role, mask, palette, style, variant));
  }
  return frames;
}

/** A single tile for a role with no edge behaviour: props, signs, doors, warps. */
export function drawPlain(
  role: string,
  palette: Palette,
  style: StyleProfile,
  variant = 0,
): Raster {
  const ALL =
    Neighbour.N |
    Neighbour.NE |
    Neighbour.E |
    Neighbour.SE |
    Neighbour.S |
    Neighbour.SW |
    Neighbour.W |
    Neighbour.NW;
  return draw(role, ALL, palette, style, variant);
}
