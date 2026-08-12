/**
 * The only writer to the live world.
 *
 * Everything the sleeper does to the dream arrives here as a `MapPatch` and goes through
 * `applyPatch`. Funnelling it means there is exactly one place that has to keep rooms,
 * doors, figures and indexes agreeing with each other — and exactly one place enforcing
 * structural integrity. Revision 2 deliberately removed a runtime solvability guarantee:
 * the starting artifact is connected, but the defending mind may make a later cycle
 * impossible. Keeping ids coherent is engine work; deciding whether a route should
 * survive is the sleeper's prompt.
 */

import type { DreamPopulation, InterestSeed } from "../../shared/ai";
import type { MapPatch } from "../../shared/map-patch";
import { makeRng } from "../../shared/rng";
import type { DoorTypeName } from "../../shared/tilecodes";
import {
  buildDoorIndexes,
  cloneFigureState,
  type FigureState,
  type InterestState,
  type RoomState,
  type WorldState,
} from "./world";

export type { MapPatch } from "../../shared/map-patch";

export interface PatchResult {
  ok: boolean;
  /** Why it was refused. Shown in the debug patch log, never to the player. */
  refusal?: string;
  /** Rooms whose contents changed and must be redrawn. */
  affectedRooms: string[];
  /** A line for the journal, when the player could plausibly notice. */
  note?: string;
}

const refuse = (refusal: string): PatchResult => ({
  ok: false,
  refusal,
  affectedRooms: [],
});

/**
 * A free figure slot in a room, chosen deterministically.
 *
 * Format 3 scanned the tile grid for floor. Slots are authored now, so this is a
 * filter and a seeded pick — and a room with no free slot simply refuses the patch,
 * which is a better failure than two figures standing inside each other.
 */
function freeSlot(
  room: RoomState,
  world: WorldState,
  seed: string,
  ignoreFigureId?: string,
): string | null {
  const taken = new Set(
    world.figures
      .filter(
        (figure) => figure.roomId === room.id && figure.id !== ignoreFigureId,
      )
      .map((figure) => figure.slotId),
  );
  const free = room.figureSlots.filter((slot) => !taken.has(slot.id));
  if (free.length === 0) return null;
  return makeRng(seed).pick(free).id;
}

function profileState(
  world: WorldState,
  profile: DreamPopulation["figures"][number],
  taken: Set<string>,
): FigureState | null {
  const room = world.roomById.get(profile.homeRoomId);
  if (!room || room.kind === "meta") return null;

  const authored = world.artifact.figures.find(
    (figure) => figure.id === profile.id,
  );
  const authoredUsable =
    authored?.roomId === profile.homeRoomId &&
    !taken.has(`${profile.homeRoomId}:${authored.slotId}`) &&
    room.figureSlots.some((slot) => slot.id === authored.slotId);

  const slotId = authoredUsable
    ? authored.slotId
    : (room.figureSlots.find((slot) => !taken.has(`${room.id}:${slot.id}`))
        ?.id ?? null);
  if (slotId === null) return null;
  taken.add(`${room.id}:${slotId}`);

  const slot = room.figureSlots.find((entry) => entry.id === slotId)!;
  const first = profile.agenda.find((stop) => stop.phase === "early");
  return {
    id: profile.id,
    name: profile.name,
    archetypeId: profile.archetypeId,
    roomId: profile.homeRoomId,
    slotId,
    x: slot.x,
    y: slot.y,
    holdsShardId: profile.holdsShardId,
    facing: "s",
    revision: 0,
    personality: profile.personality,
    portraitState: "neutral",
    role: profile.role,
    voice: profile.voice,
    desire: profile.desire,
    fear: profile.fear,
    taboo: profile.taboo,
    agenda: profile.agenda.map((stop) => ({ ...stop })),
    activity: first?.activity ?? "занят своим делом",
    agendaPhase: "early",
    targetX: null,
    targetY: null,
    walkWait: 1.5 + makeRng(`walk:${profile.id}`).next() * 2.5,
    walkTime: 0,
    walking: false,
  };
}

/**
 * Where an interest stands.
 *
 * There is no tile to overwrite and nothing to restore — an interest is a hotspot now,
 * so it is placed next to a free figure slot or, failing that, in the middle of the room.
 */
