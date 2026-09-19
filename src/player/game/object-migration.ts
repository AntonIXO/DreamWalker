/**
 * Derive live WorldObjectState from authored props, hotspots, and interests.
 *
 * RoomProp / RoomHotspot stay on the artifact. This catalog is what take/drop
 * mutate. Do not rewrite rooms by hand — inhabit and reset call this.
 */

import type { RoomHotspot, RoomProp } from "../../shared/room";
import {
  compilePhysicalProfile,
  type PhysicalProfile,
} from "../../shared/object-profile";
import type {
  ObjectAffordance,
  ObjectMobility,
  WorldObjectState,
} from "../../shared/world-object";

export interface MigratableRoom {
  id: string;
  props: readonly RoomProp[];
  hotspots: readonly RoomHotspot[];
}

export interface MigratableInterest {
  id: string;
  roomId: string;
  name: string;
  x: number;
  y: number;
  solid: boolean;
  clueId: string | null;
  holdsShardId: string | null;
  sensorySeed: string;
}

const CARRY_AFFORDANCES: ObjectAffordance[] = [
  "examine",
  "take",
  "drop",
  "give",
  "put",
  "use",
];

const LOOK_AFFORDANCES: ObjectAffordance[] = ["examine"];

export function migrateWorldObjects(
  rooms: readonly MigratableRoom[],
  interests: readonly MigratableInterest[] = [],
): WorldObjectState[] {
  const objects: WorldObjectState[] = [];
  const seen = new Set<string>();

  for (const room of rooms) {
    const firstObject = objects.length;
    const propById = new Map(room.props.map((prop) => [prop.id, prop]));
    const paired = new Set<string>();

    for (const hotspot of room.hotspots) {
      if (hotspot.kind === "figure") continue;
      const prop = hotspot.propId
        ? (propById.get(hotspot.propId) ?? null)
        : null;
      if (prop) {
        if (paired.has(prop.id)) continue;
        paired.add(prop.id);
        objects.push(takeId(seen, fromHotspotAndProp(room.id, hotspot, prop)));
      } else {
        objects.push(takeId(seen, fromFreeHotspot(room.id, hotspot)));
      }
    }

    for (const prop of room.props) {
      if (paired.has(prop.id)) continue;
      objects.push(takeId(seen, fromUnpairedProp(room.id, prop)));
    }
    const local = objects.slice(firstObject);
    const resolveLocal = (id: string) =>
      local.find(
        (object) => object.id === id || object.id === `${room.id}:${id}`,
      );
    for (const prop of room.props) {
      const object = resolveLocal(prop.id);
      if (!object) continue;
      const inside = (prop as RoomProp & { inside?: string }).inside;
      if (inside) {
        const container = resolveLocal(inside);
        if (!container || container.id === object.id)
          throw new Error(`invalid container ${inside} for ${object.id}`);
        object.location = { kind: "inside", objectId: container.id };
      }
      if (object.state.attachedTo) {
        const anchor = resolveLocal(object.state.attachedTo);
        if (!anchor || anchor.id === object.id)
          throw new Error(`invalid attachment for ${object.id}`);
        object.state.attachedTo = anchor.id;
        object.profile!.attachment!.toObjectId = anchor.id;
      }
    }
  }

  for (const interest of interests) {
    objects.push(takeId(seen, fromInterest(interest)));
  }

  return objects;
}

function takeId(seen: Set<string>, object: WorldObjectState): WorldObjectState {
  let id = object.id;
  if (seen.has(id)) {
    id = `${object.location.kind === "room" ? object.location.roomId : "obj"}:${object.id}`;
  }
  seen.add(id);
  return id === object.id ? object : { ...object, id };
}

function isCarryableHotspot(hotspot: RoomHotspot): boolean {
  if (hotspot.refusal) return false;
  // Compatibility for old clue artifacts; all ordinary objects use profiles.
  return hotspot.kind === "clue";
}

function fromHotspotAndProp(
  roomId: string,
  hotspot: RoomHotspot,
  prop: RoomProp,
): WorldObjectState {
  const ui = hotspot.kind === "ui";
  const carryable = isCarryableHotspot(hotspot);
  return finish({
    profile: prop.profile ?? hotspot.profile,
    id: prop.id,
    name: hotspot.prompt || prop.id,
    roomId,
    x: prop.x,
    y: prop.y,
    mobility: carryable ? "carryable" : "fixed",
    affordances: ui
      ? ["examine", "activate"]
      : carryable
        ? CARRY_AFFORDANCES
        : LOOK_AFFORDANCES,
    body: ui
      ? { w: prop.w, h: prop.h, solid: false }
      : { w: prop.w, h: prop.h, solid: prop.solid },
    visual: {
      role: prop.role,
      image: prop.image,
      ...(prop.openImage ? { openImage: prop.openImage } : {}),
    },
    container: prop.container,
    hotspot,
  });
}

