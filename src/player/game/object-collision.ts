/**
 * Live collision for authored props and WorldObjectState.
 *
 * Choice, until the engine agent finishes inhabit-migration:
 *   - Authored `room.props` still block, unless an object with the same id exists
 *     (the object row then owns that footprint, including "held" which frees it).
 *   - Objects with `body.solid` and `location.kind === "room"` in this room block.
 *   - Unmigrated interests still occupy their tile, matching figures.ts today.
 *     An interest that has become an object is not counted twice.
 *
 * Player and figures both read `solidRectsFor`. Do not also `rectBlocks(room.props)`
 * at the call site.
 */

import { rectBlocks, type SolidRect } from "../../shared/roomGrid";
import type { WorldObjectState } from "../../shared/world-object";
import type { WorldState } from "./world";

export type WorldWithObjects = WorldState & {
  objects?: WorldObjectState[];
};

export function liveObjects(world: WorldState): WorldObjectState[] {
  return (world as WorldWithObjects).objects ?? [];
}

export function setLiveObjects(
  world: WorldState,
  objects: WorldObjectState[],
): void {
  (world as WorldWithObjects).objects = objects;
}

export function solidRectsFor(world: WorldState, roomId: string): SolidRect[] {
  const room = world.roomById.get(roomId);
  if (!room) return [];

  const objects = liveObjects(world);
  const objectIds = new Set(objects.map((object) => object.id));
  const rects: SolidRect[] = [];

  for (const prop of room.props) {
    if (!prop.solid) continue;
    if (objectIds.has(prop.id)) continue;
    rects.push(prop);
  }

  for (const object of objects) {
    if (object.location.kind !== "room") continue;
    if (object.location.roomId !== roomId) continue;
    if (!object.body?.solid) continue;
    rects.push({
      x: object.location.x,
      y: object.location.y,
      w: object.body.w,
      h: object.body.h,
      solid: true,
    });
  }

  for (const interest of world.interests) {
    if (interest.roomId !== roomId) continue;
    if (objectIds.has(interest.id)) continue;
    rects.push({
      x: Math.round(interest.x),
      y: Math.round(interest.y),
      w: 1,
      h: 1,
      solid: true,
    });
  }

  return rects;
}

/** Live object solids only — street walking already consults `room.props`. */
export function liveObjectRectsFor(
  world: WorldState,
  roomId: string,
): SolidRect[] {
  const rects: SolidRect[] = [];
  for (const object of liveObjects(world)) {
    if (object.location.kind !== "room") continue;
    if (object.location.roomId !== roomId) continue;
    if (!object.body?.solid) continue;
    rects.push({
      x: object.location.x,
      y: object.location.y,
      w: object.body.w,
      h: object.body.h,
      solid: true,
    });
  }
  return rects;
}

export function tileBlockedBySolids(
  world: WorldState,
  roomId: string,
  tx: number,
  ty: number,
): boolean {
  return rectBlocks(solidRectsFor(world, roomId), tx, ty);
}
