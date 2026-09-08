/**
 * The sanitar.
 *
 * Movement itself lives in `shared/roomWalk.ts`, shared with the lobby. On a street
 * map the walker lives in world pixels and is tested against every room the body
 * overlaps; a door that shares an edge with its destination is an opening, not a warp.
 */

import {
  createWalker,
  facingFor,
  updateWalker,
  WALK_SPEED,
  walkFrame as sharedWalkFrame,
  type Walker,
} from "../../shared/roomWalk";
import type { Direction } from "../../shared/roomGrid";
import {
  BODY_HEIGHT,
  BODY_WIDTH,
  cellAt,
  isSolidCell,
} from "../../shared/roomGrid";
import {
  blockedInWorld,
  isContinuousDoor,
  isStreetWorld,
  originX,
  originY,
  toWorldPixels,
} from "../../shared/street";
import { solidRectsFor } from "./object-collision";
import {
  doorAtTile,
  canPassDoor,
  type RoomState,
  type WorldState,
} from "./world";

export interface PlayerState extends Walker {
  /**
   * The door that turned the sanitar away since the last frame that did not, so the HUD
   * can say so once rather than every frame.
   */
  refusedDoorId: string | null;
  /** The door walked into and passed this frame, for the session to act on. */
  enteredDoorId: string | null;
}

export function createPlayer(room: RoomState, entryId: string): PlayerState {
  const entry =
    room.entries.find((candidate) => candidate.id === entryId) ??
    room.entries[0];
  const size = room.tileSize;
  const localX = (entry?.x ?? 1) * size;
  const localY = (entry?.y ?? 1) * size;
  const world = toWorldPixels(room, localX, localY);
  return {
    ...createWalker(world.x, world.y, (entry?.facing ?? "s") as Direction),
    refusedDoorId: null,
    enteredDoorId: null,
  };
}

/** Put the sanitar at a named entry of a room, keeping the same state object. */
export function placeAtEntry(
  player: PlayerState,
  room: RoomState,
  entryId: string | null,
): void {
  const entry =
    room.entries.find((candidate) => candidate.id === entryId) ??
    room.entries[0];
  const size = room.tileSize;
  const world = toWorldPixels(
    room,
    (entry?.x ?? 1) * size,
    (entry?.y ?? 1) * size,
  );
  player.x = world.x;
  player.y = world.y;
  player.facing = (entry?.facing ?? "s") as Direction;
  player.moving = false;
  player.refusedDoorId = null;
  player.enteredDoorId = null;
}

export function updatePlayer(
  player: PlayerState,
  room: RoomState,
  world: WorldState,
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  const before = { x: player.x, y: player.y };
  if (isStreetWorld(world.rooms)) {
    walkStreet(player, room, world, axis, deltaSeconds);
  } else {
    const solids = solidRectsFor(world, room.id);
    updateWalker(player, room, solids, room.tileSize, axis, deltaSeconds);
  }

  player.enteredDoorId = null;
  const door = doorAhead(player, room, axis, world);
  if (!door) {
    player.refusedDoorId = null;
    return;
  }
  const dest = world.roomById.get(door.toRoomId);
  if (canPassDoor(world, door)) {
    door.closed = false;
    if (!isContinuousDoor(room, door, dest)) player.enteredDoorId = door.id;
    player.refusedDoorId = null;
    return;
  }
  player.x = before.x;
  player.y = before.y;
  player.refusedDoorId = door.id;
}

function walkStreet(
  player: PlayerState,
  room: RoomState,
  world: WorldState,
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  const dx = axis.x * WALK_SPEED * deltaSeconds;
  const dy = axis.y * WALK_SPEED * deltaSeconds;
  if (dx === 0 && dy === 0) {
    player.moving = false;
    return;
  }
  const box = {
    x: player.x,
    y: player.y,
    width: BODY_WIDTH,
    height: BODY_HEIGHT,
  };
  let x = player.x;
  let y = player.y;
  const collision = {
    solidsFor: (roomId: string) => solidRectsFor(world, roomId),
    canPassDoor: (door: RoomState["doors"][number]) => canPassDoor(world, door),
  };
  if (
    dx !== 0 &&
    !blockedInWorld(
      world.rooms,
      room.id,
      { ...box, x: x + dx },
      room.tileSize,
      collision,
    )
  ) {
    x += dx;
  }
  if (
    dy !== 0 &&
    !blockedInWorld(
      world.rooms,
      room.id,
      { ...box, x, y: y + dy },
      room.tileSize,
      collision,
    )
  ) {
    y += dy;
  }
  const moved = Math.hypot(x - player.x, y - player.y);
  player.x = x;
  player.y = y;
  player.facing = facingFor(axis.x, axis.y, player.facing);
  player.travelled += moved;
  player.moving = moved > 0.01;
}

function doorAhead(
  player: PlayerState,
  room: RoomState,
  axis: { x: number; y: number },
  world: WorldState,
): ReturnType<typeof doorAtTile> {
  const size = room.tileSize;
  const ox = originX(room) * size;
  const oy = originY(room) * size;
  const tx = Math.floor((player.x - ox) / size);
  const ty = Math.floor((player.y - oy) / size);
  const stepX = axis.x === 0 ? 0 : axis.x > 0 ? 1 : -1;
  const stepY = axis.y === 0 ? 0 : axis.y > 0 ? 1 : -1;
  const aheadX = stepX !== 0 ? tx + stepX : tx;
  const aheadY = stepY !== 0 ? ty + stepY : ty;
  const aheadDoor = doorAtTile(room, aheadX, aheadY);
  const ahead =
    (stepX !== 0 || stepY !== 0) &&
    (isSolidCell(cellAt(room, aheadX, aheadY)) ||
      (aheadDoor !== null && !canPassDoor(world, aheadDoor)))
      ? aheadDoor
      : null;
  return doorAtTile(room, tx, ty) ?? ahead;
}

export function walkFrame(player: PlayerState): number {
  return sharedWalkFrame(player);
}

/** Tile the sanitar is standing on, in the given room's local space. */
export function playerTile(
  player: PlayerState,
  room: RoomState,
): { x: number; y: number } {
  const size = room.tileSize;
  return {
    x: Math.floor(player.x / size - originX(room)),
    y: Math.floor(player.y / size - originY(room)),
  };
}
