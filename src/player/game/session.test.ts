import { expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import type { Camera } from "../render/camera";
import type { RoomScene } from "../render/roomScene";
import type { Shiver } from "../render/shiver";
import { DreamSession } from "./session";
import { createWorld, resetWorld } from "./world";

test("a rift completing after a cycle reset cannot move the new cycle's player", async () => {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const transitions: Array<() => void> = [];
  const session = new DreamSession(
    world,
    { show() {} } as unknown as RoomScene,
    { setWorldSize() {}, fit() {}, cutTo() {} } as unknown as Camera,
    { trigger() {} } as unknown as Shiver,
    { onEnterRoom() {}, onRefused() {} },
    { play: () => new Promise((resolve) => transitions.push(resolve)) },
  );
  const old = session.enterRoom("b", null, "rift");
  resetWorld(world, 1);
  session.restart();
  const current = session.enterRoom("b", null, "rift");
  expect(transitions).toHaveLength(2);
  transitions[0]!();
  await old;
  expect(world.currentRoomId).toBe("a");
  expect(session.canSave).toBe(false);
  transitions[1]!();
  await current;
  expect(world.currentRoomId).toBe("b");
  expect(session.canSave).toBe(true);
});

test("physical receipt and witnesses are captured before a script reacts", () => {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  let recordedBeforeReaction = false;
  const session = new DreamSession(
    world,
    { show() {} } as unknown as RoomScene,
    { setWorldSize() {}, fit() {}, cutTo() {} } as unknown as Camera,
    { trigger() {} } as unknown as Shiver,
    { onEnterRoom() {}, onRefused() {}, cycleNumber: () => 2 },
    undefined,
    [
      {
        id: "reaction",
        onWorldEvent(_host, event) {
          if (event.type !== "object.taken") return;
          recordedBeforeReaction =
            world.worldMind.events[0]?.events[0]?.type === "object.taken";
          world.figures[0]!.roomId = "b";
        },
      },
    ],
  );
  session.player.x = 9 * world.rooms[0]!.tileSize;
  session.player.y = 4 * world.rooms[0]!.tileSize;
  const result = session.dispatchWorldAction({
    actor: { kind: "player" },
    source: "player",
    action: { type: "take", objectId: "shelf" },
  });
  expect(result.ok).toBe(true);
  expect(recordedBeforeReaction).toBe(true);
  expect(world.worldMind.events[0]?.witnessIds).toEqual(["figure1"]);
  expect(world.worldMind.events[0]?.witnessRooms.figure1).toEqual(["a"]);
  expect(world.worldMind.events[0]?.cycle).toBe(2);
  session.dispatchWorldAction({
    actor: { kind: "player" },
    source: "player",
    action: { type: "take", objectId: "missing" },
  });
  expect(world.worldMind.events).toHaveLength(1);
});
