/**
 * Rooms laid on a grid, walked as one country.
 *
 * A door on a shared edge is an opening in the wall, not a warp. Player coordinates
 * are world pixels: origin of the room plus the local position. Lifts and puzzle
 * doors still cut, because they do not share an edge with where they come out.
 */

import {
  cellAt,
  isSolidCell,
  isWalkableCell,
  rectBlocks,
  type Box,
} from "./roomGrid";
import type { RoomDoor } from "./room";

export interface PlacedRoom {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  originX: number;
  originY: number;
  cells: readonly string[];
  props: readonly {
    x: number;
    y: number;
    w: number;
    h: number;
    solid: boolean;
  }[];
  doors: readonly RoomDoor[];
}

export function originX(room: { originX?: number }): number {
  return room.originX ?? 0;
}

export function originY(room: { originY?: number }): number {
  return room.originY ?? 0;
}

/** True when at least one room has been placed off the origin — a street map. */
export function isStreetWorld(
  rooms: readonly { originX?: number; originY?: number }[],
): boolean {
  return rooms.some((room) => originX(room) !== 0 || originY(room) !== 0);
}

export function toLocalPixels(
  room: { originX?: number; originY?: number; tileSize: number },
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  const size = room.tileSize;
  return {
    x: worldX - originX(room) * size,
    y: worldY - originY(room) * size,
  };
}

export function toWorldPixels(
  room: { originX?: number; originY?: number; tileSize: number },
  localX: number,
  localY: number,
): { x: number; y: number } {
  const size = room.tileSize;
  return {
    x: localX + originX(room) * size,
    y: localY + originY(room) * size,
  };
}

export function worldBounds(rooms: readonly PlacedRoom[]): {
  w: number;
  h: number;
} {
  let w = 1;
  let h = 1;
  for (const room of rooms) {
    w = Math.max(w, originX(room) + room.width);
    h = Math.max(h, originY(room) + room.height);
  }
  return { w, h };
}

function rangesOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  return a0 < b1 && b0 < a1;
}

/** Whether two rooms sit on neighbouring cells of the street grid. */
export function originsShareEdge(a: PlacedRoom, b: PlacedRoom): boolean {
  const ax = originX(a);
  const ay = originY(a);
  const bx = originX(b);
  const by = originY(b);
  const east =
    ax + a.width === bx && rangesOverlap(ay, ay + a.height, by, by + b.height);
  const west =
    bx + b.width === ax && rangesOverlap(ay, ay + a.height, by, by + b.height);
  const south =
    ay + a.height === by && rangesOverlap(ax, ax + a.width, bx, bx + b.width);
  const north =
    by + b.height === ay && rangesOverlap(ax, ax + a.width, bx, bx + b.width);
  return east || west || south || north;
}

function doorOnSharedEdge(
  from: PlacedRoom,
  door: RoomDoor,
  to: PlacedRoom,
): boolean {
  const fromX = originX(from);
  const fromY = originY(from);
  const toX = originX(to);
  const toY = originY(to);
  if (fromX + from.width === toX) {
    return door.x + door.w >= from.width - 1;
  }
  if (toX + to.width === fromX) {
    return door.x <= 0;
  }
  if (fromY + from.height === toY) {
    return door.y + door.h >= from.height - 1;
  }
  if (toY + to.height === fromY) {
    return door.y <= 1;
  }
  return false;
}

/**
 * A door you walk through into the next room's floor, without a cut.
 *
 * Lifts, stairs, rifts, and puzzle doors that dump you somewhere they do not
 * physically touch still warp.
 */
export function isContinuousDoor(
  from: PlacedRoom,
  door: RoomDoor,
  to: PlacedRoom | undefined,
): boolean {
  if (!to) return false;
  if (door.threshold !== "door") return false;
  if (!originsShareEdge(from, to)) return false;
  return doorOnSharedEdge(from, door, to);
}

