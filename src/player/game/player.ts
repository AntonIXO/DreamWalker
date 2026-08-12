/**
 * The sanitar.
 *
 * Movement itself lives in `shared/roomWalk.ts`, shared with the lobby and with every
 * authored room. What is left here is the dream-specific part: which room's geometry the
 * walker is being tested against, and which door most recently refused them.
 */

import {
  createWalker,
  updateWalker,
  walkFrame as sharedWalkFrame,
  type Walker,
} from "../../shared/roomWalk";
import type { Direction } from "../../shared/roomGrid";
import { doorAtTile, canPassDoor, type RoomState } from "./world";

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
  return {
    ...createWalker(
      (entry?.x ?? 1) * size,
      (entry?.y ?? 1) * size,
      (entry?.facing ?? "s") as Direction,
    ),
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
  player.x = (entry?.x ?? 1) * size;
  player.y = (entry?.y ?? 1) * size;
  player.facing = (entry?.facing ?? "s") as Direction;
  player.moving = false;
  player.refusedDoorId = null;
  player.enteredDoorId = null;
}

export function updatePlayer(
  player: PlayerState,
  room: RoomState,
  world: { keysHeld: Set<string>; leversPulled: Set<string>; puzzlesSolved: Set<string> },
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  const before = { x: player.x, y: player.y };
  const solidProps = room.props.filter((prop) => prop.solid);
  updateWalker(player, room, solidProps, room.tileSize, axis, deltaSeconds);

  player.enteredDoorId = null;
  const tx = Math.floor(player.x / room.tileSize);
  const ty = Math.floor(player.y / room.tileSize);
  const door = doorAtTile(room, tx, ty);
  if (!door) {
    player.refusedDoorId = null;
    return;
  }
  if (canPassDoor(world as never, door)) {
    player.enteredDoorId = door.id;
    player.refusedDoorId = null;
    return;
  }
  // Refused: undo the step so the sanitar stands against it rather than inside it.
  player.x = before.x;
  player.y = before.y;
  player.refusedDoorId = door.id;
}

export function walkFrame(player: PlayerState): number {
  return sharedWalkFrame(player);
}

/** Tile the sanitar is standing on. */
export function playerTile(
  player: PlayerState,
  room: RoomState,
): { x: number; y: number } {
  return {
    x: Math.floor(player.x / room.tileSize),
    y: Math.floor(player.y / room.tileSize),
  };
}
