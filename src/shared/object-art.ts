/**
 * Movable/carryable objects on a mural room must have their own sprite.
 * The painting already is the furniture; a nameless live object would be invisible.
 */

import { muralShowsTheRoom, type RoomGraphics } from "./room";
import type { ObjectMobility } from "./world-object";

export function muralObjectMissingArt(
  room: { graphics: RoomGraphics },
  object: {
    mobility: ObjectMobility;
    visual: { image: string | null; role: string | null };
  },
): boolean {
  if (object.mobility === "fixed") return false;
  if (!muralShowsTheRoom(room.graphics)) return false;
  return object.visual.image == null && object.visual.role == null;
}

export function assertMuralObjectArt(
  rooms: readonly { id: string; graphics: RoomGraphics }[],
  objects: readonly {
    id: string;
    location: { kind: string; roomId?: string };
    mobility: ObjectMobility;
    visual: { image: string | null; role: string | null };
  }[],
): string[] {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const errors: string[] = [];
  for (const object of objects) {
    if (object.location.kind !== "room" || !object.location.roomId) continue;
    const room = roomById.get(object.location.roomId);
    if (!room) continue;
    if (muralObjectMissingArt(room, object)) {
      errors.push(
        `object ${object.id} in mural room ${room.id} needs visual.image or visual.role`,
      );
    }
  }
  return errors;
}