function placeInterestState(
  world: WorldState,
  interest: InterestSeed,
): InterestState | null {
  const room = world.roomById.get(interest.roomId);
  if (!room || room.kind === "meta") return null;
  const rng = makeRng(`interest:${interest.id}`);
  const spot = room.figureSlots.length > 0 ? rng.pick(room.figureSlots) : null;
  return {
    ...interest,
    roomId: room.id,
    x: spot ? spot.x + 1 : room.width / 2,
    y: spot ? spot.y : room.height / 2,
  };
}

/** Install the model-authored population and make it the in-place cycle reset point. */
export function installPopulation(
  world: WorldState,
  population: DreamPopulation,
): PatchResult {
  // Reinstalling replaces an earlier population from the authored artifact, not the live
  // cycle. This runs before play starts, but keeping it idempotent makes debug reloads safe.
  const taken = new Set<string>();
  const figures = population.figures
    .map((profile) => profileState(world, profile, taken))
    .filter((figure): figure is FigureState => figure !== null);
  const interests = population.interests
    .map((interest) => placeInterestState(world, interest))
    .filter((interest): interest is InterestState => interest !== null);

  world.figures.length = 0;
  world.figures.push(...figures);
  world.interests.length = 0;
  world.interests.push(...interests);
  world.population = {
    ...population,
    figures: population.figures.map((profile) => ({
      ...profile,
      agenda: profile.agenda.map((stop) => ({ ...stop })),
    })),
    interests: population.interests.map((interest) => ({ ...interest })),
    roomMoods: { ...population.roomMoods },
  };
  world.baseFigures = figures.map(cloneFigureState);
  world.baseInterests = interests.map((interest) => ({ ...interest }));
  return {
    ok: true,
    affectedRooms: [...new Set(interests.map((interest) => interest.roomId))],
  };
}

function roomsTouchingDoor(world: WorldState, doorId: string): string[] {
  const door = world.doorById.get(doorId);
  if (!door) return [];
  const home = world.roomIdByDoorId.get(doorId);
  return [...new Set([home, door.toRoomId].filter((id): id is string => !!id))];
}

function sealDoor(world: WorldState, doorId: string): PatchResult {
  const door = world.doorById.get(doorId);
  if (!door) return refuse(`no door ${doorId}`);
  if (door.type === "sealed") return refuse("already sealed");
  world.sealHistory.set(doorId, door.type);
  door.type = "sealed";
  return {
    ok: true,
    affectedRooms: roomsTouchingDoor(world, doorId),
    note: "Где-то закрылся проход.",
  };
}

/**
 * Only a door the sleeper itself shut may be reopened.
 *
 * §6 — the dream never hands back a cheaper path than the one it destroyed. Restricting
 * `openDoor` to `sealHistory` is what enforces that, rather than trusting the model to
 * remember what it did.
 */
function openDoor(world: WorldState, doorId: string): PatchResult {
  const door = world.doorById.get(doorId);
  if (!door) return refuse(`no door ${doorId}`);
  const previous = world.sealHistory.get(doorId);
  if (previous === undefined) {
    return refuse("only a door the dream sealed may be reopened");
  }
  door.type = previous;
  world.sealHistory.delete(doorId);
  return { ok: true, affectedRooms: roomsTouchingDoor(world, doorId) };
}

function retypeDoor(
  world: WorldState,
  doorId: string,
  to: DoorTypeName,
): PatchResult {
  const door = world.doorById.get(doorId);
  if (!door) return refuse(`no door ${doorId}`);
  if (to === "sealed") return sealDoor(world, doorId);
  door.type = to;
  return { ok: true, affectedRooms: roomsTouchingDoor(world, doorId) };
}

function moveFigure(
  world: WorldState,
  figureId: string,
  toRoomId: string,
): PatchResult {
  const figure = world.figures.find((f) => f.id === figureId);
  if (!figure) return refuse(`no figure ${figureId}`);
  const room = world.roomById.get(toRoomId);
  if (!room) return refuse(`no room ${toRoomId}`);
  // «Ходить можно, разговаривать не с кем» — nobody is ever in a meta-space.
  if (room.kind === "meta") return refuse("a meta-space holds no figures");
  if (figure.roomId === toRoomId) return refuse("already there");

  const slotId = freeSlot(
    room,
    world,
    `move:${figureId}:${toRoomId}:${figure.revision}`,
    figureId,
  );
  if (slotId === null) return refuse(`room ${toRoomId} has no free slot`);
  const slot = room.figureSlots.find((entry) => entry.id === slotId)!;

  const from = figure.roomId;
  figure.roomId = toRoomId;
  figure.slotId = slotId;
  figure.x = slot.x;
  figure.y = slot.y;
  figure.revision++;
  figure.targetX = null;
  figure.targetY = null;
  figure.walking = false;
  return {
    ok: true,
    affectedRooms: [from, toRoomId],
    note: `${figure.name} теперь не там, где был.`,
  };
}

