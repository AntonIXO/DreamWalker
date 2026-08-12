/**
 * The only writer to the live world.
 *
 * Everything the sleeper does to the dream arrives here as a `MapPatch` and goes
 * through `applyPatch`. Funnelling it means there is exactly one place that has to keep
 * the tile grid, the door list and the mission graph agreeing with each other — and
 * exactly one place enforcing structural integrity. Revision 2 deliberately removed a
 * runtime solvability guarantee: the starting artifact is connected, but the defending
 * mind may make a later cycle impossible. Keeping ids, tiles and indexes coherent is
 * engine work; deciding whether a route should survive is the sleeper's prompt.
 */

import { decodeTiles, type Rect, type Room } from "../../shared/dream";
import type { DreamPopulation, InterestSeed } from "../../shared/ai";
import {
  TERRAINS,
  type MapPatch,
  type TerrainName,
} from "../../shared/map-patch";
import type { DoorTypeName } from "../../shared/tilecodes";
import { Tile, doorTile, isFloorTile } from "../../shared/tilecodes";
import { makeRng } from "../../shared/rng";
import {
  buildDoorIndex,
  cloneFigureState,
  doorTiles,
  type FigureState,
  type InterestState,
  type WorldState,
} from "./world";

export type { MapPatch } from "../../shared/map-patch";

export interface PatchResult {
  ok: boolean;
  /** Why it was refused. Shown in the debug patch log, never to the player. */
  refusal?: string;
  /** Rooms whose geometry changed and must be redrawn. */
  affectedRooms: string[];
  /** A line for the journal, when the player could plausibly notice. */
  note?: string;
}

const refuse = (refusal: string): PatchResult => ({
  ok: false,
  refusal,
  affectedRooms: [],
});

