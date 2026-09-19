import { describe, expect, test } from "bun:test";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { sonArtifact } from "../../../dreams/son/pack";
import { fallbackPopulation } from "../../shared/population";
import { blockedInRoom, cellAt, isSolidCell } from "../../shared/roomGrid";
import {
  originY,
  roomContainingPlayer,
  toLocalPixels,
  toWorldPixels,
} from "../../shared/street";
import { MindMemory } from "../mind/memory";
import { ScriptedMind } from "../mind/scripted";
import { findTarget } from "./interact";
import { applyPatch, installPopulation } from "./patch";
import { fateOf } from "./fates";
import { UNKILLABLE } from "../../shared/verbs";
import { createPlayer, updatePlayer } from "./player";
import { createWorld, doorDestination, resetWorld } from "./world";

const artifact = validateDreamArtifact(sonArtifact()) as DreamArtifact;

function walkWorld(
  world: ReturnType<typeof createWorld>,
  player: ReturnType<typeof createPlayer>,
  axis: { x: number; y: number },
  frames: number,
): void {
  for (let i = 0; i < frames; i++) {
    const room = world.roomById.get(world.currentRoomId)!;
    updatePlayer(player, room, world, axis, 1 / 30);
    const next = roomContainingPlayer(
      world.rooms,
      player.x,
      player.y,
      world.currentRoomId,
    );
    if (next) world.currentRoomId = next.id;
  }
}

