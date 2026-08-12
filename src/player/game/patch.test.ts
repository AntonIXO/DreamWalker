import { describe, expect, test } from "bun:test";

import { validateDreamArtifact } from "../../shared/dream";
import { applyPatch } from "./patch";
import { createWorld, resetWorld } from "./world";

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
});
