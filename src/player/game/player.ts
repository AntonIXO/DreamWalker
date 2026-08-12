/**
 * The sanitar.
 *
 * Eight directions of movement, four of facing, two frames of walk (§7.2). The walk
 * cycle advances on distance travelled rather than on time, so the feet keep pace with
 * the ground whatever the frame rate is doing.
 */

import type { Direction } from "../render/walkerView";
import { BODY_HEIGHT, BODY_WIDTH, moveBox, type Box } from "./collision";
import type { WorldState } from "./world";

/** Pixels per second. Fast enough to cross a room in about two seconds. */
const SPEED = 62;
/** Pixels of travel per walk frame. */
const STRIDE = 9;

export interface PlayerState {
  x: number;
  y: number;
  facing: Direction;
  /** Distance walked, in pixels. The animation frame is derived from it. */
  travelled: number;
  moving: boolean;
  /** Set when a door refuses. The HUD shows it, then it clears. */
  refusedDoorId: string | null;
}

export function createPlayer(world: WorldState): PlayerState {
  const { spawn, tileSize } = world.artifact.map;
  return {
    x: spawn.x * tileSize + tileSize / 2,
    y: spawn.y * tileSize + tileSize / 2,
    facing: "s",
    travelled: 0,
    moving: false,
    refusedDoorId: null,
  };
}

function facingFor(dx: number, dy: number, current: Direction): Direction {
  if (dx === 0 && dy === 0) return current;
  // Horizontal wins ties: a player running diagonally reads better in profile.
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

export function updatePlayer(
  player: PlayerState,
  world: WorldState,
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  player.refusedDoorId = null;

  const dx = axis.x * SPEED * deltaSeconds;
  const dy = axis.y * SPEED * deltaSeconds;

  if (dx === 0 && dy === 0) {
    player.moving = false;
    return;
  }

  const box: Box = {
    x: player.x,
    y: player.y,
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
  };
  const result = moveBox(world, box, dx, dy);

  const movedX = result.x - player.x;
  const movedY = result.y - player.y;

  player.x = result.x;
  player.y = result.y;
  player.facing = facingFor(axis.x, axis.y, player.facing);
  player.refusedDoorId = result.blockedBy;

  const distance = Math.hypot(movedX, movedY);
  player.travelled += distance;
  player.moving = distance > 0.01;
}

export function walkFrame(player: PlayerState): number {
  if (!player.moving) return 0;
  return Math.floor(player.travelled / STRIDE) % 2;
}

export function playerTile(
  player: PlayerState,
  world: WorldState,
): { x: number; y: number } {
  return {
    x: Math.floor(player.x / world.tileSize),
    y: Math.floor(player.y / world.tileSize),
  };
}