describe("son is playable", () => {
  test("spawns on open floor in the courtyard with Turyshev", () => {
    const world = createWorld(artifact);
    expect(world.currentRoomId).toBe("19-dvor-i-oranzhevye-lavochki");
    expect(world.figures.some((figure) => figure.id === "turyshev")).toBe(true);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    const local = toLocalPixels(room, player.x, player.y);
    expect(
      blockedInRoom(
        room,
        [],
        { x: local.x, y: local.y, width: 9, height: 7 },
        room.tileSize,
      ),
    ).toBe(false);
  });

  test("the courtyard south door is the apartment, not a rift", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get("19-dvor-i-oranzhevye-lavochki")!;
    const intercom = room.hotspots.find((hotspot) =>
      hotspot.prompt.includes("домофон"),
    )!;
    expect(intercom.kind).toBe("look");
    expect("link" in intercom).toBe(false);

    const south = room.doors.find((door) => door.id.includes("--s-"))!;
    expect(south.threshold).toBe("door");
    expect(south.toRoomId.startsWith("path-")).toBe(true);
    const road = world.roomById.get(south.toRoomId)!;
    expect(
      road.doors.some(
        (door) => door.toRoomId === "08-kvartira-v-kotoroi-zhivut-drugie",
      ),
    ).toBe(true);
  });

  test("nothing in the dream moves the player by being touched", () => {
    // The flagship invariant of the change: travel is thresholds, full stop. A hotspot
    // can close itself and it can refuse; it cannot relocate anybody.
    for (const room of artifact.rooms) {
      for (const hotspot of room.hotspots) {
        expect("link" in hotspot).toBe(false);
        expect(hotspot.kind).not.toBe("link");
      }
    }
  });

  test("every meta-space is on the street map, with a door", () => {
    const world = createWorld(artifact);
    // A rift is an extra створ out of a meta-space, never the way into one: every meta
    // room is still entered on foot, so no arrangement can strand the player.
    for (const room of artifact.rooms) {
      for (const door of room.doors) {
        if (door.threshold !== "rift" || (door.hidden && door.revealBy))
          continue;
        expect(room.id).toMatch(/^m\d+-/);
        expect(artifact.rooms.some((other) => other.id === door.toRoomId)).toBe(
          true,
        );
      }
    }
    for (const meta of artifact.rooms.filter((room) => room.kind === "meta")) {
      expect(meta.doors.some((door) => door.threshold !== "rift")).toBe(true);
      expect(
        artifact.rooms.some((room) =>
          room.doors.some(
            (door) => door.toRoomId === meta.id && door.threshold !== "rift",
          ),
        ),
      ).toBe(true);
    }
    expect(world.rooms.length).toBe(artifact.rooms.length);
  });

  test("walking the courtyard floor does not warp", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    const startX = player.x;
    for (let i = 0; i < 20; i++) {
      updatePlayer(player, room, world, { x: -1, y: 0 }, 1 / 30);
    }
    expect(player.enteredDoorId).toBeNull();
    expect(player.x).toBeLessThan(startX);
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
            door.threshold !== "door" &&
            door.threshold !== "lift" &&
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

  test("pressing north out of the hotel is walking, not a warp", () => {
    const world = createWorld(artifact);
    const hotel = world.roomById.get("01-otel-goticheskii-holl")!;
    const player = createPlayer(hotel, "default");
    const worldPos = toWorldPixels(
      hotel,
      10 * hotel.tileSize,
      2.4 * hotel.tileSize,
    );
    player.x = worldPos.x;
    player.y = worldPos.y;
    walkWorld(world, player, { x: 0, y: -1 }, 50);
    expect(player.enteredDoorId).toBeNull();
    expect(player.y).toBeLessThan(originY(hotel) * hotel.tileSize);
    expect(world.currentRoomId.startsWith("path-")).toBe(true);
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
    const mind = new ScriptedMind(world, new MindMemory(world.artifact.slug));
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
    const mind = new ScriptedMind(world, new MindMemory(world.artifact.slug));
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
    expect(world.figures).toHaveLength(artifact.figures.length);
    expect(
      world.figures.find((figure) => figure.id === "turyshev")?.roomId,
    ).toBe("19-dvor-i-oranzhevye-lavochki");
    expect(world.figures.find((figure) => figure.id === "glaz")?.roomId).toBe(
      artifact.finaleRoomId,
    );
  });

  test("the pool lift only goes up, and comes out in the hotel", () => {
    const world = createWorld(artifact);
    const pool = world.roomById.get("07-bassein-i-odnostoronnii-lift")!;
    const hotel = world.roomById.get("01-otel-goticheskii-holl")!;
    const lift = pool.doors.find((door) => door.threshold === "lift")!;
    expect(lift.levelDelta).toBeGreaterThan(0);
    expect(doorDestination(world, lift).roomId).toBe(hotel.id);
    // §07 to the letter: «Третий этаж», and the lift arrives *lower* than it left. Only
    // a staircase is held to the geometry; a lift is allowed to lie about it.
    expect(pool.buildingId).toBe("otel");
    expect(hotel.buildingId).toBe("otel");
    expect(pool.level).toBeGreaterThan(hotel.level);
  });

  test("walking past the bottle does not throw you anywhere", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    for (let i = 0; i < 25; i++) {
      updatePlayer(player, room, world, { x: 0, y: -1 }, 1 / 30);
    }
    expect(player.enteredDoorId).toBeNull();
    expect(world.currentRoomId).toBe("19-dvor-i-oranzhevye-lavochki");
  });

  test("the intercom is reached from in front of it, not from inside it", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    const intercom = room.hotspots.find(
      (hotspot) => hotspot.id === "podezdnaia-dver-s-domofonom",
    )!;
    const body = room.props.find((prop) => prop.id === intercom.propId)!;

    // The lobby convention: the hotspot sits just off the body's bottom edge, so the
    // tile you press E from is a tile you can actually stand on.
    expect(intercom.y).toBeCloseTo(body.y + body.h + 0.15);
    expect(body.solid).toBe(true);

    const at = toWorldPixels(
      room,
      intercom.x * room.tileSize,
      intercom.y * room.tileSize,
    );
    player.x = at.x;
    player.y = at.y;
    const target = findTarget(world, room, player);
    expect(target?.kind).toBe("object");
    if (target?.kind === "object") {
      expect(target.object.id).toBe(body.id);
      expect(target.object.interaction?.refusal ?? null).toBeNull();
    }
  });

  test("you cannot walk through a thing that is drawn as solid", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    const bench = room.props.find((prop) => prop.id === "oranzhevye-lavochki")!;
    expect(bench.solid).toBe(true);

    // Stand directly below the bench and push north into it.
    const at = toWorldPixels(
      room,
      (bench.x + bench.w / 2) * room.tileSize,
      (bench.y + bench.h + 0.6) * room.tileSize,
    );
    player.x = at.x;
    player.y = at.y;
    const before = player.y;
    for (let i = 0; i < 60; i++) {
      updatePlayer(player, room, world, { x: 0, y: -1 }, 1 / 30);
    }
    expect(player.y).toBeLessThan(before);
    expect(player.y).toBeGreaterThan(
      toWorldPixels(room, 0, (bench.y + bench.h) * room.tileSize).y,
    );
  });

  test("the courtyard door to the hotel is a walkable threshold", () => {
    const world = createWorld(artifact);
    const room = world.roomById.get(world.currentRoomId)!;
    const player = createPlayer(room, artifact.spawn.entryId);
    const door = room.doors.find((entry) => entry.id.includes("--e-"))!;
    expect(door.toRoomId.startsWith("path-")).toBe(true);
    const at = toWorldPixels(
      room,
      (door.x - 0.6) * room.tileSize,
      (door.y + door.h / 2) * room.tileSize,
    );
    player.x = at.x;
    player.y = at.y;
    walkWorld(world, player, { x: 1, y: 0 }, 180);
    expect(player.enteredDoorId).toBeNull();
    expect(world.currentRoomId).toBe("01-otel-goticheskii-holl");
  });
});

