/**
 * Cells become country.
 *
 * This replaces the dungeon tiler. The lattice underneath is the same one `layout.ts`
 * produces — and that code is untouched, because placing mission nodes two cells apart and
 * routing between them with A* is a good algorithm whatever gets drawn on top. What
 * changed is everything above it: instead of carving rooms out of solid rock and finding
 * the walls, the world is *built up in layers*, each one subordinate to the one before:
 *
 *   1. a walkable mask — where the player may go, from hubs and route bands
 *   2. elevation — two levels, flattened along routes so the way through stays easy
 *   3. water — lakes and their shores, never across the only way past
 *   4. biome — what the ground is made of, taken from the region's tag
 *   5. tall grass — patches inside the band, kept off the path so the road stays legible
 *   6. the tree line — grown outward from the walkable mask, with gaps only where routes
 *      leave. Constant thickness and a smooth silhouette are what make a border read as
 *      drawn rather than as noise, and this is where nearly all of the "Pokémon" comes from
 *   7. ledges and gates — the drops and doors the mission graph asked for
 *   8. towns — buildings, their doors, and the interiors those doors lead to
 *
 * The ordering is the design. Every layer may only take away from what the layer above it
 * guaranteed, never add, which is what keeps the world crossable without a solver (§2).
 */

import {
  NodeType,
  decodeTiles,
  encodeTiles,
  type Door,
  type DreamMap,
  type MissionGraph,
  type Room,
  type Warp,
} from "../../../src/shared/dream";
import {
  Tile,
  doorTile,
  isDoorTile,
  isFloorTile,
  isLedgeTile,
} from "../../../src/shared/tilecodes";
import { DOOR_SPAN } from "../../../src/shared/doors";
import { DIRS, type Dir, type Layout, type LayoutCell } from "./layout";
import { classifyRegions, nameFor, RegionKind, type Region } from "./regions";
import type { Rng } from "./rng";

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/**
 * A hub is a place you stand around in, so it is about a screen wide. A lane is a stretch
 * of road, so it is long enough to feel like travel and no longer — §6's map is meant to
 * be crossed several times a cycle, and a world that is mostly walking is a world where
 * the heartbeat never catches you anywhere interesting.
 *
 * The height is not a taste decision. A town has to fit a building *clear of both route
 * bands*: nine tiles of road, a padded margin either side, and a five-row house with a
 * tile of standing room in front of its door. Twenty-one was not enough, so every building
 * was silently rejected — giving towns with no doors and a world with no interiors, which
 * the reachability check could not catch because nothing was unreachable; there was simply
 * nothing there.
 */
export const HUB_W = 29;
export const HUB_H = 25;
export const LANE_W = 15;
export const LANE_H = 13;

/**
 * How wide a route is. Wide enough to have edges and nooks, not a corridor.
 *
 * Taken from `shared/doors.ts` rather than declared here, because a gate has to span the
 * road exactly — the two numbers were never independent, and keeping them in one place is
 * what stops a widened road from growing a gate that only covers part of it.
 */
const BAND = DOOR_SPAN;
const HALF_BAND = (BAND - 1) / 2;

/** How thick the tree line is. Constant, because a varying border reads as an accident. */
const BORDER = 3;

export const TILE_SIZE = 16;

/** Interiors sit below the world with a gap, so nothing bleeds between them. */
const INTERIOR_GUTTER = 4;
const INTERIOR_W = 13;
const INTERIOR_H = 11;

export const columnWidth = (cx: number): number =>
  cx % 2 === 0 ? HUB_W : LANE_W;
export const rowHeight = (cy: number): number =>
  cy % 2 === 0 ? HUB_H : LANE_H;

/**
 * Tile origins for every cell column and row, as running totals. Built once per layout so
 * nothing has to re-derive where a cell starts.
 */
export class CellMetrics {
  private readonly colX: number[] = [];
  private readonly rowY: number[] = [];
  readonly totalWidth: number;
  readonly totalHeight: number;

  constructor(
    readonly widthCells: number,
    readonly heightCells: number,
  ) {
    let x = 0;
    for (let cx = 0; cx < widthCells; cx++) {
      this.colX.push(x);
      x += columnWidth(cx);
    }
    this.totalWidth = x;

    let y = 0;
    for (let cy = 0; cy < heightCells; cy++) {
      this.rowY.push(y);
      y += rowHeight(cy);
    }
    this.totalHeight = y;
  }

  origin(cx: number, cy: number): { ox: number; oy: number } {
    return { ox: this.colX[cx] ?? 0, oy: this.rowY[cy] ?? 0 };
  }

  size(cx: number, cy: number): { w: number; h: number } {
    return { w: columnWidth(cx), h: rowHeight(cy) };
  }