function removeInterest(world: WorldState, interestId: string): PatchResult {
  const index = world.interests.findIndex((i) => i.id === interestId);
  if (index < 0) return refuse(`no interest ${interestId}`);
  const [removed] = world.interests.splice(index, 1);
  return { ok: true, affectedRooms: [removed!.roomId] };
}

function moveInterest(
  world: WorldState,
  interestId: string,
  toRoomId: string,
): PatchResult {
  const interest = world.interests.find((i) => i.id === interestId);
  if (!interest) return refuse(`no interest ${interestId}`);
  const room = world.roomById.get(toRoomId);
  if (!room) return refuse(`no room ${toRoomId}`);
  if (room.kind === "meta") return refuse("nothing is found in a meta-space");
  const from = interest.roomId;
  const placed = placeInterestState(world, { ...interest, roomId: toRoomId });
  if (!placed) return refuse(`nowhere to stand in ${toRoomId}`);
  interest.roomId = placed.roomId;
  interest.x = placed.x;
  interest.y = placed.y;
  return { ok: true, affectedRooms: [from, toRoomId] };
}

function placeInterest(world: WorldState, seed: InterestSeed): PatchResult {
  if (world.interests.some((i) => i.id === seed.id)) {
    return refuse(`interest ${seed.id} already exists`);
  }
  const placed = placeInterestState(world, seed);
  if (!placed) return refuse(`nowhere to stand in ${seed.roomId}`);
  world.interests.push(placed);
  return { ok: true, affectedRooms: [placed.roomId] };
}

function relocateShard(
  world: WorldState,
  shardId: string,
  toFigureId: string,
): PatchResult {
  const target = world.figures.find((f) => f.id === toFigureId);
  if (!target) return refuse(`no figure ${toFigureId}`);
  if (!world.artifact.shards.some((shard) => shard.id === shardId)) {
    return refuse(`no shard ${shardId}`);
  }
  if (target.holdsShardId === shardId) return refuse("already held");
  for (const figure of world.figures) {
    if (figure.holdsShardId === shardId) figure.holdsShardId = null;
  }
  for (const interest of world.interests) {
    if (interest.holdsShardId === shardId) interest.holdsShardId = null;
  }
  target.holdsShardId = shardId;
  return { ok: true, affectedRooms: [target.roomId] };
}

/**
 * The sleeper rewires where an object throws you.
 *
 * §4.1 — «комнаты соединяются без логики, но переход всегда через порог». The rope is
 * still hanging there; it simply arrives somewhere else now. This is `retileRoom`'s
 * successor and it is a far better use of a beat: repainting a floor is decoration,
 * moving where a door goes is the dream.
 */
function relink(
  world: WorldState,
  roomId: string,
  hotspotId: string,
  toRoomId: string,
): PatchResult {
  const room = world.roomById.get(roomId);
  if (!room) return refuse(`no room ${roomId}`);
  if (!world.roomById.has(toRoomId)) return refuse(`no room ${toRoomId}`);
  const hotspot = room.hotspots.find((h) => h.id === hotspotId);
  if (!hotspot) return refuse(`no hotspot ${hotspotId} in ${roomId}`);
  if (hotspot.kind !== "link" || hotspot.link === null) {
    return refuse(`${hotspotId} does not lead anywhere to begin with`);
  }
  // A refusal is authored on purpose («достать её нельзя, это проверено»); turning one
  // into a working door would undo the point of the object.
  if (hotspot.link.to === "refuse") {
    return refuse(`${hotspotId} is a refusal, not a passage`);
  }
  if (hotspot.link.to === "room" && hotspot.link.roomId === toRoomId) {
    return refuse("already leads there");
  }
  hotspot.link = { to: "room", roomId: toRoomId, entryId: null };
  return {
    ok: true,
    affectedRooms: [roomId],
    note: "Что-то ведёт не туда, куда вело.",
  };
}

/**
 * A room swaps to another of its authored walk masks.
 *
 * §13's underground halls rebuild «как камеры в Portal 2»; §17's shower shrinks a little
 * every time you pass through the door. Because every variant was authored and validated
 * to the same dimensions, the sleeper cannot accidentally produce a room nobody can cross.
 */
