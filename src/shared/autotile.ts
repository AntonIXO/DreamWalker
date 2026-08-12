/**
 * Which shape of a terrain gets drawn where.
 *
 * A tilemap that stamps one square per terrain reads as a grid, because it is one. What
 * makes an outdoor map look drawn rather than generated is that terrains meet each other
 * in rounded, deliberate edges — a lake has a shore, a wood has a treeline, a path has
 * sides. That is autotiling, and it is entirely mechanical: look at the neighbours, turn
 * them into a number, use the number to pick a frame.
 *
 * Two schemes are enough for everything here:
 *
 *   **blob (47)** — eight neighbours, for organic terrain that needs inner and outer
 *   corners. The trick that makes it 47 rather than 256 is that a diagonal only counts
 *   when *both* of its adjacent cardinals also match; otherwise the corner is hidden
 *   behind an edge and cannot be seen, so the two cases are the same picture.
 *
 *   **edge (16)** — four neighbours, for things that are essentially lines: paths, and
 *   the fringe of a cliff. Corners do not arise, so there is nothing to collapse.
 *
 * This is derived from the neighbours at draw time rather than baked into the tile grid,
 * because the sleeper rewrites the grid while the player is in it (§6). A baked edge would
 * be correct exactly until the first heartbeat.
 */

import { Tile } from "./tilecodes";

export type AutotileKind = "blob" | "edge" | "plain";

export const BLOB_FRAMES = 47;
export const EDGE_FRAMES = 16;

/** How many frames a role needs, so the art pipeline knows what to bake. */
export function frameCount(kind: AutotileKind): number {
  switch (kind) {
    case "blob":
      return BLOB_FRAMES;
    case "edge":
      return EDGE_FRAMES;
    default:
      return 1;
  }
}

/**
 * Which scheme each role uses.
 *
 * Roles absent from here are `plain`: one frame, or a few picked by position hash. Most
 * dressing is plain — a crate has no relationship with the crate next to it.
 */
export const ROLE_AUTOTILE: Record<string, AutotileKind> = {
  grass: "blob",
  grassTall: "blob",
  sand: "blob",
  water: "blob",
  waterDeep: "blob",
  tree: "blob",
  cliff: "blob",
  path: "edge",
  cliffFace: "edge",
  floor: "blob",
  wall: "edge",
};

export function autotileOf(role: string): AutotileKind {
  return ROLE_AUTOTILE[role] ?? "plain";
}

// ---------------------------------------------------------------------------
// Terrain priority
// ---------------------------------------------------------------------------

/**
 * Which terrain wins where two meet.
 *
 * A tile counts as "the same" as its neighbour when the neighbour is the same terrain **or
 * something that sits on top of it**. Without this rule, grass under a tree would draw a
 * shoreline against the trunk, and every wood would be ringed by a halo of grass edges. It
 * is the standard fix and it is why the numbers below are ordered rather than arbitrary.
 */
const PRIORITY: Record<number, number> = {
  [Tile.WATER_DEEP]: 90,
  [Tile.WATER]: 80,
  [Tile.CLIFF_FACE]: 70,
  [Tile.TREE_CANOPY]: 65,
  [Tile.TREE]: 60,
  [Tile.BUILDING_WALL]: 58,
  [Tile.BUILDING_ROOF]: 58,
  [Tile.CLIFF]: 50,
  [Tile.PATH]: 40,
  [Tile.SAND]: 30,
  [Tile.GRASS_TALL]: 22,
  [Tile.FLOWERS]: 21,
  [Tile.GRASS]: 20,
  [Tile.WARP]: 15,
  [Tile.SIGN]: 15,
  [Tile.LEDGE_S]: 45,
  [Tile.LEDGE_E]: 45,
  [Tile.LEDGE_W]: 45,
  [Tile.FLOOR]: 20,
  [Tile.FLOOR_ALT]: 20,
  [Tile.THRESHOLD]: 25,
  [Tile.WALL]: 60,
  [Tile.WALL_FACE]: 60,
  [Tile.PROP]: 15,
  [Tile.PROP_SOLID]: 15,
  [Tile.VOID]: 0,
};

export function priorityOf(tile: number): number {
  return PRIORITY[tile] ?? 10;
}

