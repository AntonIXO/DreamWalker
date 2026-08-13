/**
 * What survives being done to somebody.
 *
 * The analogue of the `visitCounts` test in `patch.test.ts`: the interesting property is
 * not that a fate is recorded, it is that `resetWorld` — which exists to make the dream
 * forget — does not forget this.
 */

import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import type { DreamPopulation } from "../../shared/ai";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { applyPatch, installPopulation } from "./patch";
import { fateOf, isPresent, whoIsLed } from "./fates";
import { createWorld, resetWorld, type WorldState } from "./world";

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
      agenda: [],
    },
  ],
  interests: [],
  roomMoods: {},
  retargets: [],
  source: "fallback",
};

function peopled(): WorldState {
  const artifact = validateDreamArtifact(
    JSON.parse(JSON.stringify(fixture)),
  ) as DreamArtifact;
  const world = createWorld(artifact);
  installPopulation(world, POPULATION);
  return world;
}

const kill = (world: WorldState, figureId: string, cycle = 1) =>
  applyPatch(
    world,
    { kind: "markFigure", figureId, fate: "dead", quoted: null, reason: "t" },
    cycle,
  );

describe("markFigure", () => {
  test("removes the figure and leaves what they carried in the room", () => {
    const world = peopled();
    const room = world.figures[0]!.roomId;
    expect(world.figures[0]!.holdsShardId).toBe("shard1");

    expect(kill(world, "figure1").ok).toBe(true);
    expect(world.figures.some((f) => f.id === "figure1")).toBe(false);
    expect(fateOf(world, "figure1")).toBe("dead");

    // §6 has no solvability solver and this is not one: it does not promise the word is
    // still *reachable*, only that it still exists somewhere.
    const remains = world.interests.find((i) => i.id === "remains:figure1")!;
    expect(remains.holdsShardId).toBe("shard1");
    expect(remains.roomId).toBe(room);
  });

  test("a broken figure drops it too, which is the half nobody expects", () => {
    const world = peopled();
    const result = applyPatch(world, {
      kind: "markFigure",
      figureId: "figure1",
      fate: "broken",
      quoted: "ты присвоил ноут",
      reason: "t",
    });
    expect(result.ok).toBe(true);
    // Still standing there, and never going to answer again.
    expect(world.figures.some((f) => f.id === "figure1")).toBe(true);
    expect(
      world.interests.find((i) => i.id === "remains:figure1")?.holdsShardId,
    ).toBe("shard1");
  });

  test("keeps the words the sanitar committed with, for somebody to quote back", () => {
    const world = peopled();
    applyPatch(world, {
      kind: "markFigure",
      figureId: "figure1",
      fate: "leveraged",
      quoted: "я знаю про ноут",
      reason: "t",
    });
    expect(world.fateHistory[0]!.quoted).toBe("я знаю про ноут");
    // A kill has no words at all — the one act in this game that is silent.
    const other = peopled();
    kill(other, "figure1");
    expect(other.fateHistory[0]!.quoted).toBeNull();
  });
});

describe("the ledger outlives the cycle", () => {
  test("a death survives resetWorld, which exists to make the dream forget", () => {
    const world = peopled();
    kill(world, "figure1");
    resetWorld(world, 2);
    expect(world.figures.some((f) => f.id === "figure1")).toBe(false);
    expect(fateOf(world, "figure1")).toBe("dead");
    expect(world.fateHistory).toHaveLength(1);
  });

  test("being led downgrades to gone — you cannot walk somebody across a reset", () => {
    const world = peopled();
    applyPatch(world, {
      kind: "markFigure",
      figureId: "figure1",
      fate: "led",
      quoted: null,
      reason: "t",
    });
    expect(whoIsLed(world)).toBe("figure1");
    resetWorld(world, 2);
    expect(whoIsLed(world)).toBeNull();
    expect(fateOf(world, "figure1")).toBe("gone");
    expect(isPresent(world, "figure1")).toBe(false);
  });
});

describe("reviveFigure", () => {
  test("refuses to hand back somebody the sanitar killed", () => {
    const world = peopled();
    kill(world, "figure1");
    const result = applyPatch(world, {
      kind: "reviveFigure",
      figureId: "figure1",
      toRoomId: "b",
      reason: "t",
    });
    expect(result.ok).toBe(false);
  });

  test("takes back somebody who was only led away", () => {
    const world = peopled();
    applyPatch(world, {
      kind: "markFigure",
      figureId: "figure1",
      fate: "gone",
      quoted: null,
      reason: "t",
    });
    expect(world.figures.some((f) => f.id === "figure1")).toBe(false);
    const result = applyPatch(world, {
      kind: "reviveFigure",
      figureId: "figure1",
      toRoomId: "b",
      reason: "t",
    });
    expect(result.ok).toBe(true);
    expect(world.figures.find((f) => f.id === "figure1")?.roomId).toBe("b");
    expect(fateOf(world, "figure1")).toBe("present");
  });
});

describe("what a room offers", () => {
  test("a verb ring is built from the room, not from an inventory", async () => {
    // The whole reason `kill` needs no weapon: §9 excludes combat, so the means has to
    // already be standing there. Where none is, the row is struck through.
    const { lethalMeansIn } = await import("./interact");
    const world = peopled();
    const room = world.roomById.get("a")!;
    expect(lethalMeansIn(room)).toBe(false);

    room.hotspots.push({
      ...room.hotspots[0]!,
      id: "provoda",
      action: "lethal",
    });
    expect(lethalMeansIn(room)).toBe(true);
  });
});

describe("what the dream is told", () => {
  test("a dead figure is still in the snapshot, or nobody could mention them", () => {
    // The load-bearing detail of the whole feature. Killing splices the figure out of
    // `world.figures`; if the snapshot were built from that list alone, the person would
    // not have died, they would never have existed.
    const world = peopled();
    kill(world, "figure1");

    // The snapshot is assembled from live figures *plus* everyone with a record, so the
    // ledger is what has to survive the splice — and it has to remember the room, since
    // «его нет там, где он был» is the line the others need.
    expect(world.figures.some((f) => f.id === "figure1")).toBe(false);
    expect(world.fateHistory[0]).toMatchObject({
      figureId: "figure1",
      fate: "dead",
      roomId: "a",
    });
  });
});
