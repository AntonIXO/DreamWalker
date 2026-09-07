import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { createWorld, resetWorld } from "./world";

describe("createWorld murals", () => {
  test("props preserve their authored solidity", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const room = artifact.rooms[0]!;
    room.graphics.backdropImage = "assets/rooms/a.png";
    expect(room.props[0]?.solid).toBe(true);
    const world = createWorld(artifact);
    expect(world.roomById.get(room.id)?.props[0]?.solid).toBe(true);
  });

  test("props on a room without a painting still block", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    expect(world.rooms[0]?.props[0]?.solid).toBe(true);
  });
});

describe("WorldState.objects", () => {
  test("createWorld migrates authored props and hotspots", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    expect(world.objects.length).toBeGreaterThan(0);
    expect(world.objectById.get("a-crate")?.mobility).toBe("fixed");
    expect(world.objectById.get("shelf")?.clueId).toBe("clue-1");
    expect(world.baseObjects).toHaveLength(world.objects.length);
    expect(world.revision).toBe(0);
  });

  test("resetWorld restores authored object locations and does not clear fates or visitCounts", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    const shelf = world.objectById.get("shelf")!;
    shelf.location = { kind: "held", actor: { kind: "player" } };
    shelf.state = { open: true };
    world.keysHeld.add("key1");
    world.visitCounts.set("a", 4);
    world.fates.set("figure1", {
      figureId: "figure1",
      fate: "dead",
      cycle: 1,
      roomId: "a",
      by: "kill",
      remains: null,
      quoted: null,
    });

    resetWorld(world, 2);

    const restored = world.objectById.get("shelf");
    expect(restored?.location).toEqual({
      kind: "room",
      roomId: "a",
      x: 9,
      y: 4,
    });
    expect(restored?.state).toEqual({});
    expect(world.keysHeld.size).toBe(0);
    expect(world.visitCounts.get("a")).toBe(4);
    expect(world.fates.get("figure1")?.fate).toBe("dead");
  });
});
