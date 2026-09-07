import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { WorldObjectState } from "../../shared/world-object";
import { setLiveObjects } from "./object-collision";
import { createWorld } from "./world";
import { createPlayer, updatePlayer } from "./player";

describe("updatePlayer doors", () => {
  test("walking onto a threshold door enters it", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    world.keysHeld.add("key1");
    const room = world.roomById.get("a")!;
    const player = createPlayer(room, "default");
    // Entry is (6, 6). Door is at (6, 2). Walk north.
    player.x = 6 * room.tileSize + 8;
    player.y = 3 * room.tileSize + 8;
    for (let i = 0; i < 30; i++) {
      updatePlayer(player, room, world, { x: 0, y: -1 }, 1 / 30);
      if (player.enteredDoorId) break;
    }
    expect(player.enteredDoorId).toBe("a-to-b");
  });
});

function bottle(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "bottle",
    name: "бутылка",
    location: { kind: "room", roomId: "a", x: 5, y: 3 },
    mobility: "carryable",
    affordances: ["take"],
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
    hotspotKind: null,
    uiAction: null,
    ...overrides,
  };
}

describe("updatePlayer live objects", () => {
  test("a solid object on the floor stops the walker", () => {
    const world = createWorld(
      validateDreamArtifact(JSON.parse(JSON.stringify(fixture))) as DreamArtifact,
    );
    const room = world.roomById.get("a")!;
    const player = createPlayer(room, "default");
    setLiveObjects(world, [bottle()]);
    player.x = 5 * room.tileSize + 8;
    player.y = 4 * room.tileSize + 8;
    const before = player.y;
    for (let i = 0; i < 60; i++) {
      updatePlayer(player, room, world, { x: 0, y: -1 }, 1 / 30);
    }
    expect(player.y).toBeLessThan(before);
    expect(player.y).toBeGreaterThan(4 * room.tileSize);
  });

  test("a taken object no longer blocks that cell", () => {
    const world = createWorld(
      validateDreamArtifact(JSON.parse(JSON.stringify(fixture))) as DreamArtifact,
    );
    const room = world.roomById.get("a")!;
    const player = createPlayer(room, "default");
    setLiveObjects(world, [
      bottle({ location: { kind: "held", actor: { kind: "player" } } }),
    ]);
    player.x = 5 * room.tileSize + 8;
    player.y = 4 * room.tileSize + 8;
    for (let i = 0; i < 60; i++) {
      updatePlayer(player, room, world, { x: 0, y: -1 }, 1 / 30);
    }
    expect(player.y).toBeLessThan(3 * room.tileSize + 8);
  });
});
