import { rectsOverlap } from "../../shared/rect";
import type { RoomDoor } from "../../shared/room";
import type { MapPatch } from "../../shared/map-patch";
import type { WorldState } from "./world";

/** Geometry and object receipts, never the model's description, uncover a threshold. */
export function passageIsUncovered(world: WorldState, door: RoomDoor): boolean {
  if (!door.revealBy) return false;
  const roomId = world.roomIdByDoorId.get(door.id);
  if (!roomId) return false;
  const id = door.revealBy.objectId;
  const object =
    world.objectById.get(`${roomId}:${id}`) ?? world.objectById.get(id);
  if (!object) return false;
  if (door.revealBy.when === "opened") return object.state.open === true;
  if (object.location.kind !== "room" || object.location.roomId !== roomId)
    return true;
  const body = object.body ?? { w: 1, h: 1 };
  return !rectsOverlap({ ...object.location, w: body.w, h: body.h }, door);
}

/** Call after a successful world action; apply returned patches through applyPatch. */
export function uncoveredPassagePatches(world: WorldState): MapPatch[] {
  return [...world.doorById.values()]
    .filter((door) => door.hidden && passageIsUncovered(world, door))
    .map((door) => ({
      kind: "revealDoor",
      doorId: door.id,
      reason: "Предмет больше не закрывает подготовленный проход.",
    }));
}
