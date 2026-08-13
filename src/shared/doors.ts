/**
 * Doors as thresholds.
 *
 * A door is a rect you walk onto, not a wall you stand inside. `lord rooms --wire`
 * used to drop rects on the `#` / `=` ring, which `isSolidCell` refuses, so the
 * walker never arrived. These helpers punch `_` and slide a rect onto floor.
 *
 * Must stay free of DOM and node APIs.
 */

import { rectsOverlap as overlaps } from "./rect";
import type { RoomDoor } from "./room";
import type { Direction } from "./roomGrid";
import {
  cellAt,
  isSolidCell,
  isWalkableCell,
  setCellMark,
  type CellGrid,
} from "./roomGrid";

export interface DoorHost extends CellGrid {
  cells: string[];
  doors: RoomDoor[];
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
 *
 * **A door that is already fine is returned untouched.** This guard is the whole reason
 * hand-drawn geometry can survive: without it, the scan below yanks every door with
 * `y <= 1` onto the ring regardless of where a person put it, and `punchDoorThresholds`
 * runs `settleDoor` over *every* door, and `lord rooms --rebind` runs
 * `punchDoorThresholds` over every room and writes the files back. One `--rebind` after
 * the floors are drawn would silently rearrange them all.
 *
 * The scan is a repair for generated geometry (`--wire` used to drop rects on the `#`
 * ring, which `isSolidCell` refuses), so it should only ever run on something broken.
 */
export function settleDoor(
  room: CellGrid,
  door: RoomDoor,
  claimed: RoomDoor[],
): RoomDoor {
  const clashes = claimed.some(
    (other) => other.id !== door.id && overlaps(door, other),
  );
  if (!clashes && doorIsUsable(room, door)) return door;

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
    //
    // The test used to be `door.y <= 1 || door.y >= height - 1`, which is a *proxy* for
    // "this door hangs on the outer wall ring" and stops being true the moment a floor
    // has an interior wall at y=17. Ask the mask instead: a door standing on anything
    // solid is mounted in a wall, wherever that wall happens to be.
    if (doorSitsInWall(room, door)) continue;
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

/** Whether any tile of the rect is solid — i.e. the door is set into a wall. */
export function doorSitsInWall(
  room: CellGrid,
  door: { x: number; y: number; w: number; h: number },
): boolean {
  for (let y = door.y; y < door.y + Math.max(1, door.h); y++) {
    for (let x = door.x; x < door.x + Math.max(1, door.w); x++) {
      if (isSolidCell(cellAt(room, x, y))) return true;
    }
  }
  return false;
}

const STEP: Record<Direction, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/** Whether a walkable tile abuts the rect on the given side. */
function approachableFrom(
  room: CellGrid,
  door: { x: number; y: number; w: number; h: number },
  from: Direction,
): boolean {
  const w = Math.max(1, door.w);
  const h = Math.max(1, door.h);
  const step = STEP[from];
  // Walk the edge the walker would stand along: the row above/below for n/s, the
  // column left/right for e/w.
  const spanX = step.x === 0 ? w : 1;
  const spanY = step.y === 0 ? h : 1;
  const baseX = step.x > 0 ? door.x + w : step.x < 0 ? door.x - 1 : door.x;
  const baseY = step.y > 0 ? door.y + h : step.y < 0 ? door.y - 1 : door.y;
  for (let dy = 0; dy < spanY; dy++) {
    for (let dx = 0; dx < spanX; dx++) {
      if (isWalkableCell(cellAt(room, baseX + dx, baseY + dy))) return true;
    }
  }
  return false;
}

/**
 * A door the walker can actually use: either they can stand on it, or they can press
 * into it from a walkable tile alongside (`player.ts` fires a door on the solid tile
 * *ahead* of the direction of travel).
 *
 * `facing` names the side the walker comes from when the author has said so. Without it
 * every side is tried, which is the honest answer: the old code derived one inward
 * direction from `door.y <= 1`, and that is only correct for doors on the outer ring.
 */
export function doorIsUsable(
  room: CellGrid,
  door: { x: number; y: number; w: number; h: number },
  facing?: Direction | null,
): boolean {
  if (doorHasWalkableCell(room, door)) return true;
  if (facing) return approachableFrom(room, door, facing);
  return (["n", "e", "s", "w"] as const).some((side) =>
    approachableFrom(room, door, side),
  );
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