function floorPosition(
  world: WorldState,
  roomId: string,
  seed: string,
  occupied: ReadonlySet<string>,
): { x: number; y: number } | null {
  const room = world.roomById.get(roomId);
  if (!room || room.kind !== "room") return null;
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = room.rect.y + 2; y < room.rect.y + room.rect.h - 2; y++) {
    for (let x = room.rect.x + 2; x < room.rect.x + room.rect.w - 2; x++) {
      if (!isFloorTile(world.tiles[y * world.width + x] ?? Tile.VOID)) continue;
      if (occupied.has(`${x},${y}`)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return null;
  return makeRng(seed).pick(candidates);
}

function profileState(
  world: WorldState,
  profile: DreamPopulation["figures"][number],
  occupied: Set<string>,
): FigureState | null {
  const authored = world.artifact.figures.find(
    (figure) => figure.id === profile.id,
  );
  const authoredUsable =
    authored?.roomId === profile.homeRoomId &&
    isFloorTile(
      world.tiles[authored.y * world.width + authored.x] ?? Tile.VOID,
    ) &&
    !occupied.has(`${authored.x},${authored.y}`);
  const position = authoredUsable
    ? { x: authored.x, y: authored.y }
    : floorPosition(
        world,
        profile.homeRoomId,
        `figure:${profile.id}`,
        occupied,
      );
  if (!position) return null;
  occupied.add(`${position.x},${position.y}`);
  const first = profile.agenda.find((stop) => stop.phase === "early");
  return {
    id: profile.id,
    name: profile.name,
    archetypeId: profile.archetypeId,
    roomId: profile.homeRoomId,
    x: position.x,
    y: position.y,
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

function placeInterestState(
  world: WorldState,
  interest: InterestSeed,
  occupied: Set<string>,
): InterestState | null {
  const position = floorPosition(
    world,
    interest.roomId,
    `interest:${interest.id}`,
    occupied,
  );
  if (!position) return null;
  const index = position.y * world.width + position.x;
  const state: InterestState = {
    ...interest,
    ...position,
    underTile: world.tiles[index]!,
  };
  world.tiles[index] = interest.solid ? Tile.PROP_SOLID : Tile.PROP;
  occupied.add(`${position.x},${position.y}`);
  return state;
}

/** Install the model-authored population and make it the in-place cycle reset point. */
export function installPopulation(
  world: WorldState,
  population: DreamPopulation,
): PatchResult {
  // Reinstalling replaces an earlier population from the authored artifact, not the live
  // cycle. This is called before play starts, but keeping it idempotent makes debug reloads
  // safe and preserves patch.ts as the only writer to tiles.
  world.tiles = decodeTiles(
    world.artifact.map.tiles,
    world.artifact.map.width * world.artifact.map.height,
  );
  const occupied = new Set<string>([
    `${world.artifact.map.spawn.x},${world.artifact.map.spawn.y}`,
    ...world.artifact.map.warps.flatMap((warp) => [
      `${warp.x},${warp.y}`,
      `${warp.toX},${warp.toY}`,
    ]),
  ]);
  const figures = population.figures
    .map((profile) => profileState(world, profile, occupied))
    .filter((figure): figure is FigureState => figure !== null);
  const interests = population.interests
    .map((interest) => placeInterestState(world, interest, occupied))
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
  world.baseTiles = world.tiles.slice();
  world.baseFigures = figures.map(cloneFigureState);
  world.baseInterests = interests.map((interest) => ({ ...interest }));
  return {
    ok: true,
    affectedRooms: [...new Set(interests.map((interest) => interest.roomId))],
  };
}

function writeDoorTiles(
  world: WorldState,
  doorId: string,
  type: DoorTypeName,
): void {
  const door = world.doors.find((d) => d.id === doorId);
  if (!door) return;
  const tile = doorTile(type);
  for (const position of doorTiles(door)) {
    if (
      position.x < 0 ||
      position.y < 0 ||
      position.x >= world.width ||
      position.y >= world.height
    ) {
      continue;
    }
    world.tiles[position.y * world.width + position.x] = tile;
  }
}

function roomsTouchingDoor(world: WorldState, doorId: string): string[] {
  const door = world.doors.find((d) => d.id === doorId);
  if (!door) return [];
  // The door sits in one room's wall, but the corridor beside it is drawn by another
  // container, so refresh both sides.
  const rooms = new Set<string>([door.fromRoomId]);
  for (const position of doorTiles(door)) {
    const index = world.roomIndex[position.y * world.width + position.x];
    if (index !== undefined && index >= 0) rooms.add(world.rooms[index]!.id);
  }
  return [...rooms];
}

function sealDoor(world: WorldState, doorId: string): PatchResult {
  const door = world.doors.find((d) => d.id === doorId);
  if (!door) return refuse(`no door ${doorId}`);
  if (door.type === "sealed") return refuse("already sealed");

  world.sealHistory.set(doorId, door.type);
  door.type = "sealed";
  writeDoorTiles(world, doorId, "sealed");
  world.doorAt = buildDoorIndex(world.doors);

  return {
    ok: true,
    affectedRooms: roomsTouchingDoor(world, doorId),
    note: "Где-то закрылся проход.",
  };
}

function openDoor(world: WorldState, doorId: string): PatchResult {
  const door = world.doors.find((d) => d.id === doorId);
  if (!door) return refuse(`no door ${doorId}`);

  const previous = world.sealHistory.get(doorId) ?? "open";
  if (door.type !== "sealed") return refuse("that door is not sealed");

  door.type = previous;
  world.sealHistory.delete(doorId);
  writeDoorTiles(world, doorId, previous);
  world.doorAt = buildDoorIndex(world.doors);

  return {
    ok: true,
    affectedRooms: roomsTouchingDoor(world, doorId),
    note: "Что-то снова открылось.",
  };
}

function retypeDoor(
  world: WorldState,
  doorId: string,
  to: DoorTypeName,
): PatchResult {
  const door = world.doors.find((d) => d.id === doorId);
  if (!door) return refuse(`no door ${doorId}`);
  if (to === "sealed") return refuse("use sealDoor for that");
  if (door.type === to) return refuse("no change");
  door.type = to;
  writeDoorTiles(world, doorId, to);
  world.doorAt = buildDoorIndex(world.doors);

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
  if (room.kind !== "room") return refuse("figures do not stand in corridors");
  if (figure.roomId === toRoomId) return refuse("already there");

  const rng = makeRng(`${figureId}:${toRoomId}:${figure.revision}`);
  const centreX = room.rect.x + Math.floor(room.rect.w / 2);
  const centreY = room.rect.y + Math.floor(room.rect.h / 2);

  for (let attempt = 0; attempt < 40; attempt++) {
    const spread = 1 + Math.floor(attempt / 8);
    const x = centreX + rng.int(-spread, spread);
    const y = centreY + rng.int(-spread, spread);
    // Anything you could stand on. Outdoors that is grass and paths, indoors it is floor;
    // enumerating the codes here is how the old version quietly stopped working when the
    // world became a world.
    if (!isFloorTile(world.tiles[y * world.width + x] ?? 0)) continue;

    const from = figure.roomId;
    figure.roomId = toRoomId;
    figure.x = x;
    figure.y = y;
    figure.revision++;
    return {
      ok: true,
      affectedRooms: [from, toRoomId],
      note: `${figure.name} больше не там, где был.`,
    };
  }

  return refuse("nowhere to stand in that room");
}

function removeInterest(world: WorldState, interestId: string): PatchResult {
  const index = world.interests.findIndex(
    (interest) => interest.id === interestId,
  );
  if (index < 0) return refuse(`no interest ${interestId}`);
  const interest = world.interests[index]!;
  world.tiles[interest.y * world.width + interest.x] = interest.underTile;
  world.interests.splice(index, 1);
  return {
    ok: true,
    affectedRooms: [interest.roomId],
    note: `${interest.name} исчезло, пока ты не смотрел.`,
  };
}

function moveInterest(
  world: WorldState,
  interestId: string,
  toRoomId: string,
): PatchResult {
  const interest = world.interests.find(
    (candidate) => candidate.id === interestId,
  );
  if (!interest) return refuse(`no interest ${interestId}`);
  if (interest.roomId === toRoomId) return refuse("already there");
  const occupied = new Set([
    ...world.figures.map(
      (figure) => `${Math.round(figure.x)},${Math.round(figure.y)}`,
    ),
    ...world.interests
      .filter((candidate) => candidate.id !== interestId)
      .map((candidate) => `${candidate.x},${candidate.y}`),
  ]);
  const position = floorPosition(
    world,
    toRoomId,
    `move-interest:${interestId}:${toRoomId}`,
    occupied,
  );
  if (!position) return refuse("nowhere to place interest");

  const fromRoomId = interest.roomId;
  world.tiles[interest.y * world.width + interest.x] = interest.underTile;
  const index = position.y * world.width + position.x;
  interest.roomId = toRoomId;
  interest.x = position.x;
  interest.y = position.y;
  interest.underTile = world.tiles[index]!;
  world.tiles[index] = interest.solid ? Tile.PROP_SOLID : Tile.PROP;
  return {
    ok: true,
    affectedRooms: [fromRoomId, toRoomId],
    note: `${interest.name} теперь лежит в другом месте.`,
  };
}

function placeInterest(world: WorldState, seed: InterestSeed): PatchResult {
  if (world.interests.some((interest) => interest.id === seed.id))
    return refuse(`interest ${seed.id} already exists`);
  const occupied = new Set([
    ...world.figures.map(
      (figure) => `${Math.round(figure.x)},${Math.round(figure.y)}`,
    ),
    ...world.interests.map((interest) => `${interest.x},${interest.y}`),
  ]);
  const state = placeInterestState(world, seed, occupied);
  if (!state) return refuse("nowhere to place interest");
  world.interests.push(state);
  return {
    ok: true,
    affectedRooms: [seed.roomId],
    note: `Появилось что-то новое: ${seed.name}.`,
  };
}

function relocateShard(
  world: WorldState,
  shardId: string,
  toFigureId: string,
): PatchResult {
  const target = world.figures.find((f) => f.id === toFigureId);
  if (!target) return refuse(`no figure ${toFigureId}`);
  if (target.holdsShardId === shardId) return refuse("already held there");
  if (target.holdsShardId !== null)
    return refuse("that figure is already carrying something");

  const previous = world.figures.find((f) => f.holdsShardId === shardId);
  if (previous) {
    previous.holdsShardId = null;
    previous.revision++;
  }
  target.holdsShardId = shardId;
  target.revision++;

  // Nothing about the map changed — only who knows what. §2: killed the carrier and
  // the knowledge surfaces elsewhere, deeper and dearer.
  return {
    ok: true,
    affectedRooms: [],
    note: "Кто-то теперь знает то, чего не знал.",
  };
}

function retileRoom(
  world: WorldState,
  roomId: string,
  salt: number,
): PatchResult {
  const room = world.roomById.get(roomId);
  if (!room) return refuse(`no room ${roomId}`);
  if (room.kind !== "room")
    return refuse("corridors have nothing to rearrange");

  const rng = makeRng(`${roomId}:${salt}`);
  const { rect } = room;

  // Only what grows on the ground moves. The ground itself, the treeline, the water and
  // every route mouth stay exactly where they were, because a place whose exits wandered
  // would be a different place and not a rearranged one — and §6 promises the way through
  // survives every beat.
  const indoors = room.region === "interior";
  const base = indoors ? Tile.FLOOR : Tile.GRASS;
  const light = indoors ? Tile.PROP : Tile.GRASS_TALL;
  const heavy = indoors ? Tile.PROP_SOLID : Tile.FLOWERS;

  const movable = new Set<number>([light, heavy, base]);
  const interestTiles = new Set(
    world.interests.map((interest) => `${interest.x},${interest.y}`),
  );

  for (let y = rect.y + 2; y < rect.y + rect.h - 2; y++) {
    for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
      if (interestTiles.has(`${x},${y}`)) continue;
      const index = y * world.width + x;
      if (movable.has(world.tiles[index]!)) world.tiles[index] = base;
    }
  }
  for (let y = rect.y + 2; y < rect.y + rect.h - 2; y++) {
    for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
      if (interestTiles.has(`${x},${y}`)) continue;
      const index = y * world.width + x;
      if (world.tiles[index] !== base) continue;
      if (!rng.chance(indoors ? 0.07 : 0.2)) continue;
      world.tiles[index] = rng.chance(0.35) ? heavy : light;
    }
  }

  return {
    ok: true,
    affectedRooms: [roomId],
    note: indoors
      ? "В комнате что-то переставили."
      : "Здесь что-то выросло не там, где росло.",
  };
}

function swapRooms(world: WorldState, aId: string, bId: string): PatchResult {
  const a = world.roomById.get(aId);
  const b = world.roomById.get(bId);
  if (!a || !b) return refuse("one of those rooms does not exist");
  if (a.kind !== "room" || b.kind !== "room") return refuse("only rooms swap");
  if (a.rect.w !== b.rect.w || a.rect.h !== b.rect.h)
    return refuse("rooms are different sizes");
  if (aId === bId) return refuse("no change");
  const aChamber = world.chamberByRoomId.get(aId);
  const bChamber = world.chamberByRoomId.get(bId);
  const allowedAt = (roomId: string, chamber: typeof aChamber): boolean =>
    !chamber ||
    chamber.eligibleRoomIds.length === 0 ||
    chamber.eligibleRoomIds.includes(roomId);
  if (!allowedAt(bId, aChamber) || !allowedAt(aId, bChamber)) {
    return refuse("an authored chamber is not eligible for that slot");
  }

  // Interiors only. The wall ring and every doorway in it stay where they are, so the
  // mission graph is untouched and connectivity cannot break — what changes is what you
  // find when you walk in.
  for (let dy = 1; dy < a.rect.h - 1; dy++) {
    for (let dx = 1; dx < a.rect.w - 1; dx++) {
      const ia = (a.rect.y + dy) * world.width + a.rect.x + dx;
      const ib = (b.rect.y + dy) * world.width + b.rect.x + dx;
      const swap = world.tiles[ia]!;
      world.tiles[ia] = world.tiles[ib]!;
      world.tiles[ib] = swap;
    }
  }

  for (const figure of world.figures) {
    if (figure.roomId !== aId && figure.roomId !== bId) continue;
    const from = figure.roomId === aId ? a : b;
    const to = figure.roomId === aId ? b : a;
    figure.x = to.rect.x + (figure.x - from.rect.x);
    figure.y = to.rect.y + (figure.y - from.rect.y);
    figure.roomId = to.id;
    figure.revision++;
  }
  for (const interest of world.interests) {
    if (interest.roomId !== aId && interest.roomId !== bId) continue;
    const from = interest.roomId === aId ? a : b;
    const to = interest.roomId === aId ? b : a;
    interest.x = to.rect.x + (interest.x - from.rect.x);
    interest.y = to.rect.y + (interest.y - from.rect.y);
    interest.roomId = to.id;
  }

  if (aChamber) world.chamberByRoomId.set(bId, aChamber);
  else world.chamberByRoomId.delete(bId);
  if (bChamber) world.chamberByRoomId.set(aId, bChamber);
  else world.chamberByRoomId.delete(aId);
  const authoredA = world.artifact.map.rooms.find((room) => room.id === aId);
  const authoredB = world.artifact.map.rooms.find((room) => room.id === bId);
  a.name = bChamber?.name ?? authoredA?.name ?? a.name;
  b.name = aChamber?.name ?? authoredB?.name ?? b.name;

  return {
    ok: true,
    affectedRooms: [aId, bId],
    note: "Две комнаты поменялись местами.",
  };
}

/**
 * Turn part of a place into something else.
 *
 * The §6 invariant applies here exactly as it does to a sealed door, and it has to be
 * checked rather than assumed: filling a region with water can strand everything past it
 * just as surely as shutting a gate can. So the change is made, the world is walked, and
 * if the way through is gone it is put back — which is cheap, because the only thing that
 * changed is a rectangle of tiles we still have.
 *
 * Growth never touches the outer two tiles of a region. That ring is where every route
 * mouth lands, and the guarantee that it survives is what makes the check below almost
 * always pass rather than almost always fail.
 */
function growTerrain(
  world: WorldState,
  roomId: string,
  terrain: TerrainName,
  salt: number,
): PatchResult {
  const room = world.roomById.get(roomId);
  if (!room) return refuse(`no room ${roomId}`);
  if (room.region === "interior") return refuse("nothing grows indoors");

  const tile = TERRAINS[terrain];
  if (tile === undefined) return refuse(`unknown terrain ${terrain}`);

  const { rect } = room;
  const rng = makeRng(`${roomId}:${terrain}:${salt}`);
  const before: Array<{ index: number; tile: number }> = [];

  // A lobe rather than the whole region: the sleeper is changing its mind about a corner
  // of somewhere, not replacing it.
  const cx = rect.x + rng.int(4, Math.max(4, rect.w - 5));
  const cy = rect.y + rng.int(4, Math.max(4, rect.h - 5));
  const radius = rng.int(2, 4);

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < rect.x + 2 || y < rect.y + 2) continue;
      if (x >= rect.x + rect.w - 2 || y >= rect.y + rect.h - 2) continue;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const index = y * world.width + x;
      if (
        world.interests.some((interest) => interest.x === x && interest.y === y)
      )
        continue;
      const current = world.tiles[index]!;
      if (!isFloorTile(current)) continue;
      before.push({ index, tile: current });
      world.tiles[index] = tile;
    }
  }

  if (before.length === 0) return refuse("nothing there to change");

  return {
    ok: true,
    affectedRooms: [roomId],
    note: "Что-то выросло там, где ничего не было.",
  };
}

