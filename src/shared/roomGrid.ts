/**
 * Room geometry: the walk mask, the things standing on it, and what the sanitar
 * can reach from where they are.
 *
 * This is the prep-room lobby's geometry promoted to the contract layer. The lobby
 * was hand-authored from the start (`src/player/lobby/definition.ts`), and the dream
 * is now authored the same way — an ASCII cell grid plus rects plus hotspots — so
 * both sides read their space through this one file.
 *
 * Everything here is structural on purpose. `cellAt` does not care whether it was
 * handed a `LobbyDefinition` or a `DreamRoom`; it wants a width, a height and rows
 * of characters. That is what lets one resolver serve two scenes without either
 * importing the other.
 *
 * Must stay free of DOM *and* node APIs — the CLI and the browser both import it.
 */

import { rectContainsPoint } from "./rect";

/** Which way a walker faces. Four, because the sprites are four. */
export type Direction = "n" | "e" | "s" | "w";

/**
 * What a tile is, for walking purposes only.
 *
 * Deliberately coarser than the tile vocabulary in `tilecodes.ts`: that one says what
 * a tile is *made of* so it can be drawn, this one says whether you can stand on it.
 * A room's look comes from its backdrop and its roles, not from these six letters.
 */
export type RoomCell =
  | "void"
  | "floor"
  | "floorAlt"
  | "wall"
  | "wallFace"
  | "threshold"
  | "grass"
  | "grassTall"
  | "path"
  | "tree";

/** The authoring alphabet. One character per tile, so a room reads as a picture. */
const CELL_BY_MARK: Record<string, RoomCell> = {
  "#": "wall",
  "=": "wallFace",
  _: "threshold",
  ",": "floorAlt",
  ".": "floor",
  g: "grass",
  h: "grassTall",
  p: "path",
  t: "tree",
};

/** Anything with a rectangular ASCII walk mask. */
export interface CellGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly string[];
}

/** Anything occupying a tile rect that may or may not stop a walker. */
export interface SolidRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly solid: boolean;
}

/** Anything the sanitar can stand near and press E on. Positions are in tiles. */
export interface Hotspotish {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Reach in tiles. */
  readonly reach: number;
}

/** A walker's footprint, centred on its position, in pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The footprint is narrower and much shorter than a tile.
 *
 * A body the size of its tile snags on every doorway; a short one lets the feet pass
 * a wall the head overlaps, which is what makes a top-down room feel walkable rather
 * than administered.
 */
export const BODY_WIDTH = 9;
export const BODY_HEIGHT = 7;

/** Outside the grid is void, and an unknown mark is void — never accidentally floor. */
export function cellAt(grid: CellGrid, tx: number, ty: number): RoomCell {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return "void";
  const mark = grid.cells[ty]?.[tx];
  if (mark === undefined) return "void";
  return CELL_BY_MARK[mark] ?? "void";
}

/** Walls stop you; so does the outside. Thresholds and both floors do not. */
export function isSolidCell(cell: RoomCell): boolean {
  return (
    cell === "wall" || cell === "wallFace" || cell === "tree" || cell === "void"
  );
}

/** A cell the walker can stand on. Doors have to land on one of these. */
export function isWalkableCell(cell: RoomCell): boolean {
  return (
    cell === "floor" ||
    cell === "floorAlt" ||
    cell === "threshold" ||
    cell === "grass" ||
    cell === "grassTall" ||
    cell === "path"
  );
}

/** Write one mark into an ASCII mask. Rows are immutable strings. */
export function setCellMark(
  cells: readonly string[],
  x: number,
  y: number,
  mark: string,
): string[] {
  const next = [...cells];
  const row = next[y];
  if (!row || x < 0 || x >= row.length) return next;
  next[y] = `${row.slice(0, x)}${mark}${row.slice(x + 1)}`;
  return next;
}

/** Whether any solid rect covers this tile. */
export function rectBlocks(
  rects: readonly SolidRect[],
  tx: number,
  ty: number,
): boolean {
  for (const rect of rects) {
    if (!rect.solid) continue;
    if (rectContainsPoint(rect, tx, ty)) return true;
  }
  return false;
}

/**
 * Whether a footprint overlaps anything solid.
 *
 * The `- 0.001` on the far edges keeps a box that ends exactly on a tile boundary from
 * claiming the next tile along, which would make every corridor one tile narrower than
 * it looks.
 */
export function blockedInRoom(
  grid: CellGrid,
  rects: readonly SolidRect[],
  box: Box,
  tileSize: number,
): boolean {
  const halfX = box.width / 2;
  const halfY = box.height / 2;
  const minX = Math.floor((box.x - halfX) / tileSize);
  const maxX = Math.floor((box.x + halfX - 0.001) / tileSize);
  const minY = Math.floor((box.y - halfY) / tileSize);
  const maxY = Math.floor((box.y + halfY - 0.001) / tileSize);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (isSolidCell(cellAt(grid, tx, ty))) return true;
      if (rectBlocks(rects, tx, ty)) return true;
    }
  }
  return false;
}

/**
 * The nearest hotspot within its own reach, or null.
 *
 * Each hotspot carries its own radius because reach is a property of the thing, not of
 * the sanitar: a canopy rope is grabbed from further away than a price tag is read.
 * Position is in pixels, hotspots are in tiles, hence `tileSize`.
 */
export function findHotspot<T extends Hotspotish>(
  hotspots: readonly T[],
  x: number,
  y: number,
  tileSize: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const hotspot of hotspots) {
    const distance = Math.hypot(
      hotspot.x * tileSize - x,
      hotspot.y * tileSize - y,
    );
    if (distance <= hotspot.reach * tileSize && distance < bestDistance) {
      best = hotspot;
      bestDistance = distance;
    }
  }
  return best;
}
