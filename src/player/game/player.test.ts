import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
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