  rect(cx: number, cy: number): { x: number; y: number; w: number; h: number } {
    const { ox, oy } = this.origin(cx, cy);
    const { w, h } = this.size(cx, cy);
    return { x: ox, y: oy, w, h };
  }
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

class World {
  readonly tiles: Uint8Array;
  /** Layer 1. True where the player is allowed to be. Everything else defers to it. */
  readonly walkable: Uint8Array;
  /** Layer 2. Small integers; a change between neighbours is a cliff. */
  readonly height: Uint8Array;

  constructor(
    readonly width: number,
    readonly h: number,
  ) {
    this.tiles = new Uint8Array(width * h).fill(Tile.VOID);
    this.walkable = new Uint8Array(width * h);
    this.height = new Uint8Array(width * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.tiles[y * this.width + x]! : Tile.VOID;
  }

  set(x: number, y: number, tile: number): void {
    if (this.inside(x, y)) this.tiles[y * this.width + x] = tile;
  }

  walk(x: number, y: number, open = true): void {
    if (this.inside(x, y)) this.walkable[y * this.width + x] = open ? 1 : 0;
  }

  isWalkable(x: number, y: number): boolean {
    return this.inside(x, y) && this.walkable[y * this.width + x] === 1;
  }

  fill(x0: number, y0: number, x1: number, y1: number, tile: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) this.set(x, y, tile);
  }

  open(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) this.walk(x, y);
  }
}

// ---------------------------------------------------------------------------
// Layer 1 — the walkable mask
// ---------------------------------------------------------------------------

/** Where a route crosses a cell boundary, in cell-local coordinates. */
function bandSpan(
  dir: Dir,
  w: number,
  h: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const midX = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  switch (dir) {
    case "n":
      return { x0: midX - HALF_BAND, y0: 0, x1: midX + HALF_BAND, y1: midY };
    case "s":
      return {
        x0: midX - HALF_BAND,
        y0: midY,
        x1: midX + HALF_BAND,
        y1: h - 1,
      };
    case "w":
      return { x0: 0, y0: midY - HALF_BAND, x1: midX, y1: midY + HALF_BAND };
    case "e":
      return {
        x0: midX,
        y0: midY - HALF_BAND,
        x1: w - 1,
        y1: midY + HALF_BAND,
      };
  }
}

/** The tiles of a route's mouth in one wall of a cell, in cell-local coordinates. */
function mouthTiles(
  dir: Dir,
  w: number,
  h: number,
): Array<{ x: number; y: number }> {
  const midX = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = -HALF_BAND; i <= HALF_BAND; i++) {
    switch (dir) {
      case "n":
        out.push({ x: midX + i, y: 0 });
        break;
      case "s":
        out.push({ x: midX + i, y: h - 1 });
        break;
      case "w":
        out.push({ x: 0, y: midY + i });
        break;
      case "e":
        out.push({ x: w - 1, y: midY + i });
        break;
    }
  }
  return out;
}