function shiftWalls(
  world: WorldState,
  roomId: string,
  variantId: string,
): PatchResult {
  const room = world.roomById.get(roomId);
  if (!room) return refuse(`no room ${roomId}`);
  const variant = room.cellVariants[variantId];
  if (!variant) return refuse(`room ${roomId} has no variant ${variantId}`);
  if (room.activeVariant === variantId) return refuse("already shifted");
  room.cells = [...variant];
  room.activeVariant = variantId;
  return {
    ok: true,
    affectedRooms: [roomId],
    note: "Стены стоят не так, как стояли.",
  };
}

function setHotspotClosed(
  world: WorldState,
  roomId: string,
  hotspotId: string,
  closed: boolean,
): PatchResult {
  const room = world.roomById.get(roomId);
  if (!room) return refuse(`no room ${roomId}`);
  if (!room.hotspots.some((h) => h.id === hotspotId)) {
    return refuse(`no hotspot ${hotspotId} in ${roomId}`);
  }
  if (room.closedHotspotIds.has(hotspotId) === closed) {
    return refuse(closed ? "already gone" : "already there");
  }
  if (closed) room.closedHotspotIds.add(hotspotId);
  else room.closedHotspotIds.delete(hotspotId);
  return { ok: true, affectedRooms: [roomId] };
}

export function applyPatch(world: WorldState, patch: MapPatch): PatchResult {
  switch (patch.kind) {
    case "sealDoor":
      return sealDoor(world, patch.doorId);
    case "openDoor":
      return openDoor(world, patch.doorId);
    case "retypeDoor":
      return retypeDoor(world, patch.doorId, patch.to);
    case "moveFigure":
      return moveFigure(world, patch.figureId, patch.toRoomId);
    case "moveInterest":
      return moveInterest(world, patch.interestId, patch.toRoomId);
    case "removeInterest":
      return removeInterest(world, patch.interestId);
    case "placeInterest":
      return placeInterest(world, patch.interest);
    case "relocateShard":
      return relocateShard(world, patch.shardId, patch.toFigureId);
    case "relink":
      return relink(world, patch.roomId, patch.hotspotId, patch.toRoomId);
    case "shiftWalls":
      return shiftWalls(world, patch.roomId, patch.variantId);
    case "closeHotspot":
      return setHotspotClosed(world, patch.roomId, patch.hotspotId, true);
    case "openHotspot":
      return setHotspotClosed(world, patch.roomId, patch.hotspotId, false);
    default:
      return refuse("unknown patch kind");
  }
}

/**
 * Which rooms a patch would disturb, *before* it is applied.
 *
 * The heartbeat asks this so it can refuse anything touching the room the player is
 * standing in. In format 3 this had to return a tile rectangle and compare it against
 * the camera's viewport; with discrete rooms the question is simply "which rooms", which
 * is what it always meant.
 */
export function patchTouches(patch: MapPatch, world: WorldState): string[] {
  switch (patch.kind) {
    case "sealDoor":
    case "openDoor":
    case "retypeDoor":
      return roomsTouchingDoor(world, patch.doorId);
    case "moveFigure": {
      const figure = world.figures.find((f) => f.id === patch.figureId);
      return [
        ...new Set([figure?.roomId, patch.toRoomId].filter(Boolean)),
      ] as string[];
    }
    case "moveInterest": {
      const interest = world.interests.find((i) => i.id === patch.interestId);
      return [
        ...new Set([interest?.roomId, patch.toRoomId].filter(Boolean)),
      ] as string[];
    }
    case "removeInterest": {
      const interest = world.interests.find((i) => i.id === patch.interestId);
      return interest ? [interest.roomId] : [];
    }
    case "placeInterest":
      return [patch.interest.roomId];
    case "relocateShard": {
      const figure = world.figures.find((f) => f.id === patch.toFigureId);
      return figure ? [figure.roomId] : [];
    }
    case "relink":
    case "shiftWalls":
    case "closeHotspot":
    case "openHotspot":
      return [patch.roomId];
    default:
      return [];
  }
}

/** Rebuild the door indexes after anything that could have moved a door between rooms. */
export function reindexDoors(world: WorldState): void {
  const indexes = buildDoorIndexes(world.rooms);
  world.doorById = indexes.doorById;
  world.roomIdByDoorId = indexes.roomIdByDoorId;
}
