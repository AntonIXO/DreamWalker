/**
 * Walking inside the prep room.
 *
 * Same footprint and speed as the dream walker, but the lobby is a small solid
 * grid rather than a WorldState. Keeping them apart is what stops the cycle
 * and the heartbeat from existing just because the sanitar took a step.
 */

import { BODY_HEIGHT, BODY_WIDTH, type Box } from "../game/collision";
import type { Direction } from "../render/walkerView";
import { cellAt, furnitureBlocks } from "./definition";
import type { LobbyDefinition } from "./types";

const SPEED = 62;
const STRIDE = 9;

export interface LobbyWalker {
  x: number;
  y: number;
  facing: Direction;
  travelled: number;
  moving: boolean;
}

export function createLobbyWalker(definition: LobbyDefinition): LobbyWalker {
  const size = definition.tileSize;
  return {
    x: definition.spawn.x * size,
    y: definition.spawn.y * size,
    facing: definition.spawn.facing,
    travelled: 0,
    moving: false,
  };
}

function facingFor(dx: number, dy: number, current: Direction): Direction {
  if (dx === 0 && dy === 0) return current;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

function blocked(definition: LobbyDefinition, box: Box): boolean {
  const size = definition.tileSize;
  const halfX = box.width / 2;
  const halfY = box.height / 2;
  const minX = Math.floor((box.x - halfX) / size);
  const maxX = Math.floor((box.x + halfX - 0.001) / size);
  const minY = Math.floor((box.y - halfY) / size);
  const maxY = Math.floor((box.y + halfY - 0.001) / size);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const cell = cellAt(definition, tx, ty);
      if (cell === "wall" || cell === "wallFace" || cell === "void")
        return true;
      if (furnitureBlocks(definition, tx, ty)) return true;
    }
  }
  return false;
}

export function updateLobbyWalker(
  walker: LobbyWalker,
  definition: LobbyDefinition,
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  const dx = axis.x * SPEED * deltaSeconds;
  const dy = axis.y * SPEED * deltaSeconds;
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
  if (dx !== 0 && !blocked(definition, { ...box, x: x + dx })) x += dx;
  if (dy !== 0 && !blocked(definition, { ...box, x, y: y + dy })) y += dy;

  const moved = Math.hypot(x - walker.x, y - walker.y);
  walker.x = x;
  walker.y = y;
  walker.facing = facingFor(axis.x, axis.y, walker.facing);
  walker.travelled += moved;
  walker.moving = moved > 0.01;
}

export function lobbyWalkFrame(walker: LobbyWalker): number {
  if (!walker.moving) return 0;
  return Math.floor(walker.travelled / STRIDE) % 2;
}