describe("a fate can move a hook, never delete one", () => {
  /**
   * The closest thing to the solver §6 refuses, and legitimate for exactly that reason:
   * it tests an *engine guarantee*, not a route. §6 leaves reachability to the sleeper —
   * a defending dream is allowed to make a cycle impossible. It does not license a word
   * ceasing to exist, which is what killing a carrier used to mean.
   */
  test("every hook is still carried after the worst is done to whoever holds it", () => {
    const world = createWorld(artifact);
    installPopulation(world, fallbackPopulation(artifact));

    // Whatever is carried *before*. Two of the six start on nobody — the dream places
    // those itself — and the guarantee is that a fate does not delete a hook, not that
    // every hook is dealt.
    const carriedBefore = artifact.shards
      .map((shard) => shard.id)
      .filter(
        (id) =>
          world.figures.some((f) => f.holdsShardId === id) ||
          world.interests.some((i) => i.holdsShardId === id),
      );
    expect(carriedBefore.length).toBeGreaterThan(0);

    for (const shard of artifact.shards) {
      const holder = world.figures.find((f) => f.holdsShardId === shard.id);
      if (!holder) continue;
      applyPatch(world, {
        kind: "markFigure",
        figureId: holder.id,
        fate: UNKILLABLE.has(holder.id) ? "broken" : "dead",
        quoted: null,
        reason: "test",
      });
    }

    for (const shardId of carriedBefore) {
      const onSomebody = world.figures.some((f) => f.holdsShardId === shardId);
      const onSomething = world.interests.some(
        (interest) => interest.holdsShardId === shardId,
      );
      expect(onSomebody || onSomething).toBe(true);
    }
  });

  test("killing everyone killable still leaves every dealt word somewhere", () => {
    const world = createWorld(artifact);
    installPopulation(world, fallbackPopulation(artifact));
    const carriedBefore = artifact.shards
      .map((shard) => shard.id)
      .filter(
        (id) =>
          world.figures.some((f) => f.holdsShardId === id) ||
          world.interests.some((i) => i.holdsShardId === id),
      );
    for (const figure of [...world.figures]) {
      if (UNKILLABLE.has(figure.id)) continue;
      applyPatch(world, {
        kind: "markFigure",
        figureId: figure.id,
        fate: "dead",
        quoted: null,
        reason: "test",
      });
    }
    for (const shardId of carriedBefore) {
      const carried =
        world.figures.some((f) => f.holdsShardId === shardId) ||
        world.interests.some((i) => i.holdsShardId === shardId);
      expect(carried).toBe(true);
    }
  });
});