function openCell(
  world: World,
  cell: LayoutCell,
  metrics: CellMetrics,
  region: Region | null,
): void {
  const { ox, oy } = metrics.origin(cell.cx, cell.cy);
  const { w, h } = metrics.size(cell.cx, cell.cy);

  if (cell.kind === "room") {
    // Inset by the border thickness, so the tree line has somewhere to grow that is not
    // the neighbouring cell. A town gets a slightly wider clearing than a field.
    const inset = region?.kind === RegionKind.TOWN ? 2 : BORDER - 1;
    world.open(ox + inset, oy + inset, ox + w - 1 - inset, oy + h - 1 - inset);
  } else {
    // A route cell is the union of a band toward each side it opens onto: two make a
    // stretch of road, three or four make a junction.
    const midX = Math.floor(w / 2);
    const midY = Math.floor(h / 2);
    for (const dir of cell.connections) {
      const span = bandSpan(dir, w, h);
      world.open(ox + span.x0, oy + span.y0, ox + span.x1, oy + span.y1);
    }
    world.open(
      ox + midX - HALF_BAND,
      oy + midY - HALF_BAND,
      ox + midX + HALF_BAND,
      oy + midY + HALF_BAND,
    );
  }

  // Every side this cell connects through has to be open at the seam itself, or the two
  // halves of a route would meet a wall in the middle.
  for (const dir of cell.connections) {
    for (const local of mouthTiles(dir, w, h)) {
      world.walk(ox + local.x, oy + local.y);
      // And one tile past it, into the cell, so the mouth is never a single-tile pinch.
      const { dx, dy } = DIRS[dir];
      world.walk(ox + local.x - dx, oy + local.y - dy);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — elevation
// ---------------------------------------------------------------------------

/**
 * Two levels, assigned per hub and flattened along every route.
 *
 * Per hub rather than per tile because a cliff has to be something you can see the shape
 * of; noise at tile resolution makes gravel, not terrain. Routes stay flat so that height
 * never blocks the way through — the drops it creates are shortcuts and scenery, and the
 * mission graph remains the only thing that gates anything.
 */
function raiseGround(
  world: World,
  layout: Layout,
  metrics: CellMetrics,
  rng: Rng,
): void {
  for (const cell of layout.cells) {
    if (cell.kind !== "room") continue;
    if (!rng.chance(0.35)) continue;

    const { x, y, w, h } = metrics.rect(cell.cx, cell.cy);
    // A raised shelf against one edge of the hub, not the whole thing: a plateau you can
    // walk around is a place, a plateau you cannot is a wall.
    const vertical = rng.chance(0.5);
    const depth = Math.floor((vertical ? h : w) * 0.4);
    const far = rng.chance(0.5);

    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const within = vertical
          ? far
            ? ty >= y + h - depth
            : ty < y + depth
          : far
            ? tx >= x + w - depth
            : tx < x + depth;
        if (within && world.isWalkable(tx, ty)) {
          world.height[ty * world.width + tx] = 1;
        }
      }
    }
  }

  flattenRoutes(world, layout, metrics);
}

/**
 * Press the ground flat along every route.
 *
 * Without this the world walls itself off, and did: a raised shelf spans the full width of
 * its hub, so the cliff face along its edge is a solid line, and half the time that line
 * lies straight across the road out. The reachability check in `commands/layout.ts` caught
 * it rejecting fourteen of fifteen regions — invisible in a preview, fatal in play.
 *
 * The rule this encodes is worth stating plainly: **height is scenery, never a gate.**
 * Everything that gates anything in this world comes from the mission graph, and terrain
 * is only allowed to make the way through longer or prettier (§6).
 */
function flattenRoutes(
  world: World,
  layout: Layout,
  metrics: CellMetrics,
): void {
  for (const cell of layout.cells) {
    const { x, y, w, h } = metrics.rect(cell.cx, cell.cy);
    const midX = x + Math.floor(w / 2);
    const midY = y + Math.floor(h / 2);

    const flatten = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (world.inside(tx, ty)) world.height[ty * world.width + tx] = 0;
        }
      }
    };

    // The junction at the centre, and a band out to every side this cell opens onto —
    // one tile wider than the road itself, so the cliff face beside it never quite
    // reaches the ground you walk on.
    const pad = HALF_BAND + 1;
    flatten(midX - pad, midY - pad, midX + pad, midY + pad);

    for (const dir of cell.connections) {
      const { dx, dy } = DIRS[dir];
      if (dx !== 0) {
        const from = dx > 0 ? midX : x;
        const to = dx > 0 ? x + w - 1 : midX;
        flatten(from, midY - pad, to, midY + pad);
      } else {
        const from = dy > 0 ? midY : y;
        const to = dy > 0 ? y + h - 1 : midY;
        flatten(midX - pad, from, midX + pad, to);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layers 3–5 — ground cover
// ---------------------------------------------------------------------------

interface BiomeGround {
  base: number;
  patch: number;
  /** How much of the region is patch rather than base. */
  patchDensity: number;
  /** Chance a hub gets standing water. */
  water: number;
}

const BIOMES: Record<string, BiomeGround> = {
  meadow: {
    base: Tile.GRASS,
    patch: Tile.FLOWERS,
    patchDensity: 0.05,
    water: 0.15,
  },
  wood: {
    base: Tile.GRASS,
    patch: Tile.GRASS_TALL,
    patchDensity: 0.3,
    water: 0.2,
  },
  marsh: {
    base: Tile.GRASS,
    patch: Tile.WATER,
    patchDensity: 0.12,
    water: 0.45,
  },
  ash: {
    base: Tile.SAND,
    patch: Tile.GRASS_TALL,
    patchDensity: 0.14,
    water: 0.05,
  },
};

const DEFAULT_GROUND: BiomeGround = BIOMES.meadow!;

/**
 * Lay the ground, then scatter what grows on it.
 *
 * Patches are blobs grown from a seed rather than per-tile noise, for the same reason the
 * elevation is per hub: scattered single tiles read as dirt on the screen, and a patch of
 * tall grass you can see the edge of reads as a place something might be hiding.
 */
function layGround(
  world: World,
  layout: Layout,
  metrics: CellMetrics,
  regions: Map<string, Region>,
  rng: Rng,
): void {
  for (let i = 0; i < world.tiles.length; i++) {
    if (world.walkable[i] === 1) world.tiles[i] = Tile.GRASS;
  }

  for (const cell of layout.cells) {
    const region = cell.nodeId ? regions.get(cell.nodeId) : null;
    const ground = BIOMES[region?.biome ?? ""] ?? DEFAULT_GROUND;
    const { x, y, w, h } = metrics.rect(cell.cx, cell.cy);

    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (world.isWalkable(tx, ty)) world.set(tx, ty, ground.base);
      }
    }

    // Towns are kept plain. People do not live in waist-high grass, and a settlement that
    // reads as tidy is what makes the country outside it read as not.
    if (region?.kind === RegionKind.TOWN) continue;

    const patches = Math.round((w * h * ground.patchDensity) / 24);
    for (let p = 0; p < patches; p++) {
      growBlob(
        world,
        rng.int(x + 2, x + w - 3),
        rng.int(y + 2, y + h - 3),
        rng.int(6, 22),
        ground.patch,
        rng,
      );
    }
  }
}

