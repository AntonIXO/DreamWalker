import { describe, expect, test } from "bun:test";
import { sonArtifact } from "../../../dreams/son/pack";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import type { DreamScript } from "../../shared/pack";
import { toWorldPixels } from "../../shared/street";
import type { WorldMindEvent } from "../../shared/world-mind";
import type { Camera } from "../render/camera";
import type { RoomScene } from "../render/roomScene";
import type { Shiver } from "../render/shiver";
import { DreamSession, type SessionCallbacks } from "./session";
import { createWorld, type WorldState } from "./world";

function sessionFor(
  world: WorldState,
  callbacks: Partial<SessionCallbacks> = {},
  scripts: DreamScript[] = [],
) {
  return new DreamSession(
    world,
    { show() {}, showStreet() {}, invalidate() {} } as unknown as RoomScene,
    { setWorldSize() {}, fit() {}, cutTo() {} } as unknown as Camera,
    { trigger() {} } as unknown as Shiver,
    { onEnterRoom() {}, onRefused() {}, ...callbacks },
    undefined,
    scripts,
  );
}

const player = { kind: "player" } as const;

describe("world action causality", () => {
  test("nested reactions retain one root and batch only after sequential memories", () => {
    const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
    const order: string[] = [];
    const received: WorldMindEvent[][] = [];
    const session = sessionFor(
      world,
      {
        onWorldAction: (event) => order.push(`memory:${event.events[0]!.type}`),
        onWorldActionBatch: (events) => {
          order.push("batch");
          received.push([...events]);
        },
      },
      [
        {
          id: "nested",
          onWorldEvent(host, event) {
            order.push(`reaction:${event.type}`);
            if (event.type === "object.taken")
              host.dispatch({ type: "close", targetId: "a--stair-up" });
            if (event.type === "door.closed")
              host.dispatch({ type: "open", targetId: "a--stair-up" });
          },
        },
      ],
    );
    session.player.x = 9 * world.rooms[0]!.tileSize;
    session.player.y = 4 * world.rooms[0]!.tileSize;
    const cause = { rootId: "player-command", taskId: "physical-task" };
    expect(
      session.dispatchWorldAction({
        actor: player,
        source: "player",
        action: { type: "take", objectId: "shelf" },
        cause,
      }).ok,
    ).toBe(true);
    expect(order).toEqual([
      "memory:object.taken",
      "reaction:object.taken",
      "memory:door.closed",
      "reaction:door.closed",
      "memory:door.opened",
      "reaction:door.opened",
      "batch",
    ]);
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(3);
    expect(received[0]!.map((event) => event.cause)).toEqual([
      cause,
      cause,
      cause,
    ]);
    cause.rootId = "mutated later";
    expect(world.worldMind.events[0]!.cause?.rootId).toBe("player-command");
  });

  test("script hooks and explicit synchronous groups combine sibling actions", () => {
    const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
    const batches: WorldMindEvent[][] = [];
    const session = sessionFor(
      world,
      { onWorldActionBatch: (events) => batches.push([...events]) },
      [
        {
          id: "siblings",
          onMemorySpent(host) {
            host.dispatch({ type: "close", targetId: "a--stair-up" });
            host.dispatch({ type: "open", targetId: "a--stair-up" });
          },
        },
      ],
    );
    session.noteMemorySpent();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    const scriptRoot = batches[0]![0]!.cause?.rootId;
    expect(scriptRoot).toBeTruthy();
    expect(batches[0]![1]!.cause?.rootId).toBe(scriptRoot);
    session.withActionCause({ rootId: "dialogue-turn" }, () => {
      for (const type of ["close", "open"] as const)
        session.dispatchWorldAction({
          actor: { kind: "script", id: "test" },
          source: "script",
          action: { type, targetId: "a--stair-up" },
        });
    });
    expect(batches).toHaveLength(2);
    expect(batches[1]!.map((event) => event.cause?.rootId)).toEqual([
      "dialogue-turn",
      "dialogue-turn",
    ]);
    session.noteMemorySpent();
    expect(batches[2]![0]!.cause?.rootId).not.toBe(scriptRoot);
  });

  test("revealing a covered door is part of the triggering action batch", () => {
    const world = createWorld(sonArtifact());
    world.currentRoomId = "10-komnata-s-grobami";
    const batches: WorldMindEvent[][] = [];
    const session = sessionFor(world, {
      onWorldActionBatch: (events) => batches.push([...events]),
    });
    const room = session.room;
    Object.assign(
      session.player,
      toWorldPixels(room, 4 * room.tileSize, 9.2 * room.tileSize),
    );
    expect(
      session.dispatchWorldAction({
        actor: player,
        source: "player",
        action: { type: "take", objectId: "tkan-s-kodami" },
        cause: { rootId: "uncover-passage" },
      }).ok,
    ).toBe(true);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((event) => event.events[0]!.type)).toEqual([
      "object.taken",
      "door.revealed",
    ]);
    expect(
      batches[0]!.every((event) => event.cause?.rootId === "uncover-passage"),
    ).toBe(true);
  });

  test("idle updates and refusals do not deliver empty batches", () => {
    const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
    const batches: WorldMindEvent[][] = [];
    const session = sessionFor(world, {
      onWorldActionBatch: (events) => batches.push([...events]),
    });
    for (let tick = 0; tick < 100; tick++)
      session.update({ x: 0, y: 0 }, 1 / 60);
    session.dispatchWorldAction({
      actor: player,
      source: "player",
      action: { type: "take", objectId: "missing" },
    });
    expect(batches).toEqual([]);
    expect(world.worldMind.events).toEqual([]);
  });
});
