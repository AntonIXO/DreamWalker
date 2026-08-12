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

import type { Rect, Room } from "../../shared/dream";
import {
  TERRAINS,
  type MapPatch,
  type TerrainName,
} from "../../shared/map-patch";
import type { DoorTypeName } from "../../shared/tilecodes";
import {
  Tile,
  doorTile,
  isDoorTile,
  isFloorTile,
  isLedgeTile,
} from "../../shared/tilecodes";
import { makeRng } from "../../shared/rng";
import { buildDoorIndex, doorTiles, type WorldState } from "./world";

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

  for (let y = rect.y + 2; y < rect.y + rect.h - 2; y++) {
    for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
      const index = y * world.width + x;
      if (movable.has(world.tiles[index]!)) world.tiles[index] = base;
    }
  }
  for (let y = rect.y + 2; y < rect.y + rect.h - 2; y++) {
    for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
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
      const current = world.tiles[index]!;
      if (!isFloorTile(current)) continue;
      before.push({ index, tile: current });
      world.tiles[index] = tile;
    }
  }

  if (before.length === 0) return refuse("nothing there to change");

  if (!stillCrossable(world)) {
    for (const { index, tile: original } of before) world.tiles[index] = original;
    return refuse("would cut the dream in half");
  }

  return {
    ok: true,
    affectedRooms: [roomId],
    note: "Что-то выросло там, где ничего не было.",
  };
}

/**
 * Can the sanitar still walk from where they arrive to everywhere that matters?
 *
 * Walked over tiles rather than over the mission graph, because terrain can wall a place
 * off without touching a single gate — which is precisely the failure `growTerrain` can
 * cause and `sealDoor` cannot.
 */
function stillCrossable(world: WorldState): boolean {
  const { spawn } = world.artifact.map;
  const seen = new Uint8Array(world.tiles.length);
  const start = spawn.y * world.width + spawn.x;
  const stack = [start];
  seen[start] = 1;

  const passable = (index: number): boolean => {
    const tile = world.tiles[index]!;
    return isFloorTile(tile) || isDoorTile(tile) || isLedgeTile(tile);
  };

  while (stack.length > 0) {
    const current = stack.pop()!;
    const x = current % world.width;
    const y = Math.floor(current / world.width);
    const push = (index: number): void => {
      if (seen[index] === 1 || !passable(index)) return;
      seen[index] = 1;
      stack.push(index);
    };
    if (x > 0) push(current - 1);
    if (x < world.width - 1) push(current + 1);
    if (y > 0) push(current - world.width);
    if (y < world.height - 1) push(current + world.width);

    const warp = world.warpAt.get(`${x},${y}`);
    if (warp) {
      const through = warp.toY * world.width + warp.toX;
      if (seen[through] !== 1) {
        seen[through] = 1;
        stack.push(through);
      }
    }
  }

  return world.rooms
    .filter((room) => room.kind === "room" && room.region !== "interior")
    .every((room) => {
      for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
        for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
          if (seen[y * world.width + x] === 1) return true;
        }
      }
      return false;
    });
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