/** A random walk that only paints walkable ground. Cheap, and it never leaves the mask. */
function growBlob(
  world: World,
  startX: number,
  startY: number,
  size: number,
  tile: number,
  rng: Rng,
): void {
  let x = startX;
  let y = startY;
  for (let step = 0; step < size; step++) {
    if (world.isWalkable(x, y)) world.set(x, y, tile);
    const dir = rng.pick(["n", "e", "s", "w"] as Dir[]);
    x += DIRS[dir].dx;
    y += DIRS[dir].dy;
    if (!world.isWalkable(x, y)) {
      x = startX;
      y = startY;
    }
  }
}

/**
 * Standing water in some hubs.
 *
 * Water is the one ground cover that takes walkability away, so it is the one that has to
 * be careful. It is only ever placed away from a hub's centre and never over a route
 * mouth, and the mask is updated so that every later layer — the tree line especially —
 * sees a lake as an edge of the walkable world.
 */
function pourWater(
  world: World,
  layout: Layout,
  metrics: CellMetrics,
  regions: Map<string, Region>,
  rng: Rng,
): void {
  for (const cell of layout.cells) {
    if (cell.kind !== "room" || !cell.nodeId) continue;
    const region = regions.get(cell.nodeId);
    if (!region || region.kind === RegionKind.TOWN || region.isStart) continue;

    const ground = BIOMES[region.biome] ?? DEFAULT_GROUND;
    const chance = region.kind === RegionKind.LANDMARK ? 0.6 : ground.water;
    if (!rng.chance(chance)) continue;

    const { x, y, w, h } = metrics.rect(cell.cx, cell.cy);
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);

    // A lobe in one corner. Never the middle: the middle is where every route mouth aims,
    // and a lake there would cut the hub in half.
    const ox = rng.chance(0.5) ? x + 3 : x + w - 4;
    const oy = rng.chance(0.5) ? y + 3 : y + h - 4;
    const radius = rng.int(3, 5);

    for (let ty = oy - radius; ty <= oy + radius; ty++) {
      for (let tx = ox - radius; tx <= ox + radius; tx++) {
        const d = Math.hypot(tx - ox, ty - oy);
        if (d > radius) continue;
        // Leave a clear lane between the lake and the centre of the hub.
        if (Math.abs(tx - cx) <= HALF_BAND && Math.abs(ty - cy) <= HALF_BAND)
          continue;
        if (!world.isWalkable(tx, ty)) continue;
        world.set(tx, ty, d < radius - 1.5 ? Tile.WATER_DEEP : Tile.WATER);
        world.walk(tx, ty, false);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 6 — the tree line
// ---------------------------------------------------------------------------

/**
 * Grow a border of trees outward from everything walkable.
 *
 * This is the layer that does the most for how the world reads, and it does it with two
 * rules: **constant thickness**, and **openings only where a route actually leaves**. A
 * border of varying depth looks like a generation artefact; one that is the same all the
 * way round looks like somebody drew the edge of the map. Every dungeon instinct here is
 * wrong — walls are found from what is *not* floor, whereas a treeline is grown from what
 * *is*, and the difference is what stops the world looking like a cave system with grass.
 */
function growTreeLine(world: World): void {
  let frontier: number[] = [];
  for (let i = 0; i < world.walkable.length; i++) {
    if (world.walkable[i] === 1) frontier.push(i);
  }

  const claimed = new Uint8Array(world.walkable);

  for (let ring = 0; ring < BORDER; ring++) {
    const next: number[] = [];
    for (const index of frontier) {
      const x = index % world.width;
      const y = Math.floor(index / world.width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!world.inside(nx, ny)) continue;
          const n = ny * world.width + nx;
          if (claimed[n] === 1) continue;
          claimed[n] = 1;
          // Water already occupies the edge of the walkable world in places; a tree in a
          // lake is the one thing this rule must not produce.
          if (
            world.tiles[n] !== Tile.WATER &&
            world.tiles[n] !== Tile.WATER_DEEP
          ) {
            world.tiles[n] = Tile.TREE;
          }
          next.push(n);
        }
      }
    }
    frontier = next;
  }
}

/**
 * Light the top row of every stand of trees.
 *
 * Only the top, and only once. Lighting alternate rows — which is what happens if you ask
 * "is there a trunk above me and grass below me" instead of "am I the top" — turns a wood
 * into corrugated iron, and that is exactly how the first version of this looked.
 *
 * Runs last, after the backdrop is filled, or it would cap rows that are about to have
 * more trees grown above them.
 */
function capCanopy(world: World): void {
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.get(x, y) !== Tile.TREE) continue;
      if (world.get(x, y - 1) !== Tile.TREE) world.set(x, y, Tile.TREE_CANOPY);
    }
  }
}