/**
 * Whether `neighbour` should be treated as continuous with `self` for edging purposes.
 * Off-grid counts as continuous, so the world does not draw a shoreline against its own
 * border — the edge of the map is not a feature, it is the end of the data.
 */
export function joins(self: number, neighbour: number | null): boolean {
  if (neighbour === null) return true;
  if (neighbour === self) return true;
  return priorityOf(neighbour) >= priorityOf(self);
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/** Reads a neighbour, or null when off the grid. */
export type Sampler = (dx: number, dy: number) => number | null;

/**
 * The 256 eight-neighbour cases mapped onto 47 distinct pictures.
 *
 * Built once, by construction rather than by table: normalise every mask by dropping the
 * diagonal bits whose cardinals are not both set, then number the survivors in ascending
 * order. Ascending order matters — it is the layout the generated tileset is baked in, so
 * the two sides agree without sharing anything but this function.
 */
export const Neighbour = {
  N: 1,
  NE: 2,
  E: 4,
  SE: 8,
  S: 16,
  SW: 32,
  W: 64,
  NW: 128,
} as const;

const { BLOB_LOOKUP, BLOB_MASKS } = ((): {
  BLOB_LOOKUP: Uint8Array;
  BLOB_MASKS: number[];
} => {
  const { N, NE, E, SE, S, SW, W, NW } = Neighbour;

  const normalise = (mask: number): number => {
    let out = mask;
    if ((out & (N | E)) !== (N | E)) out &= ~NE;
    if ((out & (E | S)) !== (E | S)) out &= ~SE;
    if ((out & (S | W)) !== (S | W)) out &= ~SW;
    if ((out & (W | N)) !== (W | N)) out &= ~NW;
    return out;
  };

  const distinct = new Set<number>();
  for (let mask = 0; mask < 256; mask++) distinct.add(normalise(mask));

  const ordered = [...distinct].sort((a, b) => a - b);
  const index = new Map(ordered.map((mask, i) => [mask, i]));

  const table = new Uint8Array(256);
  for (let mask = 0; mask < 256; mask++) {
    table[mask] = index.get(normalise(mask))!;
  }
  return { BLOB_LOOKUP: table, BLOB_MASKS: ordered };
})();

/**
 * The neighbour mask a blob frame stands for — the inverse of `blobIndex`.
 *
 * The tileset generator needs it: to draw frame 23 it has to know which sides that frame
 * has neighbours on. Deriving it here rather than hand-authoring a layout is what keeps
 * the drawn set and the lookup in agreement without either knowing about the other.
 */
export function blobMaskFor(index: number): number {
  return BLOB_MASKS[index] ?? 0;
}

/** Frame index in 0..46 for an eight-neighbour terrain. */
export function blobIndex(self: number, sample: Sampler): number {
  const same = (dx: number, dy: number): boolean => joins(self, sample(dx, dy));

  let mask = 0;
  if (same(0, -1)) mask |= 1;
  if (same(1, -1)) mask |= 2;
  if (same(1, 0)) mask |= 4;
  if (same(1, 1)) mask |= 8;
  if (same(0, 1)) mask |= 16;
  if (same(-1, 1)) mask |= 32;
  if (same(-1, 0)) mask |= 64;
  if (same(-1, -1)) mask |= 128;

  return BLOB_LOOKUP[mask]!;
}

/** Frame index in 0..15 for a four-neighbour terrain. N=1, E=2, S=4, W=8. */
export function edgeIndex(self: number, sample: Sampler): number {
  let mask = 0;
  if (joins(self, sample(0, -1))) mask |= 1;
  if (joins(self, sample(1, 0))) mask |= 2;
  if (joins(self, sample(0, 1))) mask |= 4;
  if (joins(self, sample(-1, 0))) mask |= 8;
  return mask;
}

/**
 * The frame name a tile resolves to. The single point of agreement between what the art
 * pipeline bakes and what the renderer asks for — change it and both sides move together.
 */
export function frameName(role: string, index: number): string {
  return autotileOf(role) === "plain" ? role : `${role}_${index}`;
}

/** Every frame name a role needs, in the order the atlas lays them out. */
export function frameNamesFor(role: string): string[] {
  const kind = autotileOf(role);
  if (kind === "plain") return [role];
  return Array.from({ length: frameCount(kind) }, (_, i) => frameName(role, i));
}
