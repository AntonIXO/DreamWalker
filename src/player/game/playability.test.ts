import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { fallbackPopulation } from "../../shared/population";
import { blockedInRoom, cellAt, isSolidCell } from "../../shared/roomGrid";
import { ScriptedMind } from "../mind/scripted";
import { findTarget } from "./interact";
import { installPopulation } from "./patch";
import { createPlayer, updatePlayer } from "./player";
import { createWorld, resolveLink } from "./world";

const artifact = validateDreamArtifact(
  JSON.parse(
    readFileSync(join(process.cwd(), "dreams/son/dream.json"), "utf8"),
  ) as unknown,
) as DreamArtifact;

describe("son is playable", () => {
  test("spawns on open floor in the courtyard with Turyshev", () => {
    const world = createWorld(artifact);
    expect(world.currentRoomId).toBe("19-dvor-i-oranzhevye-lavochki");
    expect(world.figures.some((figure) => figure.id === "turyshev")).toBe(true);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    expect(
      blockedInRoom(
        room,
        [],
        { x: player.x, y: player.y, width: 9, height: 7 },
        room.tileSize,
      ),
    ).toBe(false);
  });

  test("the intercom is a link to the apartment", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get("19-dvor-i-oranzhevye-lavochki")!;
    const intercom = room.hotspots.find((hotspot) =>
      hotspot.prompt.includes("домофон"),
    );
    expect(intercom?.link?.to).toBe("room");
    if (intercom?.link?.to === "room") {
      expect(resolveLink(world, intercom.link)?.roomId).toBe(
        "08-kvartira-v-kotoroi-zhivut-drugie",
      );
    }
  });

  test("walking the courtyard floor does not warp", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    for (let i = 0; i < 40; i++) {
      updatePlayer(player, room, world, { x: -1, y: 0 }, 1 / 30);
    }
    expect(player.enteredDoorId).toBeNull();
    expect(player.x).toBeLessThan(10 * room.tileSize);
  });

  test("the hotel floor is not a carpet of doors", () => {
    const world = createWorld(artifact);
    const hotel = world.roomById.get("01-otel-goticheskii-holl")!;
    let warpTiles = 0;
    for (let y = 2; y < hotel.height - 1; y++) {
      for (let x = 1; x < hotel.width - 1; x++) {
        if (isSolidCell(cellAt(hotel, x, y))) continue;
        const onDoor = hotel.doors.some(
          (door) =>
            x >= door.x &&
            x < door.x + door.w &&
            y >= door.y &&
            y < door.y + door.h,
        );
        if (onDoor) warpTiles++;
      }
    }
    expect(warpTiles).toBe(0);
  });

  test("pressing into a hotel wall door enters another place", () => {
    const world = createWorld(artifact);
    const hotel = world.roomById.get("01-otel-goticheskii-holl")!;
    const door = hotel.doors.find((entry) => entry.y === 1);
    expect(door).toBeDefined();
    const player = createPlayer(hotel, "default");
    player.x = (door!.x + 0.5) * hotel.tileSize;
    player.y = 2.4 * hotel.tileSize;
    for (let i = 0; i < 20; i++) {
      updatePlayer(player, hotel, world, { x: 0, y: -1 }, 1 / 30);
      if (player.enteredDoorId) break;
    }
    expect(player.enteredDoorId).toBe(door!.id);
  });

  test("the six words have carriers", () => {
    expect(artifact.shards).toHaveLength(6);
    const held = new Set(
      artifact.figures
        .map((figure) => figure.holdsShardId)
        .filter((id): id is string => id !== null),
    );
    const onHotspots = new Set(
      artifact.rooms.flatMap((room) =>
        room.hotspots
          .map((hotspot) => hotspot.clueId)
          .filter((id): id is string => id !== null),
      ),
    );
    expect(held.has("shard2")).toBe(true);
    expect(held.has("shard4")).toBe(true);
    expect(held.has("shard5")).toBe(true);
    expect(held.has("shard6")).toBe(true);
    expect(onHotspots.has("clue-1")).toBe(true);
    expect(onHotspots.has("clue-3")).toBe(true);
  });

  test("examining the shelf inscription yields the tutorial clue", async () => {
    const world = createWorld(artifact);
    const mind = new ScriptedMind(world);
    const result = await mind.examine({
      x: 3,
      y: 5.2,
      roomId: "05-shesterochka",
      interestId: null,
      hotspotId: "nadpis-na-polke",
    });
    expect(result.clueObservedId).toBe("clue-1");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  test("Turyshev answers without a network call", async () => {
    const world = createWorld(artifact);
    const mind = new ScriptedMind(world);
    const result = await mind.turn({
      figureId: "turyshev",
      utterance: "Куда мне идти?",
    });
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.yieldedShardId).toBeNull();
  });

  test("a training deal still seats everyone and keeps Turyshev in the yard", () => {
    const world = createWorld(artifact);
    const population = fallbackPopulation(artifact, {
      shuffle: true,
      seed: "play",
    });
    installPopulation(world, population);
    expect(world.figures).toHaveLength(14);
    expect(
      world.figures.find((figure) => figure.id === "turyshev")?.roomId,
    ).toBe("19-dvor-i-oranzhevye-lavochki");
    expect(world.figures.find((figure) => figure.id === "glaz")?.roomId).toBe(
      artifact.finaleRoomId,
    );
  });

  test("the pool lift goes up a floor into the hotel", () => {
    const world = createWorld(artifact);
    world.currentRoomId = "07-bassein-i-odnostoronnii-lift";
    const pool = world.roomById.get(world.currentRoomId)!;
    const lift = pool.hotspots.find(
      (hotspot) => hotspot.link?.to === "up",
    )?.link;
    expect(lift).toBeDefined();
    expect(resolveLink(world, lift!)?.roomId).toBe("01-otel-goticheskii-holl");
  });

  test("walking past the bottle does not throw you into M4", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    for (let i = 0; i < 80; i++) {
      updatePlayer(player, room, world, { x: 0, y: -1 }, 1 / 30);
    }
    expect(player.enteredDoorId).toBeNull();
    expect(world.currentRoomId).toBe("19-dvor-i-oranzhevye-lavochki");
  });

  test("standing at the intercom offers the apartment link", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    player.x = 5.5 * room.tileSize;
    player.y = 4 * room.tileSize;
    const target = findTarget(world, room, player);
    expect(target?.kind).toBe("hotspot");
    if (target?.kind === "hotspot") {
      expect(target.hotspot.id).toBe("podezdnaia-dver-s-domofonom");
      expect(target.hotspot.link?.to).toBe("room");
    }
  });

  test("the courtyard door to the hotel is a walkable threshold", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    for (let i = 0; i < 80; i++) {
      updatePlayer(player, room, world, { x: -1, y: 0 }, 1 / 30);
      if (player.enteredDoorId) break;
    }
    expect(player.enteredDoorId).toBe("19-dvor-i-oranzhevye-lavochki--to-hub");
  });
});
