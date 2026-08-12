/**
 * Walking inside one room.
 *
 * Movement is axis-separated: the horizontal step is tried, then the vertical one from
 * wherever the first left us. That is what lets the sanitar slide along a wall instead
 * of sticking to it, and it is why a blocked diagonal still moves you.
 *
 * Extracted from the lobby walker so the dream can use it too. Both scenes are now the
 * same shape — a cell grid, some solid rects, and a body walking over them — so there
 * is no reason for two copies of this to drift apart.
 *
 * Must stay free of DOM *and* node APIs.
 */

import {
  BODY_HEIGHT,
  BODY_WIDTH,
  blockedInRoom,
  type Box,
  type CellGrid,
  type Direction,
  type SolidRect,
} from "./roomGrid";

/** Pixels per second. Slow enough that a room reads, fast enough not to be a chore. */
export const WALK_SPEED = 62;

/** Pixels of travel per animation frame. Tied to distance, not time, so it never skates. */
export const WALK_STRIDE = 9;

export interface Walker {
  x: number;
  y: number;
  facing: Direction;
  /** Total distance walked, in pixels. Drives the two-frame cycle. */
  travelled: number;
  moving: boolean;
}

export function createWalker(
  x: number,
  y: number,
  facing: Direction = "s",
): Walker {
  return { x, y, facing, travelled: 0, moving: false };
}

/**
 * Which way to face for a given input.
 *
 * Horizontal wins ties, because a walker holding both keys reads better in profile
 * than head-on, and every sprite set has more information in its side view.
 */
export function facingFor(
  dx: number,
  dy: number,
  current: Direction,
): Direction {
  if (dx === 0 && dy === 0) return current;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

export function updateWalker(
  walker: Walker,
  grid: CellGrid,
  rects: readonly SolidRect[],
  tileSize: number,
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  const dx = axis.x * WALK_SPEED * deltaSeconds;
  const dy = axis.y * WALK_SPEED * deltaSeconds;
  if (dx === 0 && dy === 0) {
    walker.moving = false;
    return;
  }

  const box: Box = {
    x: walker.x,
    y: walker.y,
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
  };

  let x = walker.x;
  let y = walker.y;
  if (
    dx !== 0 &&
    !blockedInRoom(grid, rects, { ...box, x: x + dx }, tileSize)
  ) {
    x += dx;
  }
  if (
    dy !== 0 &&
    !blockedInRoom(grid, rects, { ...box, x, y: y + dy }, tileSize)
  ) {
    y += dy;
  }

  const moved = Math.hypot(x - walker.x, y - walker.y);
  walker.x = x;
  walker.y = y;
  walker.facing = facingFor(axis.x, axis.y, walker.facing);
  walker.travelled += moved;
  // A hair above zero: floating point leaves a walker pressed into a wall "moving".
  walker.moving = moved > 0.01;
}

/**
 * Which walk frame to show.
 *
 * Two frames, and standing still is always frame 0. §7.2 — a walk is two frames and
 * that is the style; a smoother cycle would look like a different game.
 */
export function walkFrame(walker: Walker): number {
  if (!walker.moving) return 0;
  return Math.floor(walker.travelled / WALK_STRIDE) % 2;
}
