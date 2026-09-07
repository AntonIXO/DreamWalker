/**
 * Deterministic in-room grid path on the authored walk mask plus live solids.
 *
 * Used by moveTo and by NPC action queues. No teleports: a missing path is a
 * refusal, not a warp.
 */

import { cellAt, isWalkableCell } from "../../shared/roomGrid";
import {
  findChebyshevPath,
  solidObjectCovers,
} from "../../shared/world-object";
import type { WorldState } from "./world";

export function findGridPath(
  world: WorldState,
  roomId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  ignoreObjectId?: string,
): { x: number; y: number }[] | null {
  const room = world.roomById.get(roomId);
  if (!room) return null;
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  return findChebyshevPath(from, to, (x, y) => {
    if (x === sx && y === sy) return true;
    if (!isWalkableCell(cellAt(room, x, y))) return false;
    return !solidObjectCovers(world.objects, roomId, x, y, ignoreObjectId);
  });
}
