import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { WorldObjectState } from "../../shared/world-object";
import { findGridPath } from "./path-search";
import { createWorld } from "./world";

function solidAt(
  id: string,
  roomId: string,
  x: number,
  y: number,
): WorldObjectState {
  return {
    id,
    name: id,
    location: { kind: "room", roomId, x, y },
    mobility: "fixed",
    affordances: ["examine"],
    body: { w: 1, h: 1, solid: true },
    visual: { role: null, image: null },
    interaction: null,
    state: {},
    tags: [],
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: null,
    uiAction: null,
  };
}

describe("findGridPath", () => {
  test("walks around a live solid object", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    world.objects.length = 0;
    world.objects.push(solidAt("block", "a", 6, 4));

    const path = findGridPath(world, "a", { x: 6, y: 6 }, { x: 6, y: 3 });
    expect(path).not.toBeNull();
    expect(path?.some((step) => step.x === 6 && step.y === 4)).toBe(false);
    expect(path?.at(-1)).toEqual({ x: 6, y: 3 });
  });

  test("returns null when walled off", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    const path = findGridPath(world, "a", { x: 6, y: 6 }, { x: 0, y: 0 });
    expect(path).toBeNull();
  });

  test("ignoreObjectId allows a path through that object", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    world.objects.length = 0;
    world.objects.push(solidAt("block", "a", 6, 4));

    const blocked = findGridPath(world, "a", { x: 6, y: 6 }, { x: 6, y: 4 });
    expect(blocked).toBeNull();
    const allowed = findGridPath(
      world,
      "a",
      { x: 6, y: 6 },
      { x: 6, y: 4 },
      "block",
    );
    expect(allowed).not.toBeNull();
    expect(allowed?.at(-1)).toEqual({ x: 6, y: 4 });
  });

  test("is deterministic", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    const a = findGridPath(world, "a", { x: 2, y: 6 }, { x: 9, y: 3 });
    const b = findGridPath(world, "a", { x: 2, y: 6 }, { x: 9, y: 3 });
    expect(a).toEqual(b);
    expect(a?.length).toBeGreaterThan(0);
  });

  test("already there is an empty path", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    expect(findGridPath(world, "a", { x: 6, y: 6 }, { x: 6, y: 6 })).toEqual(
      [],
    );
  });
});
