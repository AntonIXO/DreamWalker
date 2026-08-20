import { describe, expect, test } from "bun:test";

import { doorIsUsable } from "../../../src/shared/doors";
import { allRooms } from "./catalog";
import {
  applyStreetMap,
  isGeneratedRoom,
  neighbourOf,
  STREET_CELLS,
} from "./map";
import { EXISTING_ROOMS } from "./existing";
import { cloneRoom } from "./box";

function reachable(
  rooms: ReturnType<typeof allRooms>,
  spawn: string,
): Set<string> {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const seen = new Set<string>();
  const queue = [spawn];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const room = byId.get(id)!;
    for (const door of room.doors) {
      if (doorIsUsable(room, door)) queue.push(door.toRoomId);
    }
  }
  return seen;
}

describe("the street map", () => {
  const rooms = allRooms();
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const spawn = "19-dvor-i-oranzhevye-lavochki";

  test("has no rifts", () => {
    const rifts = rooms.flatMap((room) =>
      room.doors.filter((door) => door.threshold === "rift"),
    );
    expect(rifts).toEqual([]);
  });

  test("the courtyard opens onto the block around it", () => {
    expect(neighbourOf(spawn, "e")).toBe("01-otel-goticheskii-holl");
    expect(neighbourOf(spawn, "w")).toBe("05-shesterochka");
    expect(neighbourOf(spawn, "n")).toBe("02-shkola-kabinet-russkogo");
    expect(neighbourOf(spawn, "s")).toBe("08-kvartira-v-kotoroi-zhivut-drugie");
    const yard = byId.get(spawn)!;
    const dest = (dir: string) =>
      yard.doors.find((door) => door.id.includes(`--${dir}-`))?.toRoomId;
    expect(dest("e")?.startsWith("path-")).toBe(true);
    expect(dest("w")?.startsWith("path-")).toBe(true);
    expect(dest("n")?.startsWith("path-")).toBe(true);
    expect(dest("s")?.startsWith("path-")).toBe(true);
  });

  test("every loaded room is reachable by walking from the courtyard", () => {
    const seen = reachable(rooms, spawn);
    const walkable = rooms.filter(
      (room) => room.id === spawn || room.doors.length > 0,
    );
    expect(walkable.every((room) => seen.has(room.id))).toBe(true);
  });

  test("the hotel lift still reaches the pool, and the pool lift comes back", () => {
    const hotel = byId.get("01-otel-goticheskii-holl")!;
    const pool = byId.get("07-bassein-i-odnostoronnii-lift")!;
    const up = hotel.doors.find((door) => door.threshold === "lift")!;
    const down = pool.doors.find((door) => door.threshold === "lift")!;
    expect(up.toRoomId).toBe(pool.id);
    expect(down.toRoomId).toBe(hotel.id);
    expect(up.levelDelta).toBeGreaterThan(0);
    expect(down.levelDelta).toBeGreaterThan(0);
  });

  test("the published 29 rooms are a connected map without the extra catalogue", () => {
    const published = applyStreetMap(EXISTING_ROOMS.map(cloneRoom));
    const seen = reachable(published, spawn);
    const walkable = published.filter(
      (room) => room.id === spawn || room.doors.length > 0,
    );
    expect(walkable.every((room) => seen.has(room.id))).toBe(true);
    expect(
      published.some((room) => room.id === "07-bassein-i-odnostoronnii-lift"),
    ).toBe(true);
  });

  test("a doorway is two tiles, and a route sits in the gap", () => {
    const yard = byId.get(spawn)!;
    expect(yard.originX).toBeGreaterThan(0);
    expect(yard.camera).toBe("follow");
    const east = yard.doors.find((door) => door.id.includes("--e-"))!;
    expect(east.w).toBe(1);
    expect(east.h).toBe(2);
    expect(yard.cells[east.y]![east.x]).toBe("_");
    const road = byId.get(east.toRoomId)!;
    expect(road.tags).toContain("route");
    expect(road.graphics.backdropImage).toBeNull();
    expect(road.cells.some((row) => row.includes("p"))).toBe(true);
    expect(road.cells.some((row) => row.includes("t"))).toBe(true);
  });

  test("every catalogue id that exists is on the grid or the hotel lift", () => {
    for (const room of rooms) {
      if (room.id === "07-bassein-i-odnostoronnii-lift") continue;
      if (isGeneratedRoom(room.id)) continue;
      expect(STREET_CELLS[room.id]).toBeDefined();
    }
  });
});