let retileSalt = 0;

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
    case "retileRoom":
      return retileRoom(world, patch.roomId, retileSalt++);
    case "swapRooms":
      return swapRooms(world, patch.aRoomId, patch.bRoomId);
    case "growTerrain":
      return growTerrain(world, patch.roomId, patch.terrain, retileSalt++);
    default:
      return refuse("unknown patch");
  }
}

/** Which rooms a patch would touch. */
export function patchTouches(patch: MapPatch, world: WorldState): string[] {
  switch (patch.kind) {
    case "sealDoor":
    case "openDoor":
    case "retypeDoor":
      return roomsTouchingDoor(world, patch.doorId);
    case "moveFigure": {
      const figure = world.figures.find((f) => f.id === patch.figureId);
      return figure ? [figure.roomId, patch.toRoomId] : [patch.toRoomId];
    }
    case "moveInterest": {
      const interest = world.interests.find(
        (candidate) => candidate.id === patch.interestId,
      );
      return interest ? [interest.roomId, patch.toRoomId] : [patch.toRoomId];
    }
    case "removeInterest": {
      const interest = world.interests.find(
        (candidate) => candidate.id === patch.interestId,
      );
      return interest ? [interest.roomId] : [];
    }
    case "placeInterest":
      return [patch.interest.roomId];
    case "retileRoom":
    case "growTerrain":
      return [patch.roomId];
    case "swapRooms":
      return [patch.aRoomId, patch.bRoomId];
    case "relocateShard":
      return [];
    default:
      return [];
  }
}