/** Rooms that occupy this world tile, stacked floors included. */
export function roomsAtWorldTile(
  rooms: readonly PlacedRoom[],
  tx: number,
  ty: number,
): PlacedRoom[] {
  return rooms.filter((room) => {
    const x = tx - originX(room);
    const y = ty - originY(room);
    return x >= 0 && y >= 0 && x < room.width && y < room.height;
  });
}

/**
 * Which floor occupies an origin. Stacked rooms (hotel lobby vs pool) share a
 * cell; the one the walker is in wins, otherwise the lowest level.
 */
export function occupantAt(
  rooms: readonly (PlacedRoom & { level?: number })[],
  originKey: string,
  currentId: string,
): PlacedRoom | undefined {
  const [ox, oy] = originKey.split(",").map(Number);
  const stacked = rooms.filter(
    (room) => originX(room) === ox && originY(room) === oy,
  );
  if (stacked.length === 0) return undefined;
  const current = stacked.find((room) => room.id === currentId);
  if (current) return current;
  return stacked.reduce((best, room) =>
    (room.level ?? 0) < (best.level ?? 0) ? room : best,
  );
}

export function originKeyOf(room: {
  originX?: number;
  originY?: number;
}): string {
  return `${originX(room)},${originY(room)}`;
}

export function pickRoomAtTile(
  rooms: readonly (PlacedRoom & { level?: number })[],
  tx: number,
  ty: number,
  currentId: string,
): PlacedRoom | undefined {
  const covering = roomsAtWorldTile(rooms, tx, ty);
  if (covering.length === 0) return undefined;
  const current = covering.find((room) => room.id === currentId);
  if (current) return current;
  const key = originKeyOf(covering[0]!);
  return occupantAt(rooms, key, currentId);
}

export function blockedInWorld(
  rooms: readonly (PlacedRoom & { level?: number })[],
  currentId: string,
  box: Box,
  tileSize: number,
): boolean {
  const halfX = box.width / 2;
  const halfY = box.height / 2;
  const minX = Math.floor((box.x - halfX) / tileSize);
  const maxX = Math.floor((box.x + halfX - 0.001) / tileSize);
  const minY = Math.floor((box.y - halfY) / tileSize);
  const maxY = Math.floor((box.y + halfY - 0.001) / tileSize);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const room = pickRoomAtTile(rooms, tx, ty, currentId);
      if (!room) return true;
      const lx = tx - originX(room);
      const ly = ty - originY(room);
      if (isSolidCell(cellAt(room, lx, ly))) return true;
      if (rectBlocks(room.props, lx, ly)) return true;
    }
  }
  return false;
}

export function roomContainingPlayer(
  rooms: readonly (PlacedRoom & { id: string; tileSize: number })[],
  worldX: number,
  worldY: number,
  currentId: string,
): PlacedRoom | undefined {
  const size = rooms[0]?.tileSize ?? 16;
  const tx = Math.floor(worldX / size);
  const ty = Math.floor(worldY / size);
  const room = pickRoomAtTile(rooms, tx, ty, currentId);
  if (!room) return undefined;
  const lx = tx - originX(room);
  const ly = ty - originY(room);
  if (!isWalkableCell(cellAt(room, lx, ly))) return undefined;
  return room;
}

export function streetRoomsToShow(
  rooms: readonly (PlacedRoom & { id: string; level?: number })[],
  currentId: string,
): PlacedRoom[] {
  const seen = new Set<string>();
  const out: PlacedRoom[] = [];
  const current = rooms.find((room) => room.id === currentId);
  if (current) {
    out.push(current);
    seen.add(originKeyOf(current));
  }
  for (const room of rooms) {
    const key = originKeyOf(room);
    if (seen.has(key)) continue;
    const occupant = occupantAt(rooms, key, currentId);
    if (!occupant) continue;
    seen.add(key);
    out.push(occupant);
  }
  return out;
}