describe("Кирилл", () => {
  test("comes back whole and not remembering, and the history does not", () => {
    // §1 of the bible and `kirill/SOUL.md`: «Убей его — вернётся в следующей комнате
    // целым и не помнящим.» The one figure death does not remove — and the reason
    // saying it out loud gives the sanitar away instantly.
    const world = createWorld(artifact);
    installPopulation(world, fallbackPopulation(artifact));
    expect(world.figures.some((f) => f.id === "kirill")).toBe(true);

    applyPatch(world, {
      kind: "markFigure",
      figureId: "kirill",
      fate: "dead",
      quoted: null,
      reason: "test",
    });
    expect(world.figures.some((f) => f.id === "kirill")).toBe(false);

    resetWorld(world, 2);
    expect(world.figures.some((f) => f.id === "kirill")).toBe(true);
    expect(fateOf(world, "kirill")).toBe("present");
    // Nothing about him shows it. The ledger still does.
    expect(
      world.fateHistory.some((record) => record.figureId === "kirill"),
    ).toBe(true);
  });

  test("nobody else does", () => {
    const world = createWorld(artifact);
    installPopulation(world, fallbackPopulation(artifact));
    const mortal = world.figures.find(
      (f) => f.id !== "kirill" && !UNKILLABLE.has(f.id),
    )!;
    applyPatch(world, {
      kind: "markFigure",
      figureId: mortal.id,
      fate: "dead",
      quoted: null,
      reason: "test",
    });
    resetWorld(world, 2);
    expect(world.figures.some((f) => f.id === mortal.id)).toBe(false);
  });
});

describe("the deal cannot make the dream uncrossable", () => {
  /**
   * The invariant the whole skeleton/card split exists for. §6 refuses a solvability
   * solver, and this is not one: it does not check that a route is *good*, it checks
   * that a reshuffle is structurally incapable of touching the map at all. The places
   * move; the walls, doors, stairs and slots do not.
   */
  test("a hundred deals leave the geometry and the reachable set identical", () => {
    const control = createWorld(artifact);
    const geometry = (world: ReturnType<typeof createWorld>): string =>
      JSON.stringify(
        world.rooms.map((room) => ({
          id: room.id,
          cells: room.cells,
          doors: room.doors.map((d) => [
            d.id,
            d.x,
            d.y,
            d.threshold,
            d.toRoomId,
          ]),
          entries: room.entries,
          props: room.props.map((p) => [p.id, p.x, p.y, p.w, p.h, p.solid]),
        })),
      );
    const before = geometry(control);

    for (let seed = 0; seed < 100; seed++) {
      const world = createWorld(artifact);
      installPopulation(
        world,
        fallbackPopulation(artifact, { shuffle: true, seed: `deal-${seed}` }),
      );
      expect(geometry(world)).toBe(before);
    }
  });

  test("the courtyard and the finale never move, whatever the deal says", () => {
    for (let seed = 0; seed < 40; seed++) {
      const world = createWorld(artifact);
      installPopulation(
        world,
        fallbackPopulation(artifact, { shuffle: true, seed: `pin-${seed}` }),
      );
      // §19 — «безопасная комната. Единственная». A run that opens anywhere else opens
      // with the sanitar already in trouble, and the Eye is pinned to the last door.
      expect(world.roomById.get(artifact.spawn.roomId)!.name).toBe(
        artifact.rooms.find((r) => r.id === artifact.spawn.roomId)!.name,
      );
      expect(world.roomById.get(artifact.finaleRoomId)!.name).toBe(
        artifact.rooms.find((r) => r.id === artifact.finaleRoomId)!.name,
      );
    }
  });

  test("the places behind the doors stay where they were drawn", () => {
    const world = createWorld(artifact);
    installPopulation(
      world,
      fallbackPopulation(artifact, { shuffle: true, seed: "moved" }),
    );
    const moved = artifact.rooms.filter(
      (authored) => world.roomById.get(authored.id)!.name !== authored.name,
    );
    expect(moved).toEqual([]);
  });
});
