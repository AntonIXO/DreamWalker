import { describe, expect, test } from "bun:test";

import { validateDreamArtifact } from "../../shared/dream";
import type { DreamPopulation } from "../../shared/ai";
import { Tile } from "../../shared/tilecodes";
import { applyPatch, installPopulation } from "./patch";
import { createWorld, resetWorld } from "./world";
import { ScriptedMind } from "../mind/scripted";

describe("runtime dream patches", () => {
  test("the sleeper may seal authored routes and reset restores them", async () => {
    const artifact = validateDreamArtifact(
      await Bun.file("dreams/vonesimo/dream.json").json(),
    );
    const world = createWorld(artifact);
    const authoredTypes = world.doors.map((door) => door.type);
    const mutableDoors = world.doors.filter((door) => door.type !== "sealed");

    for (const door of mutableDoors) {
      expect(
        applyPatch(world, {
          kind: "sealDoor",
          doorId: door.id,
          reason: "защита сна",
        }).ok,
      ).toBe(true);
    }
    expect(world.doors.filter((door) => door.type === "sealed")).toHaveLength(
      world.doors.length,
    );

    resetWorld(world);
    expect(world.doors.map((door) => door.type)).toEqual(authoredTypes);
  });

  test("generated people and interests become the cycle reset point", async () => {
    const artifact = validateDreamArtifact(
      await Bun.file("dreams/vonesimo/dream.json").json(),
    );
    const authored = artifact.figures[0]!;
    const population: DreamPopulation = {
      source: "fallback",
      roomMoods: { [authored.roomId]: "Тихо." },
      figures: [
        {
          id: authored.id,
          name: authored.name,
          archetypeId: authored.archetypeId,
          homeRoomId: authored.roomId,
          role: "дежурная",
          personality: "считает порядок единственной защитой",
          voice: "тихо",
          desire: "закончить обход",
          fear: "стука",
          taboo: "котельная",
          holdsShardId: null,
          agenda: [
            { phase: "early", roomId: authored.roomId, activity: "подметает" },
            {
              phase: "middle",
              roomId: authored.roomId,
              activity: "считает ключи",
            },
            { phase: "late", roomId: authored.roomId, activity: "ждёт" },
          ],
        },
      ],
      interests: [
        {
          id: "test-interest",
          roomId: artifact.map.graph.startId,
          name: "Стул",
          sensorySeed: "Спинка ещё тёплая.",
          solid: true,
          holdsShardId: artifact.shards[0]?.id ?? null,
          clueId: null,
        },
      ],
    };
    const world = createWorld(artifact);
    expect(installPopulation(world, population).ok).toBe(true);
    expect(world.figures).toHaveLength(1);
    expect(world.interests).toHaveLength(1);
    const placed = { ...world.interests[0]! };
    expect(`${placed.x},${placed.y}`).not.toBe(
      `${artifact.map.spawn.x},${artifact.map.spawn.y}`,
    );
    expect(world.tiles[placed.y * world.width + placed.x]).toBe(
      Tile.PROP_SOLID,
    );

    expect(
      applyPatch(world, {
        kind: "removeInterest",
        interestId: placed.id,
        reason: "test",
      }).ok,
    ).toBe(true);
    expect(world.interests).toHaveLength(0);

    resetWorld(world);
    expect(world.interests).toHaveLength(1);
    expect(world.interests[0]?.roomId).toBe(placed.roomId);
    expect(world.tiles[placed.y * world.width + placed.x]).toBe(
      Tile.PROP_SOLID,
    );
  });

  test("room cards only swap between author-approved slots", async () => {
    const artifact = validateDreamArtifact(
      await Bun.file("dreams/vonesimo/dream.json").json(),
    );
    const world = createWorld(artifact);
    const entries = [...world.chamberByRoomId.entries()];
    const [aId, aChamber] = entries[0]!;
    const [bId, bChamber] = entries.find(
      ([id]) =>
        id !== aId &&
        world.roomById.get(id)?.rect.w === world.roomById.get(aId)?.rect.w,
    )!;
    expect(
      applyPatch(world, {
        kind: "swapRooms",
        aRoomId: aId,
        bRoomId: bId,
        reason: "test refusal",
      }).ok,
    ).toBe(false);

    aChamber.eligibleRoomIds.push(bId);
    bChamber.eligibleRoomIds.push(aId);
    expect(
      applyPatch(world, {
        kind: "swapRooms",
        aRoomId: aId,
        bRoomId: bId,
        reason: "test authored shuffle",
      }).ok,
    ).toBe(true);
    expect(world.chamberByRoomId.get(aId)?.id).toBe(bChamber.id);
    expect(world.chamberByRoomId.get(bId)?.id).toBe(aChamber.id);
  });

  test("offline finale requires the exact ordered commitment", async () => {
    const artifact = validateDreamArtifact(
      await Bun.file("dreams/vonesimo/dream.json").json(),
    );
    const words =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".split(
        " ",
      );
    const phrase = words.join(" ");
    artifact.content.mnemonic.hash = new Bun.CryptoHasher("sha256")
      .update(phrase)
      .digest("hex");
    const mind = new ScriptedMind(createWorld(artifact));
    await expect(mind.judge(words)).resolves.toMatchObject({
      verdict: "match",
    });
    const wrong = [...words];
    [wrong[0], wrong[1]] = ["about", "abandon"];
    await expect(mind.judge(wrong)).resolves.toMatchObject({ verdict: "miss" });
  });
});