/**
 * The tile rectangle a patch would change, or null when it changes nothing you can see.
 *
 * This is what the heartbeat's "not while they are looking" rule tests against. Rooms were
 * the old unit and were always a proxy — a region is now most of a screen, so asking
 * whether the *player's region* is being patched would forbid nearly every move while
 * still allowing a change fifteen tiles away and plainly in view.
 *
 * `relocateShard` returns null on purpose: moving who knows what changes no tiles at all,
 * and it is the one thing the sleeper should always be free to do.
 */
export function patchArea(patch: MapPatch, world: WorldState): Rect | null {
  if (patch.kind === "relocateShard") return null;

  const rooms = patchTouches(patch, world)
    .map((id) => world.roomById.get(id))
    .filter((room): room is Room => room !== undefined);

  if (
    patch.kind === "sealDoor" ||
    patch.kind === "openDoor" ||
    patch.kind === "retypeDoor"
  ) {
    // A gate is a thin strip, not a region. Testing the whole region either side would
    // make a route's gate unpatchable from anywhere along it.
    const door = world.doors.find((d) => d.id === patch.doorId);
    if (!door) return null;
    const span = doorTiles(door);
    return bounds(span.map((tile) => ({ x: tile.x, y: tile.y, w: 1, h: 1 })));
  }

  if (rooms.length === 0) return null;
  return bounds(rooms.map((room) => room.rect));
}

function bounds(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}
