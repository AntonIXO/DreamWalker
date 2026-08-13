/**
 * Where a thing may stand, and whether anyone can get to it.
 *
 * `doors.ts` is the same idea for doors, and the shape here is deliberately its twin: a
 * settle pass, a reachability test, an overlap test, all structural so the CLI and the
 * browser can call the same functions on the same data.
 *
 * The flood fill is the part `doors.ts` never needed. Every room in the dream today is an
 * empty 20×11 box, so "a chair in a sealed closet" is not expressible. The moment a floor
 * has interior walls it becomes the first bug an author writes, and it is invisible in a
 * text editor — the ASCII looks fine, the room just has a corner nothing can reach.
 *
 * 4-connectivity is not an approximation here, it is the right model: movement is
 * resolved one axis at a time (`roomWalk.ts`), so a gap open only on the diagonal really
 * is impassable to a 9×7 body, and a 4-way fill correctly refuses it.
 *
 * Must stay free of DOM *and* node APIs.
 */

import { rectsOverlap, type TileRect } from "./rect";
import { makeRng } from "./rng";
import {
  cellAt,
  isWalkableCell,
  rectBlocks,
  type CellGrid,
  type Direction,
  type SolidRect,
} from "./roomGrid";

/** Somewhere a thing may be seated. Position is in tiles. */
export interface PlacementSlot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** The side the sanitar stands on to reach it. Null means any side will do. */
  readonly facing?: Direction | null;
}

/**
 * Anything with a walk mask, things standing on it, and ways in.
 *
 * Structural rather than nominal so a `DreamRoom` (author time) and a `RoomState`
 * (runtime, a superset) both satisfy it without either importing the other.
 */
export interface PlacementHost extends CellGrid {
  readonly props: readonly SolidRect[];
  readonly doors: readonly TileRect[];
  readonly entries: readonly { readonly x: number; readonly y: number }[];
}

const STEP: Record<Direction, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

const SIDES = ["n", "e", "s", "w"] as const;

/** The tile the sanitar occupies to reach something at `at` from side `facing`. */
export function approachTile(
  at: { x: number; y: number },
  facing: Direction,
): { x: number; y: number } {
  const step = STEP[facing];
  return { x: Math.floor(at.x) + step.x, y: Math.floor(at.y) + step.y };
}

/** A tile a walker can occupy: walkable mask, and no solid thing sitting on it. */
export function standable(
  host: PlacementHost,
  tx: number,
  ty: number,
): boolean {
  if (!isWalkableCell(cellAt(host, tx, ty))) return false;
  return !rectBlocks(host.props, tx, ty);
}

const key = (host: CellGrid, x: number, y: number): number =>
  y * host.width + x;

/**
 * Connected components of standable tiles, 4-way.
 *
 * Returns one entry per tile: a region index, or −1 where nothing can stand. Callers
 * that only care about "can I get there from the door" want `entryRegion` instead.
 */
export function walkableRegions(host: PlacementHost): Int32Array {
  const regions = new Int32Array(host.width * host.height).fill(-1);
  let next = 0;
  const queue: number[] = [];
  for (let y = 0; y < host.height; y++) {
    for (let x = 0; x < host.width; x++) {
      const start = key(host, x, y);
      if (regions[start] !== -1 || !standable(host, x, y)) continue;
      const region = next++;
      regions[start] = region;
      queue.length = 0;
      queue.push(start);
      while (queue.length > 0) {
        const at = queue.pop()!;
        const ax = at % host.width;
        const ay = (at - ax) / host.width;
        for (const side of SIDES) {
          const step = STEP[side];
          const nx = ax + step.x;
          const ny = ay + step.y;
          if (nx < 0 || ny < 0 || nx >= host.width || ny >= host.height)
            continue;
          const nk = key(host, nx, ny);
          if (regions[nk] !== -1 || !standable(host, nx, ny)) continue;
          regions[nk] = region;
          queue.push(nk);
        }
      }
    }
  }
  return regions;
}

/**
 * Every tile actually reachable from an entry, as tile keys.
 *
 * This is the set that matters: a room may have several standable pockets and only one of
 * them is the room. Anything an author puts in the others is furniture in a photograph.
 */
export function entryRegion(host: PlacementHost): Set<number> {
  const regions = walkableRegions(host);
  const live = new Set<number>();
  for (const entry of host.entries) {
    const region = regions[key(host, Math.floor(entry.x), Math.floor(entry.y))];
    if (region !== undefined && region !== -1) live.add(region);
  }
  const tiles = new Set<number>();
  for (let i = 0; i < regions.length; i++) {
    if (live.has(regions[i]!)) tiles.add(i);
  }
  return tiles;
}

function inRegion(
  host: PlacementHost,
  region: ReadonlySet<number> | null,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= host.width || y >= host.height) return false;
  return region === null || region.has(key(host, x, y));
}

