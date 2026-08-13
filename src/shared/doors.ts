/**
 * Doors as thresholds.
 *
 * A door is a rect you walk onto, not a wall you stand inside. `lord rooms --wire`
 * used to drop rects on the `#` / `=` ring, which `isSolidCell` refuses, so the
 * walker never arrived. These helpers punch `_` and slide a rect onto floor.
 *
 * Must stay free of DOM and node APIs.
 */

import type { RoomDoor } from "./room";
import { cellAt, isWalkableCell, setCellMark, type CellGrid } from "./roomGrid";

export interface DoorHost extends CellGrid {
  cells: string[];
  doors: RoomDoor[];
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function rectWalkable(
  grid: CellGrid,
  door: { x: number; y: number; w: number; h: number },
): boolean {
  for (let y = door.y; y < door.y + door.h; y++) {
    for (let x = door.x; x < door.x + door.w; x++) {
      if (isWalkableCell(cellAt(grid, x, y))) return true;
    }
  }
  return false;
}

/**
 * Slide a door off the wall ring onto the first floor row, then along that row
 * until it no longer shares a tile with another door.
 */
export function settleDoor(
  room: CellGrid,
  door: RoomDoor,
  claimed: RoomDoor[],
): RoomDoor {
  const onNorthWall = door.y <= 1;
  const onSouthWall = door.y >= room.height - 1;
  if (onNorthWall || onSouthWall) {
    const rows = onNorthWall ? [1, room.height - 1] : [room.height - 1, 1];
    const width = Math.max(1, door.w);
    const maxX = Math.max(1, room.width - 1 - width);
    for (const y of rows) {
      for (let x = 1; x <= maxX; x++) {
        const candidate = { ...door, x, y, w: width, h: 1 };
        if (
          claimed.every(
            (other) => other.id === door.id || !overlaps(candidate, other),
          )
        ) {
          return candidate;
        }
      }
    }
    return { ...door, x: 1, y: rows[0]!, w: width, h: 1 };
  }

  const innerTop = 2;
  const innerBottom = Math.max(innerTop, room.height - 2);
  const preferred = [innerTop, innerTop + 1, innerBottom];
  const width = Math.max(1, door.w);
  const maxX = Math.max(1, room.width - 1 - width);

  for (const row of preferred) {
    if (row < innerTop || row > innerBottom) continue;
    for (let x = 1; x <= maxX; x++) {
      const candidate = { ...door, x, y: row, w: width, h: 1 };
      if (
        claimed.every(
          (other) => other.id === door.id || !overlaps(candidate, other),
        )
      ) {
        return candidate;
      }
    }
  }
  return {
    ...door,
    x: Math.min(Math.max(1, door.x), maxX),
    y: innerTop,
    w: width,
    h: 1,
  };
}

/** Punch `_` under every door so the walker can stand on it. */
export function punchDoorThresholds<T extends DoorHost>(room: T): T {
  const settled: RoomDoor[] = [];
  for (const door of room.doors) {
    settled.push(settleDoor(room, door, settled));
  }
  let cells = room.cells;
  for (const door of settled) {
    // Wall-mounted doors stay solid; the walker presses into them. Punching them
    // onto `_` turned the hotel's first floor row into twenty-four warps.
    if (door.y <= 1 || door.y >= room.height - 1) continue;
    for (let y = door.y; y < door.y + door.h; y++) {
      for (let x = door.x; x < door.x + door.w; x++) {
        cells = setCellMark(cells, x, y, "_");
      }
    }
  }
  return { ...room, cells, doors: settled };
}

export function doorHasWalkableCell(
  room: CellGrid,
  door: { x: number; y: number; w: number; h: number },
): boolean {
  return rectWalkable(room, door);
}

/**
 * A door the walker can actually use: either they can stand on it, or they can
 * press into it from a walkable tile on the inward side.
 */
export function doorIsUsable(
  room: CellGrid,
  door: { x: number; y: number; w: number; h: number },
): boolean {
  if (doorHasWalkableCell(room, door)) return true;
  const inwardY = door.y <= 1 ? door.y + Math.max(1, door.h) : door.y - 1;
  for (let x = door.x; x < door.x + door.w; x++) {
    if (isWalkableCell(cellAt(room, x, inwardY))) return true;
  }
  return false;
}

/** Overlapping door rects — `--wire` wrapped the hotel hub and stacked later rooms. */
export function overlappingDoors(
  doors: readonly RoomDoor[],
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i]!;
      const b = doors[j]!;
      if (overlaps(a, b)) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}