/**
 * Everything left over inside the world becomes more wood.
 *
 * Without this the gaps between cells are void, and void is drawn as nothing — so the
 * player sees black rectangles behind the treeline and the world reads as a set of
 * platforms floating in space. Filling them makes the map what a Gen-1 overworld actually
 * is: one continuous forest with clearings cut into it.
 *
 * Stops above the interior band, which is deliberately empty — nobody ever sees it.
 */
function fillBackdrop(world: World, until: number): void {
  for (let y = 0; y < Math.min(until, world.h); y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.get(x, y) === Tile.VOID) world.set(x, y, Tile.TREE);
    }
  }
}

/**
 * Cliffs, found after the trees so they only ever appear inside the world.
 *
 * A tile is a cliff top when the ground one row below it is lower; the tile below becomes
 * the face you can see. Only the south-facing case is drawn, because a top-down world only
 * has one direction where a height change is visible, and pretending otherwise is what
 * makes generated terrain look wrong.
 */
function cutCliffs(world: World): void {
  for (let y = 0; y < world.h - 1; y++) {
    for (let x = 0; x < world.width; x++) {
      const here = world.height[y * world.width + x]!;
      const below = world.height[(y + 1) * world.width + x]!;
      if (here <= below) continue;
      if (!world.isWalkable(x, y)) continue;

      world.set(x, y, Tile.CLIFF);
      if (world.isWalkable(x, y + 1)) {
        world.set(x, y + 1, Tile.CLIFF_FACE);
        world.walk(x, y + 1, false);
      }
    }
  }
}

/**
 * Ledges: the one-way drops that shape a Pokémon route without ever refusing anybody.
 *
 * Placed on the walkable row just below a cliff face, so the player can hop down and then
 * has to walk the long way round to get back. Directed, and recorded as such, so the
 * reachability check downstream knows the way back is not the way you came.
 */
