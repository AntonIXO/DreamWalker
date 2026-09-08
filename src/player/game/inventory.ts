/** Inventory is a view of physical locations, never a second item store. */
import { canObserveWorldPose } from "../../shared/world-mind";
import type { WorldMutator, WorldObjectState } from "../../shared/world-object";

export interface CarriedInventoryObject {
  object: WorldObjectState;
  /** A visible child of an open container, or null for a directly held/floor object. */
  containerId: string | null;
  depth: number;
}

function accessibleObjects(
  objects: readonly WorldObjectState[],
  roots: readonly WorldObjectState[],
): CarriedInventoryObject[] {
  const children = new Map<string, WorldObjectState[]>();
  for (const object of objects) {
    if (object.location.kind !== "inside") continue;
    const list = children.get(object.location.objectId) ?? [];
    list.push(object);
    children.set(object.location.objectId, list);
  }
  const result: CarriedInventoryObject[] = [];
  const seen = new Set<string>();
  const visit = (
    object: WorldObjectState,
    containerId: string | null,
    depth: number,
  ): void => {
    if (seen.has(object.id)) return;
    seen.add(object.id);
    result.push({ object, containerId, depth });
    if (object.state.open !== true) return;
    for (const child of children.get(object.id) ?? [])
      visit(child, object.id, depth + 1);
  };
  for (const object of roots) visit(object, null, 0);
  return result;
}

export function carriedInventoryObjects(
  objects: readonly WorldObjectState[],
): CarriedInventoryObject[] {
  return accessibleObjects(
    objects,
    objects.filter(
      (object) =>
        object.location.kind === "held" &&
        object.location.actor.kind === "player",
    ),
  );
}

/** Visible floor objects and their open contents, without anybody's carried inventory. */
export function nearbyInventoryObjects(
  world: WorldMutator,
): CarriedInventoryObject[] {
  const player = world.getPlayerPose();
  if (!player) return [];
  return accessibleObjects(
    world.objects,
    world.objects.filter((object) => {
      const location = object.location;
      return (
        location.kind === "room" && canObserveWorldPose(world, player, location)
      );
    }),
  );
}
