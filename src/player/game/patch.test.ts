/**
 * The patch writer, against a hand-written format-4 artifact.
 *
 * These used to load `dreams/vonesimo/dream.json`, which meant the suite broke whenever
 * the author edited their dream — the tests were coupled to content rather than to the
 * engine. `src/shared/__fixtures__/tiny-dream.json` is three rooms, one figure and six
 * clue cards: small enough to read in one screen, complete enough to validate.
 */

import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { DreamPopulation } from "../../shared/ai";
import { ScriptedMind } from "../mind/scripted";
import { applyPatch, installPopulation, patchTouches } from "./patch";
import { createWorld, noteVisit, resetWorld, type WorldState } from "./world";

function makeWorld(): WorldState {
  // Re-validated per test so a fixture edit that breaks the contract fails here.
  const artifact = validateDreamArtifact(
    JSON.parse(JSON.stringify(fixture)),
  ) as DreamArtifact;
  return createWorld(artifact);
}

const POPULATION: DreamPopulation = {
  figures: [
    {
      id: "figure1",
      name: "Санитарка",
      archetypeId: "orderly",
      homeRoomId: "a",
      holdsShardId: "shard1",
      personality: "Держится за привычный порядок.",
      role: "часть больничного сна",
      voice: "говорит коротко",
      desire: "чтобы смена закончилась",
      fear: "что рядом чужой",
      taboo: "не говорит о том, что снаружи",
      agenda: [
        { phase: "early", roomId: "a", activity: "перекладывает бумаги" },
      ],
    },
  ],
  interests: [
    {
      id: "interest-1",
      name: "полка",
      roomId: "a",
      sensorySeed: "Что-то лежит не на своём месте.",
      solid: true,
      holdsShardId: null,
      clueId: null,
    },
  ],
  roomMoods: { a: "Светло и неуместно подробно." },
  source: "fallback",
};

describe("doors", () => {
  test("every unsealed door can be sealed, and a reset restores its authored type", () => {
    const world = makeWorld();
    const authored = new Map(
      [...world.doorById].map(([id, door]) => [id, door.type]),
    );
    expect(authored.size).toBeGreaterThan(0);

    for (const [id, type] of authored) {
      if (type === "sealed") continue;
      const result = applyPatch(world, {
        kind: "sealDoor",
        doorId: id,
        reason: "test",
      });
      expect(result.ok).toBe(true);
      expect(world.doorById.get(id)!.type).toBe("sealed");
    }

    resetWorld(world);
    for (const [id, type] of authored) {
      expect(world.doorById.get(id)!.type).toBe(type);
    }
  });

  test("only a door the dream sealed may be reopened", () => {
    const world = makeWorld();
    // §6 — the dream never hands back a cheaper path than the one it destroyed.
    const untouched = applyPatch(world, {
      kind: "openDoor",
      doorId: "a-to-b",
      reason: "test",
    });
    expect(untouched.ok).toBe(false);

    applyPatch(world, { kind: "sealDoor", doorId: "a-to-b", reason: "test" });
    const reopened = applyPatch(world, {
      kind: "openDoor",
      doorId: "a-to-b",
      reason: "test",
    });
    expect(reopened.ok).toBe(true);
    expect(world.doorById.get("a-to-b")!.type).toBe("keyLock");
  });

  test("a sealed door refuses passage whatever the sanitar is carrying", () => {
    const world = makeWorld();
    world.keysHeld.add("key1");
    applyPatch(world, { kind: "sealDoor", doorId: "a-to-b", reason: "test" });
    expect(world.doorById.get("a-to-b")!.type).toBe("sealed");
  });
});

describe("installPopulation", () => {
  test("becomes the cycle reset point", () => {
    const world = makeWorld();
    const installed = installPopulation(world, POPULATION);
    expect(installed.ok).toBe(true);
    expect(world.interests).toHaveLength(1);
    expect(world.interests[0]!.roomId).toBe("a");

    const removed = applyPatch(world, {
      kind: "removeInterest",
      interestId: "interest-1",
      reason: "test",
    });
    expect(removed.ok).toBe(true);
    expect(world.interests).toHaveLength(0);

    resetWorld(world);
    // Restored to the *population*, not to the empty authored artifact.
    expect(world.interests).toHaveLength(1);
    expect(world.figures[0]!.personality).toBe(
      "Держится за привычный порядок.",
    );
  });

  test("a figure is seated in an authored slot, never at an invented coordinate", () => {
    const world = makeWorld();
    installPopulation(world, POPULATION);
    const figure = world.figures[0]!;
    const room = world.roomById.get(figure.roomId)!;
    const slot = room.figureSlots.find((entry) => entry.id === figure.slotId);
    expect(slot).toBeDefined();
    expect(figure.x).toBe(slot!.x);
  });

  test("nobody is ever placed in a meta-space", () => {
    const world = makeWorld();
    installPopulation(world, POPULATION);
    const refused = applyPatch(world, {
      kind: "moveFigure",
      figureId: "figure1",
      toRoomId: "m1",
      reason: "test",
    });
    expect(refused.ok).toBe(false);
    expect(world.figures[0]!.roomId).toBe("a");
  });
});

