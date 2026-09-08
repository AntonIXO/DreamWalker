import { describe, expect, test } from "bun:test";
import { sonArtifact } from "../../../dreams/son/pack";
import { m6Script } from "../../../dreams/son/scripts/m6";
import type { DreamScript } from "../../shared/pack";
import type { DialogueResult } from "../../shared/ai";
import {
  createNpcWorldSession,
  sandboxFromSnapshot,
} from "../../shared/world-sandbox";
import {
  availableActions,
  executeWorldAction,
} from "../../shared/world-action-engine";
import { snapshot } from "../mind/remote";
import { worldActionsOf } from "../ui/dialogue";
import { replayWorldActions } from "./npc-action-queue";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { DreamSession } from "./session";
import { createWorld, resetWorld } from "./world";
import { primaryObjectAction } from "./interact";
import type { RoomScene } from "../render/roomScene";
import type { Camera } from "../render/camera";
import type { Shiver } from "../render/shiver";

function setup(scripts: DreamScript[] = []) {
  const world = createWorld(sonArtifact());
  const session = new DreamSession(
    world,
    { show() {}, showStreet() {} } as unknown as RoomScene,
    { setWorldSize() {}, fit() {}, cutTo() {} } as unknown as Camera,
    { trigger() {} } as unknown as Shiver,
    { onEnterRoom() {}, onRefused() {} },
    undefined,
    scripts,
  );
  const figure = world.figures.find((f) => f.id === "turyshev")!;
  const actor = { kind: "figure", id: figure.id } as const;
  const mutator = bindWorldMutator(world, staticPlayerPose(null));
  return { world, session, figure, actor, mutator };
}

describe("NPC world integration regressions", () => {
  test("server envelopes survive dialogue replay and deliver reactions exactly once", () => {
    const events: string[] = [];
    const { world, session, figure, actor } = setup([
      {
        id: "react",
        onWorldEvent(host, event) {
          events.push(event.type);
          if (event.type === "object.taken")
            host.setFlag("taken", event.objectId);
        },
      },
    ]);
    const bottle = world.objects.find((o) => o.mobility === "carryable")!;
    bottle.location = {
      kind: "room",
      roomId: figure.roomId,
      x: figure.x,
      y: figure.y,
    };
    bottle.body = null;
    const server = createNpcWorldSession(snapshot(world), figure.id);
    expect(server.runTool("take", { objectId: bottle.id }).ok).toBe(true);
    const response = { worldActions: [...server.successful] } as DialogueResult;
    const replay = replayWorldActions(
      (e) => session.dispatchWorldAction(e),
      actor,
      "npc",
      worldActionsOf(response),
    );
    expect(replay.ok).toBe(true);
    expect(world.objectById.get(bottle.id)?.location).toEqual({
      kind: "held",
      actor,
    });
    expect(world.flags.get("taken")).toBe(bottle.id);
    expect(events).toEqual(["object.taken"]);
  });

  test("player actions deliver reactions, with a bounded recursive dispatch", () => {
    let calls = 0;
    const { world, session } = setup([
      {
        id: "loop",
        onWorldEvent(host) {
          calls++;
          host.dispatch({
            type: "open",
            targetId: "m6-krugi-vokrug-pruda--exit",
          });
        },
      },
    ]);
    const bottle = world.objects.find((o) => o.mobility === "carryable")!;
    bottle.location = { kind: "held", actor: { kind: "player" } };
    expect(
      session.dispatchWorldAction({
        actor: { kind: "player" },
        source: "player",
        action: { type: "use", objectId: bottle.id },
      }).ok,
    ).toBe(true);
    expect(calls).toBe(8);
  });

  test("M6 opens after three approaches and after reset; NPC cannot unseal it", async () => {
    const { world, session, actor, mutator } = setup([m6Script]);
    const roomId = "m6-krugi-vokrug-pruda";
    await session.enterRoom(roomId, "default", "cut");
    const hotspot = session.room.hotspots.find(
      (h) => h.id === "figura-na-beregu",
    )!;
    const door = world.doorById.get(`${roomId}--exit`)!;
    mutator.setFigurePose(actor.id, { roomId, x: door.x, y: door.y });
    expect(
      session.dispatchWorldAction({
        actor,
        source: "npc",
        action: { type: "open", targetId: door.id },
      }).refusal,
    ).toBe("sealed");
    session.use(hotspot);
    session.use(hotspot);
    session.use(hotspot);
    expect(door.type).toBe("open");
    expect(world.flags.get("m6.unlocked")).toBe(true);
    resetWorld(world);
    m6Script.onCycleReset?.({
      setFlag: (key: string, value: boolean) => world.flags.set(key, value),
    } as never);
    await session.enterRoom(roomId, "default", "cut");
    session.use(hotspot);
    expect(world.doorById.get(door.id)?.type).toBe("open");
  });

  test("examine remains narrative for both E and the action ring", () => {
    const { world, mutator } = setup();
    const object = world.objects.find(
      (o) => o.affordances.length === 1 && o.affordances[0] === "examine",
    )!;
    if (object.location.kind !== "room")
      throw new Error("fixture object must be on the floor");
    mutator.setPlayerPose({
      roomId: object.location.roomId,
      x: object.location.x - 1,
      y: object.location.y,
    });
    const actions = availableActions(
      mutator,
      { kind: "player" },
      { kind: "object", id: object.id },
    );
    expect(primaryObjectAction(actions)?.action).toEqual({
      type: "examine",
      objectId: object.id,
    });
  });

  test("sandbox agrees with live geometry, collisions, reach and arrivals", () => {
    const { world, actor, mutator, figure } = setup();
    const snap = snapshot(world);
    const sandbox = sandboxFromSnapshot(snap);
    const room = world.roomById.get(figure.roomId)!;
    for (let y = -1; y <= room.height; y++) {
      for (let x = -1; x <= room.width; x++) {
        expect(sandbox.canWalk(room.id, x, y)).toBe(
          mutator.canWalk(room.id, x, y),
        );
      }
    }
    expect(sandbox.getDoor(room.doors[0]!.id)).toEqual(
      mutator.getDoor(room.doors[0]!.id),
    );
    const action = {
      actor,
      source: "npc",
      action: { type: "moveTo", x: -100, y: -100 },
    } as const;
    expect(executeWorldAction(sandbox, action)).toEqual(
      executeWorldAction(mutator, action),
    );
    expect(executeWorldAction(sandbox, action).ok).toBe(false);
    const carried = world.objects.find((o) => o.mobility === "carryable")!;
    expect(sandbox.objectById.get(carried.id)?.interaction).toEqual(
      carried.interaction,
    );
    expect(sandbox.clone().canWalk(room.id, -1, -1)).toBe(false);
  });
});
