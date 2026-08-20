import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { createWorld } from "./world";

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
