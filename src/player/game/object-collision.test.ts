import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { WorldObjectState } from "../../shared/world-object";
import { createWorld } from "./world";
import {
  liveObjects,
  setLiveObjects,
  solidRectsFor,
  tileBlockedBySolids,
} from "./object-collision";

function artifact(): DreamArtifact {
  return validateDreamArtifact(
    JSON.parse(JSON.stringify(fixture)),
  ) as DreamArtifact;
}

function bottle(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "bottle",
    name: "бутылка",
    location: { kind: "room", roomId: "a", x: 5, y: 3 },
    mobility: "carryable",
    affordances: ["examine", "take", "drop", "give"],
    body: { w: 1, h: 1, solid: true },
    visual: { role: null, image: "bottle.png" },
    interaction: { reach: 1.4, prompt: "бутылка", refusal: null },
    state: {},
    tags: [],
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: "clue",
    uiAction: null,
    ...overrides,
  };
}

describe("solidRectsFor", () => {
  test("authored solid props still block when no objects exist", () => {
    const world = createWorld(artifact());
    expect(liveObjects(world)).toEqual([]);
    expect(tileBlockedBySolids(world, "a", 3, 4)).toBe(true);
    expect(tileBlockedBySolids(world, "a", 5, 3)).toBe(false);
  });

  test("a live solid object in this room blocks its cell", () => {
    const world = createWorld(artifact());
    setLiveObjects(world, [bottle()]);
    expect(tileBlockedBySolids(world, "a", 5, 3)).toBe(true);
  });

  test("taking an object frees its cell", () => {
    const world = createWorld(artifact());
    setLiveObjects(world, [
      bottle({ location: { kind: "held", actor: { kind: "player" } } }),
    ]);
    expect(tileBlockedBySolids(world, "a", 5, 3)).toBe(false);
  });

  test("does not double-count a prop that has been migrated to an object", () => {
    const world = createWorld(artifact());
    setLiveObjects(world, [
      bottle({
        id: "a-crate",
        location: { kind: "held", actor: { kind: "player" } },
        body: { w: 1, h: 1, solid: true },
      }),
    ]);
    expect(tileBlockedBySolids(world, "a", 3, 4)).toBe(false);
  });

  test("does not double-block an interest that became an object", () => {
    const world = createWorld(artifact());
    world.interests.push({
      id: "bottle",
      roomId: "a",
      name: "бутылка",
      sensorySeed: "",
      solid: true,
      holdsShardId: null,
      clueId: null,
      slotId: null,
      x: 5,
      y: 3,
    });
    setLiveObjects(world, [bottle()]);
    const rects = solidRectsFor(world, "a").filter(
      (rect) => rect.x === 5 && rect.y === 3,
    );
    expect(rects).toHaveLength(1);
  });

  test("a dropped object blocks in its new room, not the old one", () => {
    const world = createWorld(artifact());
    setLiveObjects(world, [
      bottle({ location: { kind: "room", roomId: "b", x: 2, y: 2 } }),
    ]);
    expect(tileBlockedBySolids(world, "a", 5, 3)).toBe(false);
    expect(tileBlockedBySolids(world, "b", 2, 2)).toBe(true);
  });
});