function fromFreeHotspot(
  roomId: string,
  hotspot: RoomHotspot,
): WorldObjectState {
  const ui = hotspot.kind === "ui";
  const carryable = isCarryableHotspot(hotspot);
  return finish({
    profile: hotspot.profile,
    id: hotspot.id,
    name: hotspot.prompt || hotspot.id,
    roomId,
    x: hotspot.x,
    y: hotspot.y,
    mobility: carryable ? "carryable" : "fixed",
    affordances: ui
      ? ["examine", "activate"]
      : carryable
        ? CARRY_AFFORDANCES
        : LOOK_AFFORDANCES,
    body: ui ? null : carryable ? { w: 1, h: 1, solid: false } : null,
    visual: { role: null, image: null },
    hotspot,
  });
}

function fromUnpairedProp(roomId: string, prop: RoomProp): WorldObjectState {
  return finish({
    profile: prop.profile,
    id: prop.id,
    name: prop.id,
    roomId,
    x: prop.x,
    y: prop.y,
    mobility: "fixed",
    affordances: LOOK_AFFORDANCES,
    body: { w: prop.w, h: prop.h, solid: prop.solid },
    visual: {
      role: prop.role,
      image: prop.image,
      ...(prop.openImage ? { openImage: prop.openImage } : {}),
    },
    container: prop.container,
    hotspot: null,
  });
}

function fromInterest(interest: MigratableInterest): WorldObjectState {
  return finish({
    profile: { kind: "portable" },
    id: interest.id,
    name: interest.name,
    roomId: interest.roomId,
    x: interest.x,
    y: interest.y,
    mobility: "carryable",
    affordances: CARRY_AFFORDANCES,
    body: { w: 1, h: 1, solid: interest.solid },
    visual: { role: null, image: null },
    hotspot: null,
    clueId: interest.clueId,
    holdsShardId: interest.holdsShardId,
    sensorySeed: interest.sensorySeed,
  });
}

function finish(input: {
  profile?: PhysicalProfile;
  id: string;
  name: string;
  roomId: string;
  x: number;
  y: number;
  mobility: ObjectMobility;
  affordances: ObjectAffordance[];
  body: WorldObjectState["body"];
  visual: WorldObjectState["visual"];
  hotspot: RoomHotspot | null;
  container?: RoomProp["container"];
  clueId?: string | null;
  holdsShardId?: string | null;
  sensorySeed?: string | null;
}): WorldObjectState {
  const hotspot = input.hotspot;
  const compiled = input.profile ? compilePhysicalProfile(input.profile) : null;
  const affordances = [...(compiled?.affordances ?? input.affordances)];
  if (input.container) affordances.push("open", "close", "empty");
  const tags = hotspot?.kind === "clue" ? ["clue"] : [];
  if (input.container) tags.push("container");
  if (compiled) tags.push(...compiled.tags);
  return {
    ...(input.profile ? { profile: structuredClone(input.profile) } : {}),
    id: input.id,
    name: input.name,
    location: {
      kind: "room",
      roomId: input.roomId,
      x: input.x,
      y: input.y,
    },
    mobility: compiled?.mobility ?? input.mobility,
    affordances: [...new Set(affordances)],
    body: input.body,
    visual: { ...input.visual },
    interaction: hotspot
      ? {
          reach: hotspot.reach,
          prompt: hotspot.prompt,
          refusal: hotspot.refusal,
        }
      : null,
    state: {
      ...(input.container ? { open: input.container === "open" } : {}),
      ...compiled?.state,
    },
    tags: [...new Set(tags)],
    clueId: input.clueId ?? hotspot?.clueId ?? null,
    holdsShardId: input.holdsShardId ?? null,
    sensorySeed: input.sensorySeed ?? null,
    once: hotspot?.once ?? false,
    dwellMs: hotspot?.dwellMs ?? null,
    keyId: null,
    hotspotKind: hotspot?.kind ?? null,
    uiAction: hotspot?.kind === "ui" ? hotspot.action : null,
  };
}