function placeLedges(world: World, rng: Rng): number {
  let placed = 0;
  for (let y = 1; y < world.h - 2; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      if (world.get(x, y) !== Tile.CLIFF_FACE) continue;
      const under = world.get(x, y + 1);
      if (under !== Tile.GRASS && under !== Tile.SAND) continue;
      // Sparse: a route lined with ledges is a corridor with extra steps.
      if (!rng.chance(0.4)) continue;
      world.set(x, y + 1, Tile.LEDGE_S);
      placed++;
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Layer 7 — gates
// ---------------------------------------------------------------------------

function placeDoors(
  world: World,
  layout: Layout,
  graph: MissionGraph,
  metrics: CellMetrics,
): Door[] {
  const doors: Door[] = [];

  for (const route of layout.routes) {
    const edge = graph.edges.find((e) => e.id === route.edgeId);
    if (!edge) continue;
    // An open edge is just a road. Only a gate needs anything drawn.
    if (edge.door === "open") continue;

    const cell = layout.nodeCells.get(route.doorRoomId);
    if (!cell) continue;
    const { ox, oy } = metrics.origin(cell.cx, cell.cy);
    const { w, h } = metrics.size(cell.cx, cell.cy);
    const locals = mouthTiles(route.doorSide, w, h);
    const tile = doorTile(edge.door);

    for (const local of locals) world.set(ox + local.x, oy + local.y, tile);

    const centre = locals[HALF_BAND]!;
    doors.push({
      id: `door_${edge.id}`,
      type: edge.door,
      x: ox + centre.x,
      y: oy + centre.y,
      orientation: route.doorSide === "n" || route.doorSide === "s" ? "h" : "v",
      fromRoomId: route.doorRoomId,
      toRoomId: route.otherRoomId,
      keyId: edge.keyId,
      edgeId: edge.id,
    });
  }

  return doors;
}

// ---------------------------------------------------------------------------
// Layer 8 — towns
// ---------------------------------------------------------------------------

interface Township {
  warps: Warp[];
  interiors: Room[];
}

/**
 * Buildings, and the rooms behind their doors.
 *
 * An interior is placed in a reserved band below the world rather than in a separate map,
 * so the whole dream stays one tile array (see `Warp` in `shared/dream.ts`). Buildings are
 * what make a town a town: without somewhere to go inside, a settlement is a clearing with
 * decorations, and every figure in it is standing in a field.
 */
function raiseTowns(
  world: World,
  layout: Layout,
  metrics: CellMetrics,
  regions: Map<string, Region>,
  interiorTop: number,
  rng: Rng,
): Township {
  const warps: Warp[] = [];
  const interiors: Room[] = [];

  let slot = 0;
  const nextInterior = (): { x: number; y: number } => {
    const perRow = Math.max(1, Math.floor(world.width / (INTERIOR_W + 2)));
    const x = (slot % perRow) * (INTERIOR_W + 2) + 1;
    const y = interiorTop + Math.floor(slot / perRow) * (INTERIOR_H + 2);
    slot++;
    return { x, y };
  };

  for (const cell of layout.cells) {
    if (cell.kind !== "room" || !cell.nodeId) continue;
    const region = regions.get(cell.nodeId);
    if (!region || region.kind !== RegionKind.TOWN) continue;

    const { x, y, w, h } = metrics.rect(cell.cx, cell.cy);
    const midX = x + Math.floor(w / 2);
    const midY = y + Math.floor(h / 2);

    for (let b = 0; b < region.buildings; b++) {
      const bw = rng.int(5, 7);
      const bh = 4;

      // Both route bands are off limits, not just the horizontal one. A town's mouths aim
      // at its centre from all four sides, so a building that merely avoids the row still
      // has a one-in-two chance of sitting squarely across the road going south — which is
      // exactly what happened, and it walls the dream off from everything beyond.
      const west = rng.chance(0.5);
      const bx = west
        ? rng.int(x + 3, Math.max(x + 3, midX - HALF_BAND - bw - 1))
        : rng.int(
            Math.min(midX + HALF_BAND + 1, x + w - bw - 3),
            x + w - bw - 3,
          );
      const above = rng.chance(0.5);
      const by = above ? midY - HALF_BAND - bh - 1 : midY + HALF_BAND + 2;

      // The door needs a tile of clear ground in front of it, and the footprint must not
      // have drifted back over a band after clamping.
      if (bx + bw > midX - HALF_BAND && bx < midX + HALF_BAND + 1) continue;
      if (!fits(world, bx, by, bw, bh + 1)) continue;

      world.fill(bx, by, bx + bw - 1, by + bh - 2, Tile.BUILDING_ROOF);
      world.fill(bx, by + bh - 1, bx + bw - 1, by + bh - 1, Tile.BUILDING_WALL);
      for (let ty = by; ty < by + bh; ty++) {
        for (let tx = bx; tx < bx + bw; tx++) world.walk(tx, ty, false);
      }

      // The door is on the front, and the tile in front of it is kept clear so the player
      // can always reach it however the ground came out.
      const doorX = bx + Math.floor(bw / 2);
      const doorY = by + bh - 1;
      world.set(doorX, doorY, Tile.WARP);
      world.walk(doorX, doorY);
      world.set(doorX, doorY + 1, Tile.PATH);
      world.walk(doorX, doorY + 1);

      const spot = nextInterior();
      const id = `${cell.nodeId}_in${b}`;
      carveInterior(world, spot.x, spot.y);
      interiors.push({
        id,
        kind: "room",
        nodeType: null,
        region: RegionKind.INTERIOR,
        biome: region.biome,
        accessLevel: 0,
        name: "Дом",
        rect: { x: spot.x, y: spot.y, w: INTERIOR_W, h: INTERIOR_H },
        cell: { cx: cell.cx, cy: cell.cy },
      });

      const insideX = spot.x + Math.floor(INTERIOR_W / 2);
      const insideY = spot.y + INTERIOR_H - 2;
      world.set(insideX, insideY + 1, Tile.WARP);
      world.walk(insideX, insideY + 1);

      warps.push({
        id: `warp_${id}_in`,
        x: doorX,
        y: doorY,
        toX: insideX,
        toY: insideY,
        toRoomId: id,
      });
      warps.push({
        id: `warp_${id}_out`,
        x: insideX,
        y: insideY + 1,
        toX: doorX,
        toY: doorY + 1,
        toRoomId: cell.nodeId,
      });
    }
  }

  return { warps, interiors };
}

function fits(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!world.isWalkable(tx, ty)) return false;
    }
  }
  return true;
}