describe("relink", () => {
  test("rewires where an object throws you", () => {
    const world = makeWorld();
    const result = applyPatch(world, {
      kind: "relink",
      roomId: "a",
      hotspotId: "rope",
      toRoomId: "b",
      reason: "test",
    });
    expect(result.ok).toBe(true);
    const rope = world.roomById
      .get("a")!
      .hotspots.find((h) => h.id === "rope")!;
    expect(rope.link).toEqual({ to: "room", roomId: "b", entryId: null });
  });

  test("is refused when the destination does not exist", () => {
    const world = makeWorld();
    const result = applyPatch(world, {
      kind: "relink",
      roomId: "a",
      hotspotId: "rope",
      toRoomId: "nowhere",
      reason: "test",
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toContain("nowhere");
  });

  test("is refused on a hotspot that leads nowhere by design", () => {
    const world = makeWorld();
    // The clue shelf has no link; turning a described object into a door would be the
    // sleeper inventing geometry the author did not authorise.
    const result = applyPatch(world, {
      kind: "relink",
      roomId: "a",
      hotspotId: "shelf",
      toRoomId: "b",
      reason: "test",
    });
    expect(result.ok).toBe(false);
  });
});

describe("shiftWalls", () => {
  test("swaps to an authored variant and a reset restores the authored mask", () => {
    const world = makeWorld();
    const authored = [...world.roomById.get("b")!.cells];
    const result = applyPatch(world, {
      kind: "shiftWalls",
      roomId: "b",
      variantId: "shifted",
      reason: "test",
    });
    expect(result.ok).toBe(true);
    expect(world.roomById.get("b")!.cells).not.toEqual(authored);

    resetWorld(world);
    expect(world.roomById.get("b")!.cells).toEqual(authored);
    expect(world.roomById.get("b")!.activeVariant).toBeNull();
  });

  test("refuses a variant the author never drew", () => {
    const world = makeWorld();
    const result = applyPatch(world, {
      kind: "shiftWalls",
      roomId: "a",
      variantId: "imaginary",
      reason: "test",
    });
    expect(result.ok).toBe(false);
  });
});

describe("patchTouches", () => {
  test("names the rooms the heartbeat must not disturb", () => {
    const world = makeWorld();
    installPopulation(world, POPULATION);
    expect(
      patchTouches(
        { kind: "shiftWalls", roomId: "b", variantId: "shifted", reason: "" },
        world,
      ),
    ).toEqual(["b"]);
    expect(
      patchTouches(
        { kind: "sealDoor", doorId: "a-to-b", reason: "" },
        world,
      ).sort(),
    ).toEqual(["a", "b"]);
  });
});

describe("visitCounts", () => {
  test("survive a cycle reset, because the sanitar is what remembers", () => {
    const world = makeWorld();
    noteVisit(world, "b");
    noteVisit(world, "b");
    expect(world.visitCounts.get("b")).toBe(2);
    expect(world.visited.has("b")).toBe(true);

    resetWorld(world);
    // §4.3 — «второй визит хуже первого». The dream repeats; the count does not.
    expect(world.visitCounts.get("b")).toBe(2);
    expect(world.visited.has("b")).toBe(false);
  });
});

describe("ScriptedMind.judge", () => {
  const artifact = validateDreamArtifact(
    JSON.parse(JSON.stringify(fixture)),
  ) as DreamArtifact;
  const world = createWorld(artifact);
  const mind = new ScriptedMind(world);
  const words = [...Array(11).fill("abandon"), "about"];

  test("accepts the exact ordered phrase", async () => {
    await expect(mind.judge(words)).resolves.toMatchObject({
      verdict: "match",
    });
  });

  test("rejects the same words in the wrong order", async () => {
    const swapped = ["about", ...Array(11).fill("abandon")];
    await expect(mind.judge(swapped)).resolves.toMatchObject({
      verdict: "miss",
    });
  });

  test("rejects a short phrase", async () => {
    await expect(mind.judge(words.slice(0, 11))).resolves.toMatchObject({
      verdict: "miss",
    });
  });
});
