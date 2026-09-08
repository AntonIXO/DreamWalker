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
import { entryRegion, pickSlot } from "../../shared/placement";
import { padRect, type TileRect } from "../../shared/rect";
import {
  RETURNS_WHOLE,
  UNKILLABLE,
  UNLEADABLE,
  type FigureFate,
} from "../../shared/verbs";
import { clueIdForShard } from "../../shared/yield";
import type { WorldAction, WorldActionSource } from "../../shared/world-action";
import { executeWorldAction } from "../../shared/world-action-engine";
import { type ExecuteWorldAction } from "../../shared/world-reaction";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { fateOf, setFate } from "./fates";
import { makeRng } from "../../shared/rng";
import type { DoorTypeName } from "../../shared/tilecodes";
import { cloneObject } from "../../shared/world-object";
import { migrateWorldObjects } from "./object-migration";
import {
  buildDoorIndexes,
  cloneFigureState,
  rebuildObjectIndex,
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
 * so the only question is which free slot it claims.
 *
 * It used to be `rng.pick(room.figureSlots)` offset by one tile, with no check that the
 * result was walkable, inside the room, or free. Every room has exactly two slots, so
 * every clue in the dream landed on one of two tiles and could sit inside a wall or on
 * top of somebody. `pickSlot` asks `placement.ts` instead, which is the same code
 * `lord rooms --check` runs, so a placement the author cannot see is a placement the
 * build can refuse.
 */
function placeInterestState(
  world: WorldState,
  interest: InterestSeed,
  ignoreInterestId?: string,
): InterestState | null {
  const room = world.roomById.get(interest.roomId);
  if (!room || room.kind === "meta") return null;

  const taken = new Set<string>();
  for (const figure of world.figures) {
    if (figure.roomId === room.id) taken.add(figure.slotId);
  }
  for (const other of world.interests) {
    if (other.roomId !== room.id) continue;
    if (other.id === ignoreInterestId || other.id === interest.id) continue;
    if (other.slotId) taken.add(other.slotId);
  }

  const slot = pickSlot(
    room,
    room.figureSlots,
    taken,
    `interest:${interest.id}`,
  );
  if (slot) {
    return {
      ...interest,
      roomId: room.id,
      slotId: slot.id,
      x: slot.x,
      y: slot.y,
    };
  }

  // Nowhere authored is free. Rather than stack two things on one tile, fall back to any
  // reachable floor — deterministically, so a reload puts it back in the same place.
  const region = [...entryRegion(room)];
  if (region.length === 0) return null;
  const tile = makeRng(`interest-loose:${interest.id}`).pick(region);
  return {
    ...interest,
    roomId: room.id,
    slotId: null,
    x: tile % room.width,
    y: Math.floor(tile / room.width),
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

  // Order matters twice over, and both used to be wrong. The figures have to be *in* the
  // world before anything is placed, or `placeInterestState` reads the previous cycle's
  // roster and seats a clue on somebody's head; and each interest has to be pushed before
  // the next is placed, or two of them claim the same slot.
  world.figures.length = 0;
  world.figures.push(...figures);
  world.interests.length = 0;
  for (const seed of population.interests) {
    const placed = placeInterestState(world, seed);
    if (placed) world.interests.push(placed);
  }
  const interests: InterestState[] = [...world.interests];
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
  world.objects = migrateWorldObjects(world.rooms, world.interests);
  rebuildObjectIndex(world);
  world.baseObjects = world.objects.map(cloneObject);
  const affected = applyPopulationRetargets(world, population);
  for (const roomId of applyPopulationAssignments(world, population)) {
    affected.add(roomId);
  }
  for (const interest of interests) affected.add(interest.roomId);
  return {
    ok: true,
    affectedRooms: [...affected],
  };
}

/**
 * Put each place onto the room it was dealt.
 *
 * **Only the writing and the things move.** `cells`, `props`, `doors`, `entries` and the
 * slots stay exactly where a person drew them, which is the whole reason a reshuffle
 * cannot make the dream uncrossable: the sleeper deals the catalogue, and the catalogue
 * has no geometry in it. §3 — «мир не генерируется из воздуха».
 *
 * The hotspots come across because they are the room's objects — «три тысячи номерков»
 * belongs to the hotel, not to a rectangle — but they are re-settled into *this* room's
 * object slots on the way, so a place with five things landing in a room with three
 * loses two rather than stacking them in a wall.
 */
export function applyPopulationAssignments(
  world: WorldState,
  population: DreamPopulation | null = world.population,
): Set<string> {
  const affected = new Set<string>();
  const authored = new Map(world.artifact.rooms.map((room) => [room.id, room]));
  for (const { roomId, cardId } of population?.assignments ?? []) {
    const room = world.roomById.get(roomId);
    const card = authored.get(cardId);
    if (!room || !card || room.kind !== card.kind) continue;

    room.name = card.name;
    room.description = card.description;
    room.atmosphere = card.atmosphere;
    room.personality = card.personality;
    room.tags = [...card.tags];
    room.copy = { ...card.copy };
    room.revisit = { ...card.revisit };
    room.graphics = {
      ...room.graphics,
      glitchPreset: card.graphics.glitchPreset,
      // The backdrop is a picture *of that place*, so it travels with the writing. The
      // roles stay: they belong to the tiles this room is actually built from.
      backdropImage: card.graphics.backdropImage,
    };

    // The things come too, re-seated on this room's own footprints.
    const slots = room.props;
    room.hotspots = card.hotspots.slice(0, slots.length).map((hotspot, i) => ({
      ...hotspot,
      propId: slots[i]!.id,
      x: slots[i]!.x + slots[i]!.w / 2,
      y: slots[i]!.y + slots[i]!.h + 0.15,
    }));
    for (const [i, prop] of slots.entries()) {
      const from = card.props[i];
      prop.image = from?.image ?? null;
      prop.role = from?.role ?? prop.role;
    }
    affected.add(roomId);
  }
  return affected;
}

/** Re-deal this run's rifts. Safe to call after `resetWorld`. */
export function applyPopulationRetargets(
  world: WorldState,
  population: DreamPopulation | null = world.population,
): Set<string> {
  const affected = new Set<string>();
  for (const retarget of population?.retargets ?? []) {
    const result = applyPatch(world, {
      kind: "retargetDoor",
      doorId: retarget.doorId,
      toRoomId: retarget.toRoomId,
      reason: "inhabit",
    });
    if (result.ok) {
      for (const roomId of result.affectedRooms) affected.add(roomId);
    }
  }
  return affected;
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

function addInterest(world: WorldState, interest: InterestState): void {
  world.interests.push(interest);
  const object = migrateWorldObjects([], [interest])[0]!;
  world.objects.push(object);
  world.objectById.set(object.id, object);
}

function removeInterest(world: WorldState, interestId: string): PatchResult {
  const index = world.interests.findIndex((i) => i.id === interestId);
  if (index < 0) return refuse(`no interest ${interestId}`);
  const object = world.objectById.get(interestId);
  if (object && object.location.kind !== "room")
    return refuse("interest is not on the floor");
  const [removed] = world.interests.splice(index, 1);
  if (object) object.location = { kind: "removed" };
  return { ok: true, affectedRooms: [removed!.roomId] };
}

function moveInterest(
  world: WorldState,
  interestId: string,
  toRoomId: string,
): PatchResult {
  const interest = world.interests.find((i) => i.id === interestId);
  if (!interest) return refuse(`no interest ${interestId}`);
  const object = world.objectById.get(interestId);
  if (object && object.location.kind !== "room")
    return refuse("interest is not on the floor");
  const room = world.roomById.get(toRoomId);
  if (!room) return refuse(`no room ${toRoomId}`);
  if (room.kind === "meta") return refuse("nothing is found in a meta-space");
  const from =
    object?.location.kind === "room" ? object.location.roomId : interest.roomId;
  const placed = placeInterestState(world, { ...interest, roomId: toRoomId });
  if (!placed) return refuse(`nowhere to stand in ${toRoomId}`);
  interest.roomId = placed.roomId;
  interest.x = placed.x;
  interest.y = placed.y;
  interest.slotId = placed.slotId;
  if (object) {
    object.location = {
      kind: "room",
      roomId: placed.roomId,
      x: placed.x,
      y: placed.y,
    };
  }
  return { ok: true, affectedRooms: [from, toRoomId] };
}

function placeInterest(world: WorldState, seed: InterestSeed): PatchResult {
  if (
    world.interests.some((i) => i.id === seed.id) ||
    world.objectById.has(seed.id)
  ) {
    return refuse(`interest ${seed.id} already exists`);
  }
  const placed = placeInterestState(world, seed);
  if (!placed) return refuse(`nowhere to stand in ${seed.roomId}`);
  addInterest(world, placed);
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
  for (const object of world.objects) {
    if (object.holdsShardId === shardId) object.holdsShardId = null;
  }
  target.holdsShardId = shardId;
  return { ok: true, affectedRooms: [target.roomId] };
}

/**
 * A fate may move a hook. It may never delete one.
 *
 * Stated once, here, because the two halves are not obvious together. A killed carrier
 * drops what they had — that much is expected. A **broken** one drops it too, and that is
 * the load-bearing half: somebody who will never speak again is a harder wall than a
 * corpse, because nothing in the world says so. The thing slips out of the story rather
 * than out of the figure.
 *
 * The remains are an ordinary interest, which means this works end to end with no server
 * change at all: `interestHotspots` turns any interest into a `look` hotspot, `main.ts`
 * routes it to `mind.examine`, and the examine agent already computes what is available
 * from `holdsShardId`. The body's pocket is the examine path that already exists.
 *
 * §6 refuses a solvability solver and this is not one. It does not decide whether a route
 * survives; it only refuses to let a word stop existing.
 */
function dropRemains(
  world: WorldState,
  figure: FigureState,
): InterestState | null {
  if (!figure.holdsShardId) return null;
  const id = `remains:${figure.id}`;
  const already = world.interests.find((interest) => interest.id === id);
  if (already) return already;
  const placed = placeInterestState(world, {
    id,
    roomId: figure.roomId,
    name: "то, что осталось",
    sensorySeed: "Карман вывернут наружу, но не им.",
    solid: false,
    holdsShardId: figure.holdsShardId,
    clueId: clueIdForShard(figure.holdsShardId),
  });
  if (placed) addInterest(world, placed);
  return placed;
}

/**
 * A person's standing changes. The only write for every one of them.
 *
 * The refusals here duplicate `availableVerbs`, on purpose. A defensive rule that lives
 * in one place stops being enforced the first time somebody adds a second call site —
 * which is exactly why `mayYieldShard` is checked on the client and again on the server.
 */
function markFigure(
  world: WorldState,
  figureId: string,
  fate: FigureFate,
  quoted: string | null,
  cycle: number,
): PatchResult {
  const figure = world.figures.find((f) => f.id === figureId);
  if (!figure) return refuse(`no figure ${figureId}`);
  if (fate === "dead" && UNKILLABLE.has(figureId)) {
    return refuse(`${figureId} does not die here`);
  }
  if (fate === "led" && UNLEADABLE.has(figureId)) {
    return refuse(`${figureId} does not follow anybody`);
  }
  if (fateOf(world, figureId) === fate) return refuse("already so");

  const roomId = figure.roomId;
  const remains =
    fate === "dead" || fate === "broken" ? dropRemains(world, figure) : null;
  setFate(world, {
    figureId,
    fate,
    cycle,
    roomId,
    by: fate === "dead" ? "kill" : fate === "led" ? "lead" : "press",
    quoted,
    remains,
  });

  if (fate === "dead" || fate === "gone") {
    const index = world.figures.indexOf(figure);
    if (index >= 0) world.figures.splice(index, 1);
  }
  return {
    ok: true,
    affectedRooms: [roomId],
    note:
      fate === "dead" ? `${figure.name} больше не там, где был.` : undefined,
  };
}

/** Only somebody whose soul says they return, or somebody merely led away. */
function reviveFigure(
  world: WorldState,
  figureId: string,
  toRoomId: string,
): PatchResult {
  const record = world.fates.get(figureId);
  if (!record) return refuse(`${figureId} is where they were`);
  if (record.fate === "dead" && !RETURNS_WHOLE.has(figureId)) {
    return refuse("the dream does not hand people back");
  }
  const room = world.roomById.get(toRoomId);
  if (!room) return refuse(`no room ${toRoomId}`);
  if (room.kind === "meta") return refuse("a meta-space holds no figures");
  const base = world.baseFigures.find((f) => f.id === figureId);
  if (!base) return refuse(`no figure ${figureId}`);

  world.fates.delete(figureId);
  if (!world.figures.some((f) => f.id === figureId)) {
    world.figures.push(cloneFigureState({ ...base, roomId: toRoomId }));
  }
  return { ok: true, affectedRooms: [toRoomId] };
}

/**
 * The sleeper points a rift somewhere else.
 *
 * §4.1 — «комнаты соединяются без логики, но переход всегда через порог». The archway is
 * still where it was; it simply arrives somewhere else now. Repainting a floor is
 * decoration; moving where a doorway goes is the dream.
 *
 * Rifts only, and that is the load-bearing part. A staircase that could be rewired would
 * make the vertical map a lie, and the vertical map is the one thing in this dream that
 * is supposed to hold — the same reason `openDoor` is restricted to `sealHistory`.
 */
function retargetDoor(
  world: WorldState,
  doorId: string,
  toRoomId: string,
): PatchResult {
  const door = world.doorById.get(doorId);
  if (!door) return refuse(`no door ${doorId}`);
  const home = world.roomIdByDoorId.get(doorId);
  if (!home) return refuse(`door ${doorId} belongs to no room`);
  if (!world.roomById.has(toRoomId)) return refuse(`no room ${toRoomId}`);
  if (door.threshold !== "rift") {
    return refuse(`${doorId} is a ${door.threshold}, and those do not move`);
  }
  if (door.toRoomId === toRoomId && !door.toFigureId) {
    return refuse("already leads there");
  }
  door.toRoomId = toRoomId;
  door.toEntryId = null;
  door.toFigureId = null;
  return {
    ok: true,
    affectedRooms: [home],
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

export interface ApplyPatchOptions {
  execute?: ExecuteWorldAction;
  source?: WorldActionSource;
}

/**
 * Embodied equivalents of MapPatch kinds. The rest stay as sleeper/admin writers:
 * shiftWalls, retargetDoor, markFigure, reviveFigure, relocateShard, retypeDoor,
 * sealDoor, moveFigure, placeInterest — no WorldAction for those.
 *
 * moveInterest is a room-to-room object move; WorldAction has drop/take but not
 * "move this interest to another room", so it stays on the MapPatch writer.
 */
function embodiedWorldAction(patch: MapPatch): WorldAction | null {
  switch (patch.kind) {
    case "openDoor":
      return { type: "open", targetId: patch.doorId };
    case "closeHotspot":
      return { type: "close", targetId: patch.hotspotId };
    case "openHotspot":
      return { type: "open", targetId: patch.hotspotId };
    default:
      return null;
  }
}

function tryEmbodied(
  world: WorldState,
  patch: MapPatch,
  options?: ApplyPatchOptions,
): PatchResult | null {
  const action = embodiedWorldAction(patch);
  if (!action) return null;
  const execute = options?.execute ?? executeWorldAction;
  const result = execute(bindWorldMutator(world, staticPlayerPose(null)), {
    actor: { kind: "sleeper" },
    source: options?.source ?? "sleeper",
    action,
  });
  // Sleeper has no body; the engine refuses. Fall through to MapPatch writers.
  if (!result.ok) return null;
  return {
    ok: result.ok,
    refusal: result.refusal ?? undefined,
    affectedRooms: result.affectedRooms,
  };
}

export function applyPatch(
  world: WorldState,
  patch: MapPatch,
  /** Which cycle this is happening in, for the fate ledger. */
  cycle = 1,
  options?: ApplyPatchOptions,
): PatchResult {
  const embodied = tryEmbodied(world, patch, options);
  if (embodied) return embodied;
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
    case "markFigure":
      return markFigure(world, patch.figureId, patch.fate, patch.quoted, cycle);
    case "reviveFigure":
      return reviveFigure(world, patch.figureId, patch.toRoomId);
    case "retargetDoor":
      return retargetDoor(world, patch.doorId, patch.toRoomId);
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
 * Where on screen a patch would show, *before* it is applied.
 *
 * The heartbeat asks this so it can refuse anything the player can actually see (§6).
 * Format 3 compared a tile rectangle against the camera; format 4 shrank the answer to
 * "which rooms", which was right while a room was exactly one screen and becomes far too
 * coarse the moment a floor is six screens across — the sleeper would be unable to touch
 * anything on the floor you are standing on, which is most of the dream.
 *
 * So: a room id *and* a rectangle. `rect: null` means the whole room, which is the
 * honest answer for `shiftWalls` and the only case that keeps the old behaviour.
 *
 * This is deliberately **not** the same question as `PatchResult.affectedRooms`. That one
 * asks "what must be redrawn" and has to name both sides of a door; this one asks "what
 * would the player notice", and the far side of a door they are not looking through is
 * not it.
 */
export interface PatchScope {
  roomId: string;
  /** Tiles, half-open. Null means the whole room. */
  rect: TileRect | null;
}

/** A small square around a point, in tiles. */
function around(roomId: string, x: number, y: number, radius = 1): PatchScope {
  return {
    roomId,
    rect: {
      x: Math.floor(x - radius),
      y: Math.floor(y - radius),
      w: Math.ceil(radius * 2) + 1,
      h: Math.ceil(radius * 2) + 1,
    },
  };
}

/**
 * Every slot an arrival could land on.
 *
 * `moveFigure` and `placeInterestState` both pick a slot with a seeded RNG *inside*
 * `applyPatch`, so the exact destination is not knowable here. Naming every candidate is
 * conservative in the safe direction and, unlike recomputing the seed, cannot drift away
 * from the code that actually chooses.
 */
function slotScopes(world: WorldState, roomId: string): PatchScope[] {
  const room = world.roomById.get(roomId);
  if (!room) return [];
  if (room.figureSlots.length === 0) return [{ roomId, rect: null }];
  return room.figureSlots.map((slot) => around(roomId, slot.x, slot.y));
}

export function patchTouches(patch: MapPatch, world: WorldState): PatchScope[] {
  switch (patch.kind) {
    case "sealDoor":
    case "openDoor":
    case "retypeDoor":
    case "retargetDoor": {
      const door = world.doorById.get(patch.doorId);
      const home = world.roomIdByDoorId.get(patch.doorId);
      if (!door || !home) return [];
      return [{ roomId: home, rect: padRect(door, 1) }];
    }
    case "moveFigure": {
      const figure = world.figures.find((f) => f.id === patch.figureId);
      const from = figure ? [around(figure.roomId, figure.x, figure.y)] : [];
      return [...from, ...slotScopes(world, patch.toRoomId)];
    }
    case "moveInterest": {
      const interest = world.interests.find((i) => i.id === patch.interestId);
      const from = interest
        ? [around(interest.roomId, interest.x, interest.y)]
        : [];
      return [...from, ...slotScopes(world, patch.toRoomId)];
    }
    case "removeInterest": {
      const interest = world.interests.find((i) => i.id === patch.interestId);
      return interest ? [around(interest.roomId, interest.x, interest.y)] : [];
    }
    case "placeInterest":
      return slotScopes(world, patch.interest.roomId);
    // A hook changing hands has no on-screen representation whatsoever. Naming the
    // holder's room used to block a whole room for a change nobody could observe.
    case "relocateShard":
      return [];
    case "markFigure": {
      const figure = world.figures.find((f) => f.id === patch.figureId);
      return figure ? [around(figure.roomId, figure.x, figure.y)] : [];
    }
    case "reviveFigure":
      return slotScopes(world, patch.toRoomId);
    case "closeHotspot":
    case "openHotspot": {
      const room = world.roomById.get(patch.roomId);
      const hotspot = room?.hotspots.find((h) => h.id === patch.hotspotId);
      if (!hotspot) return [];
      return [around(patch.roomId, hotspot.x, hotspot.y, hotspot.reach)];
    }
    // The whole walk mask may move. This is the one kind that keeps the old answer.
    case "shiftWalls":
      return [{ roomId: patch.roomId, rect: null }];
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