/** One room, four walls. The old dungeon vocabulary, used for what it was good at. */
function carveInterior(world: World, x: number, y: number): void {
  world.fill(x, y, x + INTERIOR_W - 1, y + INTERIOR_H - 1, Tile.WALL);
  for (let ty = y + 1; ty < y + INTERIOR_H - 1; ty++) {
    for (let tx = x + 1; tx < x + INTERIOR_W - 1; tx++) {
      world.set(tx, ty, Tile.FLOOR);
      world.walk(tx, ty);
    }
  }
  for (let tx = x; tx < x + INTERIOR_W; tx++) {
    world.set(tx, y + INTERIOR_H - 2, Tile.WALL_FACE);
  }
  for (let tx = x + 1; tx < x + INTERIOR_W - 1; tx++) {
    world.set(tx, y + INTERIOR_H - 2, Tile.FLOOR);
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Worn dirt down the middle of every route and across every hub.
 *
 * Not decoration: it is the only thing on screen that says which way the world expects you
 * to go. A route without one is a field, and a player in a field has no idea they are on
 * the critical path.
 */
function wearPaths(world: World, layout: Layout, metrics: CellMetrics): void {
  const stamp = (x: number, y: number): void => {
    if (!world.isWalkable(x, y)) return;
    const tile = world.get(x, y);
    if (tile === Tile.GRASS || tile === Tile.SAND || tile === Tile.GRASS_TALL) {
      world.set(x, y, Tile.PATH);
    }
  };

  for (const cell of layout.cells) {
    const { x, y, w, h } = metrics.rect(cell.cx, cell.cy);
    const midX = x + Math.floor(w / 2);
    const midY = y + Math.floor(h / 2);

    for (const dir of cell.connections) {
      const { dx, dy } = DIRS[dir];
      // From the centre of the cell out to the edge it connects through, two tiles wide so
      // the road survives a tile of tall grass growing over it.
      const steps = dx !== 0 ? Math.floor(w / 2) : Math.floor(h / 2);
      for (let i = 0; i <= steps; i++) {
        stamp(midX + dx * i, midY + dy * i);
        stamp(
          midX + dx * i + (dx !== 0 ? 0 : 1),
          midY + dy * i + (dy !== 0 ? 0 : 1),
        );
      }
    }
    stamp(midX, midY);
    stamp(midX + 1, midY);
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function buildRooms(
  layout: Layout,
  graph: MissionGraph,
  metrics: CellMetrics,
  regions: Map<string, Region>,
): Room[] {
  const counters = new Map<string, number>();
  const rooms: Room[] = [];

  for (const cell of layout.cells) {
    const rect = metrics.rect(cell.cx, cell.cy);

    if (cell.kind === "room" && cell.nodeId) {
      const node = graph.nodes.find((n) => n.id === cell.nodeId);
      const region = regions.get(cell.nodeId);
      rooms.push({
        id: cell.nodeId,
        kind: "room",
        nodeType: node?.type ?? NodeType.NORMAL,
        region: region?.kind ?? RegionKind.WILD,
        biome: region?.biome ?? "meadow",
        accessLevel: node?.accessLevel ?? 0,
        name: region ? nameFor(region, counters) : "Место",
        rect,
        cell: { cx: cell.cx, cy: cell.cy },
      });
    } else {
      rooms.push({
        id: `route_${cell.cx}_${cell.cy}`,
        kind: "connector",
        nodeType: null,
        region: "route",
        biome: "meadow",
        accessLevel: 0,
        name: "Дорога",
        rect,
        cell: { cx: cell.cx, cy: cell.cy },
      });
    }
  }

  return rooms;
}

export function buildOverworld(
  layout: Layout,
  graph: MissionGraph,
  rng: Rng,
): DreamMap {
  const regions = classifyRegions(graph);
  const metrics = new CellMetrics(layout.widthCells, layout.heightCells);

  // Room enough underneath for every building's interior, laid out in rows.
  const townCount = [...regions.values()].filter(
    (r) => r.kind === RegionKind.TOWN,
  ).length;
  const interiorRows = Math.ceil(
    (townCount * 3) /
      Math.max(1, Math.floor(metrics.totalWidth / (INTERIOR_W + 2))),
  );
  const interiorTop = metrics.totalHeight + INTERIOR_GUTTER;
  const height = interiorTop + interiorRows * (INTERIOR_H + 2) + 2;

  const world = new World(metrics.totalWidth, height);

  // 1 — where the player may be
  for (const cell of layout.cells) {
    openCell(
      world,
      cell,
      metrics,
      cell.nodeId ? (regions.get(cell.nodeId) ?? null) : null,
    );
  }

  // 2 — elevation
  raiseGround(world, layout, metrics, rng);

  // 3–5 — ground cover
  layGround(world, layout, metrics, regions, rng);
  pourWater(world, layout, metrics, regions, rng);
  wearPaths(world, layout, metrics);

  // 6 — the border, the wood behind it, then the height changes inside
  growTreeLine(world);
  fillBackdrop(world, metrics.totalHeight);
  capCanopy(world);
  cutCliffs(world);
  placeLedges(world, rng);

  // 7 — gates
  const doors = placeDoors(world, layout, graph, metrics);

  // 8 — towns and what is inside them
  const { warps, interiors } = raiseTowns(
    world,
    layout,
    metrics,
    regions,
    interiorTop,
    rng,
  );

  const rooms = [...buildRooms(layout, graph, metrics, regions), ...interiors];

  const startCell = layout.nodeCells.get(graph.startId);
  if (!startCell) throw new Error("layout has no cell for the start node");
  const startRect = metrics.rect(startCell.cx, startCell.cy);
  const spawn = {
    x: startRect.x + Math.floor(startRect.w / 2),
    y: startRect.y + Math.floor(startRect.h / 2),
  };
  // The sanitar has to land on something they can stand on, whatever the layers did.
  world.set(spawn.x, spawn.y, Tile.PATH);
  world.walk(spawn.x, spawn.y);

  return {
    tileSize: TILE_SIZE,
    width: world.width,
    height: world.h,
    tiles: encodeTiles(world.tiles),
    rooms,
    doors,
    warps,
    graph,
    spawn,
  };
}

export { HALF_BAND, BAND };

// ---------------------------------------------------------------------------
// Crossability
// ---------------------------------------------------------------------------

/**
 * Every region the sanitar can actually walk to from where they arrive.
 *
 * This is not the solvability solver §2 rules out, and the distinction matters. It does not
 * ask whether the dream can be *understood*; it asks whether the eight layers above, which
 * each take walkable ground away, have between them walled a place off by accident. A
 * building dropped across the only road south is a generator bug, not a difficulty
 * setting, and it is invisible in a preview — the map looks fine and the world is cut in
 * half. So it is checked, and a layout that fails is rerolled.
 *
 * Gates count as passable. A locked door is a delay, not a wall (§6), and the mission
 * graph's own key-before-lock invariant is what makes that true.
 */
export function reachableRegions(map: DreamMap): Set<string> {
  const tiles = decodeTiles(map.tiles, map.width * map.height);
  const seen = new Uint8Array(tiles.length);
  const stack = [map.spawn.y * map.width + map.spawn.x];
  seen[stack[0]!] = 1;

  const warpFrom = new Map<number, number>();
  for (const warp of map.warps) {
    warpFrom.set(warp.y * map.width + warp.x, warp.toY * map.width + warp.toX);
  }

  const passable = (index: number): boolean => {
    const tile = tiles[index]!;
    if (isFloorTile(tile)) return true;
    if (isDoorTile(tile)) return true;
    // A ledge is crossable, one way. Direction is a runtime question and irrelevant here:
    // this asks whether a place can be reached at all, and a ledge never stops that.
    return isLedgeTile(tile);
  };

  while (stack.length > 0) {
    const current = stack.pop()!;
    const x = current % map.width;
    const y = Math.floor(current / map.width);

    const push = (index: number): void => {
      if (seen[index] === 1 || !passable(index)) return;
      seen[index] = 1;
      stack.push(index);
    };

    if (x > 0) push(current - 1);
    if (x < map.width - 1) push(current + 1);
    if (y > 0) push(current - map.width);
    if (y < map.height - 1) push(current + map.width);

    const through = warpFrom.get(current);
    if (through !== undefined && seen[through] !== 1) {
      seen[through] = 1;
      stack.push(through);
    }
  }

  const reached = new Set<string>();
  for (const room of map.rooms) {
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
        if (seen[y * map.width + x] === 1) {
          reached.add(room.id);
          y = room.rect.y + room.rect.h;
          break;
        }
      }
    }
  }
  return reached;
}

/** Regions the mission expects to matter but the terrain has walled off. Empty is good. */
export function strandedRegions(map: DreamMap): string[] {
  const reached = reachableRegions(map);
  return map.rooms
    .filter((room) => room.kind === "room" && !reached.has(room.id))
    .map((room) => room.id);
}
