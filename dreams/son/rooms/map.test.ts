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
import { rectsOverlap } from "../../../src/shared/rect";
import { cellAt, rectBlocks } from "../../../src/shared/roomGrid";

/**
 * Where you can get to on foot.
 *
 * Rifts are deliberately excluded: they are extra створы laid over the streets, and the
 * map has to stay crossable without them. If a rift ever became the only way somewhere,
 * a single `retargetDoor` from the sleeper would strand the player there.
 */
function reachable(
  rooms: ReturnType<typeof allRooms>,
  spawn: string,
  { throughRifts = false }: { throughRifts?: boolean } = {},
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
      if (!throughRifts && door.threshold === "rift") continue;
      if (doorIsUsable(room, door)) queue.push(door.toRoomId);
    }
  }
  return seen;
}

describe("the street map", () => {
  const rooms = allRooms();
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const spawn = "19-dvor-i-oranzhevye-lavochki";

  test("rifts come out of the meta-spaces and land on real rooms", () => {
    const rifts = rooms.flatMap((room) =>
      room.doors
        .filter((door) => door.threshold === "rift")
        .map((door) => ({ room, door })),
    );
    expect(rifts.length).toBeGreaterThan(0);
    for (const { room, door } of rifts) {
      // §4.1 keeps the illogic in the destination, not in the threshold: a rift is a
      // doorway that comes out where it should not, authored under the meta-spaces.
      expect(room.id).toMatch(/^m\d+-/);
      expect(byId.has(door.toRoomId)).toBe(true);
      expect(door.toEntryId).toBe("default");
    }
  });

  test("a rift never sits on a street doorway or a solid thing", () => {
    for (const room of rooms) {
      for (const door of room.doors) {
        if (door.threshold !== "rift") continue;
        const others = room.doors.filter((other) => other.id !== door.id);
        expect(others.some((other) => rectsOverlap(door, other))).toBe(false);
        for (let y = door.y; y < door.y + door.h; y++) {
          for (let x = door.x; x < door.x + door.w; x++) {
            expect(rectBlocks(room.props, x, y)).toBe(false);
            // Never punched: a rift stays set into the wall it is pressed into.
            expect(cellAt(room, x, y)).not.toBe("_");
          }
        }
      }
    }
  });

  test("the streets carry the map on their own, without a single rift", () => {
    const onFoot = reachable(rooms, spawn);
    const withRifts = reachable(rooms, spawn, { throughRifts: true });
    const walkable = rooms.filter(
      (room) => room.id === spawn || room.doors.length > 0,
    );
    expect(walkable.every((room) => onFoot.has(room.id))).toBe(true);
    expect(withRifts.size).toBe(onFoot.size);
  });

  test("the wardrobe's felt-tip opens onto the pond — `rooms-meta.md` М9", () => {
    const shkaf = byId.get("m9-shkaf")!;
    const pond = shkaf.doors.find((door) => door.id === "m9-shkaf--to-pond");
    expect(pond?.toRoomId).toBe("m6-krugi-vokrug-pruda");
    expect(pond?.threshold).toBe("rift");
    const shop = shkaf.doors.find((door) => door.id === "m9-shkaf--to-shop");
    expect(shop?.toRoomId).toBe("05-shesterochka");
    expect(shop?.threshold).toBe("rift");
  });

  test("the frozen carrot's rifts land where rooms-meta sent them — М10", () => {
    const kitchen = byId.get("m10-zamorozhennaia-morkovka")!;
    const rm = kitchen.doors.find(
      (door) => door.id === "m10-zamorozhennaia-morkovka--to-rm",
    );
    expect(rm?.toRoomId).toBe("m7-rm-rf");
    expect(rm?.threshold).toBe("rift");
    const clinic = kitchen.doors.find(
      (door) => door.id === "m10-zamorozhennaia-morkovka--to-clinic",
    );
    expect(clinic?.toRoomId).toBe("14-poliklinika-v-kaluge");
    expect(clinic?.threshold).toBe("rift");
  });

  test("the corridor of days keeps its numbered doors as rifts, so one can move", () => {
    const corridor = byId.get("m8-5854")!;
    const days = corridor.doors.filter((door) =>
      door.id.startsWith("m8-5854--day-"),
    );
    expect(days).toHaveLength(8);
    expect(days.every((door) => door.threshold === "rift")).toBe(true);
    expect(days.every((door) => door.toRoomId === "m8-den")).toBe(true);
  });

  test("the pond does not let go until the third approach", () => {
    const pond = byId.get("m6-krugi-vokrug-pruda")!;
    const exit = pond.doors.find(
      (door) => door.id === "m6-krugi-vokrug-pruda--exit",
    );
    expect(exit).toBeDefined();
    // Sealed is a lock policy, not geometry: the створ is there and refuses.
    expect(exit!.type).toBe("sealed");
    expect(exit!.threshold).toBe("rift");
    expect(exit!.toRoomId).toBe("19-dvor-i-oranzhevye-lavochki");
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

  test("generated streets do not scatter room-object sheets as loot", () => {
    const images = rooms.flatMap((room) =>
      isGeneratedRoom(room.id) ? room.props.filter((prop) => prop.image) : [],
    );
    expect(images).toEqual([]);
  });

  test("every catalogue id that exists is on the grid or the hotel lift", () => {
    for (const room of rooms) {
      if (room.id === "07-bassein-i-odnostoronnii-lift") continue;
      if (isGeneratedRoom(room.id)) continue;
      expect(STREET_CELLS[room.id]).toBeDefined();
    }
  });
});