/**
 * Whether the sanitar can stand somewhere and reach this rect.
 *
 * `facing` is honoured when the author stated one; otherwise every side is tried, which
 * is what the walker can actually do.
 */
export function rectIsReachable(
  host: PlacementHost,
  rect: TileRect,
  facing?: Direction | null,
  region: ReadonlySet<number> | null = null,
): boolean {
  const sides = facing ? [facing] : SIDES;
  for (const side of sides) {
    const step = STEP[side];
    const spanX = step.x === 0 ? Math.max(1, rect.w) : 1;
    const spanY = step.y === 0 ? Math.max(1, rect.h) : 1;
    const baseX =
      step.x > 0 ? rect.x + rect.w : step.x < 0 ? rect.x - 1 : rect.x;
    const baseY =
      step.y > 0 ? rect.y + rect.h : step.y < 0 ? rect.y - 1 : rect.y;
    for (let dy = 0; dy < spanY; dy++) {
      for (let dx = 0; dx < spanX; dx++) {
        const x = baseX + dx;
        const y = baseY + dy;
        if (standable(host, x, y) && inRegion(host, region, x, y)) return true;
      }
    }
  }
  return false;
}

/**
 * Whether a slot can hold something that *stands* — a figure, or a clue on the floor.
 *
 * Different question from `rectIsReachable`: the occupant is on the tile, so the tile
 * itself has to be standable and part of the room proper.
 */
export function slotIsUsable(
  host: PlacementHost,
  slot: PlacementSlot,
  region: ReadonlySet<number> | null = null,
): boolean {
  const x = Math.floor(slot.x);
  const y = Math.floor(slot.y);
  if (!standable(host, x, y) || !inRegion(host, region, x, y)) return false;
  if (!slot.facing) return true;
  const at = approachTile(slot, slot.facing);
  return standable(host, at.x, at.y) && inRegion(host, region, at.x, at.y);
}

/** Pairs of solid things sitting on each other. The author wants to know; the room does not. */
export function overlappingProps(
  props: readonly (SolidRect & { id: string })[],
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      const a = props[i]!;
      const b = props[j]!;
      if (!a.solid && !b.solid) continue;
      if (rectsOverlap(a, b)) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

function propFits(
  host: PlacementHost,
  rect: TileRect & { solid: boolean },
  claimed: readonly SolidRect[],
  region: ReadonlySet<number>,
): boolean {
  if (rect.x < 0 || rect.y < 0) return false;
  if (rect.x + rect.w > host.width || rect.y + rect.h > host.height)
    return false;
  for (const door of host.doors) if (rectsOverlap(rect, door)) return false;
  for (const entry of host.entries) {
    const x = Math.floor(entry.x);
    const y = Math.floor(entry.y);
    if (
      x >= rect.x &&
      x < rect.x + rect.w &&
      y >= rect.y &&
      y < rect.y + rect.h
    ) {
      return false;
    }
  }
  for (const other of claimed) {
    if (!other.solid && !rect.solid) continue;
    if (rectsOverlap(rect, other)) return false;
  }
  return rectIsReachable(host, rect, null, region);
}

/**
 * Put a thing somewhere legal, preferring exactly where the author put it.
 *
 * The order matters and is the lesson `settleDoor` learned the hard way: try the authored
 * position first and return it untouched if it works. The scan is a repair, and a repair
 * that runs on healthy input is just a way to lose an author's work.
 */
export function settleObject<T extends SolidRect & { id: string }>(
  host: PlacementHost,
  prop: T,
  claimed: readonly SolidRect[],
  region: ReadonlySet<number> = entryRegion(host),
): T {
  const others = claimed.filter((other) => other !== prop);
  if (propFits(host, prop, others, region)) return prop;

  for (let y = 0; y + prop.h <= host.height; y++) {
    for (let x = 0; x + prop.w <= host.width; x++) {
      const candidate = { ...prop, x, y };
      if (propFits(host, candidate, others, region)) return candidate;
    }
  }
  return prop;
}

/** Slots nothing has claimed yet that something could actually use. */
export function freeSlots<T extends PlacementSlot>(
  host: PlacementHost,
  slots: readonly T[],
  taken: ReadonlySet<string>,
  region: ReadonlySet<number> = entryRegion(host),
): T[] {
  return slots.filter(
    (slot) => !taken.has(slot.id) && slotIsUsable(host, slot, region),
  );
}

/**
 * One free slot, chosen the same way every run for the same seed.
 *
 * Randomness at author time is a reroll knob and randomness at runtime has to be
 * reproducible, so this is seeded rather than `Math.random`.
 */
export function pickSlot<T extends PlacementSlot>(
  host: PlacementHost,
  slots: readonly T[],
  taken: ReadonlySet<string>,
  seed: string,
  region?: ReadonlySet<number>,
): T | null {
  const free = freeSlots(host, slots, taken, region);
  return free.length === 0 ? null : makeRng(seed).pick(free);
}
