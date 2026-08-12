/**
 * Collision against the live tile grid.
 *
 * Axis-separated: try the horizontal move, then the vertical one. That is what lets a
 * player slide along a wall instead of sticking to it, and it means a wide gate never
 * catches you on its corner.
 *
 * Three things are deliberately *not* answered by the tile alone, because none of them is
 * a property of the ground:
 *
 *   - a **gate** depends on what the sanitar is carrying;
 *   - **water** depends on nothing yet, but is the seam where that will change;
 *   - a **ledge** depends on which way you are walking, and is the only rule here that
 *     needs to know about direction at all. It is what gives the overworld a one-way
 *     shortcut that never has to refuse anybody (§6: never a cheaper path than the one it
 *     destroyed — a ledge makes the way back longer without closing it).
 */

import {
  LEDGE_DIRECTION,
  isLedgeTile,
  isSolidTile,
  isWaterTile,
} from "../../shared/tilecodes";
import {
  canPassDoor,
  doorAtTile,
  isDoorTileAt,
  tileAt,
  type WorldState,
} from "./world";

/** The walker's footprint, in pixels. Narrower than a tile so corners are forgiving. */
export const BODY_WIDTH = 9;
export const BODY_HEIGHT = 7;

export interface Box {
  /** Centre of the footprint, in world pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function blocksAt(
  world: WorldState,
  tileX: number,
  tileY: number,
): boolean {
  if (isDoorTileAt(world, tileX, tileY)) {
    const door = doorAtTile(world, tileX, tileY);
    // A door tile with no door record is a patch mid-flight; treat it as solid rather
    // than letting the player walk into a place that has not finished existing.
    return door ? !canPassDoor(world, door) : true;
  }
  const tile = tileAt(world, tileX, tileY);
  // Nothing crosses water yet. §6's genre contract is where the answer will come from —
  // a hospital dream does not get Surf, it gets whatever that world's miracle is — so
  // this stays one condition rather than being folded into `isSolidTile`.
  if (isWaterTile(tile)) return true;
  return isSolidTile(tile);
}

/** Any solid tile under the footprint. */
export function boxBlocked(world: WorldState, box: Box): boolean {
  const half = { x: box.width / 2, y: box.height / 2 };
  const size = world.tileSize;

  const minX = Math.floor((box.x - half.x) / size);
  const maxX = Math.floor((box.x + half.x - 0.001) / size);
  const minY = Math.floor((box.y - half.y) / size);
  const maxY = Math.floor((box.y + half.y - 0.001) / size);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (blocksAt(world, tx, ty)) return true;
    }
  }
  return false;
}

/**
 * Whether a ledge under the footprint refuses this direction.
 *
 * You may enter a ledge tile only travelling the way it drops. Walking into one from below
 * is climbing, and the whole point is that you cannot — which is what turns a five-second
 * hop into a two-minute walk back round, and gives the world a shape you learn.
 */
function ledgeRefuses(
  world: WorldState,
  box: Box,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 && dy === 0) return false;
  const size = world.tileSize;
  const half = { x: box.width / 2, y: box.height / 2 };

  for (
    let ty = Math.floor((box.y - half.y) / size);
    ty <= Math.floor((box.y + half.y - 0.001) / size);
    ty++
  ) {
    for (
      let tx = Math.floor((box.x - half.x) / size);
      tx <= Math.floor((box.x + half.x - 0.001) / size);
      tx++
    ) {
      const tile = tileAt(world, tx, ty);
      if (!isLedgeTile(tile)) continue;
      const allowed = LEDGE_DIRECTION[tile]!;
      // Moving with the drop is fine; moving against it, or across it, is not.
      if (allowed.dx !== 0 && Math.sign(dx) !== allowed.dx) return true;
      if (allowed.dy !== 0 && Math.sign(dy) !== allowed.dy) return true;
    }
  }
  return false;
}

export interface MoveResult {
  x: number;
  y: number;
  /** True when the attempted move was refused on that axis. */
  hitX: boolean;
  hitY: boolean;
  /** The door that refused, if the move was stopped by one. Drives the refusal line. */
  blockedBy: string | null;
}

export function moveBox(
  world: WorldState,
  box: Box,
  dx: number,
  dy: number,
): MoveResult {
  let { x, y } = box;
  let hitX = false;
  let hitY = false;
  let blockedBy: string | null = null;

  const noteDoor = (px: number, py: number): void => {
    const size = world.tileSize;
    const half = { x: box.width / 2, y: box.height / 2 };
    for (
      let ty = Math.floor((py - half.y) / size);
      ty <= Math.floor((py + half.y - 0.001) / size);
      ty++
    ) {
      for (
        let tx = Math.floor((px - half.x) / size);
        tx <= Math.floor((px + half.x - 0.001) / size);
        tx++
      ) {
        const door = doorAtTile(world, tx, ty);
        if (door && !canPassDoor(world, door)) {
          blockedBy = door.id;
          return;
        }
      }
    }
  };

  if (dx !== 0) {
    const candidate = { ...box, x: x + dx };
    if (boxBlocked(world, candidate) || ledgeRefuses(world, candidate, dx, 0)) {
      hitX = true;
      noteDoor(candidate.x, candidate.y);
    } else {
      x = candidate.x;
    }
  }

  if (dy !== 0) {
    const candidate = { ...box, x, y: y + dy };
    if (boxBlocked(world, candidate) || ledgeRefuses(world, candidate, 0, dy)) {
      hitY = true;
      noteDoor(candidate.x, candidate.y);
    } else {
      y = candidate.y;
    }
  }

  return { x, y, hitX, hitY, blockedBy };
}
