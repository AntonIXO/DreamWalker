/**
 * WorldActionEngine: player and NPC share one executor.
 */

import { describe, expect, test } from "bun:test";

import { sonArtifact } from "../../dreams/son/pack";
import {
  cloneWorldMutator,
  createWorldMutator,
  executeWorldAction,
  refused,
} from "./world-action-engine";
import type {
  ActorPose,
  WorldDoorView,
  WorldMutator,
  WorldObjectState,
} from "./world-object";
import { createWorld } from "../player/game/world";
import {
  bindWorldMutator,
  staticPlayerPose,
} from "../player/game/world-mutator";

const NPC: { kind: "figure"; id: string } = { kind: "figure", id: "npc-a" };
const NPC2: { kind: "figure"; id: string } = { kind: "figure", id: "npc-b" };
const PLAYER = { kind: "player" as const };

const CARRY = [
  "examine",
  "take",
  "drop",
  "give",
  "put",
  "use",
] as WorldObjectState["affordances"];

function openFloor(_roomId: string, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < 12 && y < 12;
}

function object(
  partial: Partial<WorldObjectState> & Pick<WorldObjectState, "id">,
): WorldObjectState {
  return {
    name: partial.name ?? partial.id,
    location: partial.location ?? { kind: "room", roomId: "a", x: 5, y: 5 },
    mobility: partial.mobility ?? "carryable",
    affordances: partial.affordances ?? [...CARRY],
    body:
      partial.body === undefined ? { w: 1, h: 1, solid: true } : partial.body,
    visual: partial.visual ?? { role: null, image: null },
    interaction:
      partial.interaction === undefined
        ? { reach: 1.5, prompt: partial.name ?? partial.id, refusal: null }
        : partial.interaction,
    state: partial.state ?? {},
    tags: partial.tags ?? [],
    clueId: partial.clueId ?? null,
    holdsShardId: partial.holdsShardId ?? null,
    sensorySeed: partial.sensorySeed ?? null,
    once: partial.once ?? false,
    dwellMs: partial.dwellMs ?? null,
    keyId: partial.keyId ?? null,
    hotspotKind: partial.hotspotKind ?? null,
    uiAction: partial.uiAction ?? null,
    ...partial,
    id: partial.id,
  };
}

function door(
  partial: Partial<WorldDoorView> & Pick<WorldDoorView, "id">,
): WorldDoorView {
  return {
    type: "keyLock",
    fromRoomId: "a",
    toRoomId: "b",
    x: 6,
    y: 2,
    w: 2,
    h: 1,
    keyId: "key1",
    threshold: "door",
    toX: 1,
    toY: 6,
    ...partial,
  };
}

function worldOf(input: {
  objects?: WorldObjectState[];
  player?: ActorPose | null;
  figures?: Record<string, ActorPose>;
  doors?: WorldDoorView[];
  keysHeld?: string[];
}): WorldMutator {
  return createWorldMutator({
    objects: input.objects ?? [],
    playerPose:
      input.player === undefined ? { roomId: "a", x: 4, y: 5 } : input.player,
    figurePoses: Object.entries(
      input.figures ?? {
        "npc-a": { roomId: "a", x: 4, y: 5 },
        "npc-b": { roomId: "b", x: 3, y: 3 },
      },
    ),
    doors: input.doors ?? [],
    keysHeld: input.keysHeld ?? [],
    isWalkableTile: openFloor,
  });
}

describe("executeWorldAction", () => {
  test("NPC walks to a bottle, take: held, cell walkable", () => {
    const bottle = object({
      id: "bottle",
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const world = worldOf({
      objects: [bottle],
      figures: { "npc-a": { roomId: "a", x: 2, y: 5 } },
    });
    expect(world.canWalk("a", 5, 5)).toBe(false);

    const walked = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "moveTo", x: 4, y: 5 },
    });
    expect(walked.ok).toBe(true);
    expect(world.getFigurePose("npc-a")).toEqual({ roomId: "a", x: 4, y: 5 });

    const taken = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "bottle" },
    });
    expect(taken.ok).toBe(true);
    expect(bottle.location).toEqual({ kind: "held", actor: NPC });
    expect(world.canWalk("a", 5, 5)).toBe(true);
    expect(taken.events.some((event) => event.type === "object.taken")).toBe(
      true,
    );
  });

  test("NPC give bottle to player; player drop in another room; second NPC takes it", () => {
    const bottle = object({
      id: "bottle",
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const world = worldOf({
      objects: [bottle],
      player: { roomId: "a", x: 4, y: 6 },
      figures: {
        "npc-a": { roomId: "a", x: 4, y: 5 },
        "npc-b": { roomId: "b", x: 3, y: 3 },
      },
    });

    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "bottle" },
      }).ok,
    ).toBe(true);

    const given = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "give", objectId: "bottle", to: PLAYER },
    });
    expect(given.ok).toBe(true);
    expect(bottle.location).toEqual({ kind: "held", actor: PLAYER });

    world.setPlayerPose({ roomId: "b", x: 3, y: 4 });
    const dropped = executeWorldAction(world, {
      actor: PLAYER,
      source: "player",
      action: { type: "drop", objectId: "bottle" },
    });
    expect(dropped.ok).toBe(true);
    expect(bottle.location.kind).toBe("room");
    if (bottle.location.kind === "room") {
      expect(bottle.location.roomId).toBe("b");
    }

    const taken = executeWorldAction(world, {
      actor: NPC2,
      source: "npc",
      action: { type: "take", objectId: "bottle" },
    });
    expect(taken.ok).toBe(true);
    expect(bottle.location).toEqual({ kind: "held", actor: NPC2 });
  });

  test("put into open container then take back; closed container refuses", () => {
    const bottle = object({
      id: "bottle",
      location: { kind: "held", actor: NPC },
      body: { w: 1, h: 1, solid: false },
    });
    const box = object({
      id: "box",
      mobility: "fixed",
      affordances: ["examine", "open", "close"],
      tags: ["container"],
      location: { kind: "room", roomId: "a", x: 5, y: 6 },
      state: { open: true },
      body: { w: 1, h: 1, solid: true },
    });
    const world = worldOf({ objects: [bottle, box] });

    const put = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "put", objectId: "bottle", intoObjectId: "box" },
    });
    expect(put.ok).toBe(true);
    expect(bottle.location).toEqual({ kind: "inside", objectId: "box" });

    const taken = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "bottle" },
    });
    expect(taken.ok).toBe(true);
    expect(bottle.location).toEqual({ kind: "held", actor: NPC });

    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "put", objectId: "bottle", intoObjectId: "box" },
      }).ok,
    ).toBe(true);

    box.state.open = false;
    const refusedClosed = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "bottle" },
    });
    expect(refusedClosed.ok).toBe(false);
    expect(bottle.location.kind).toBe("inside");

    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "bottle" },
      }).ok,
    ).toBe(false);

    const held = object({
      id: "held-bottle",
      location: { kind: "held", actor: NPC },
    });
    const closed = object({
      id: "closed-box",
      mobility: "fixed",
      affordances: ["examine", "open", "close"],
      tags: ["container"],
      location: { kind: "room", roomId: "a", x: 6, y: 6 },
      state: { open: false },
    });
    const world2 = worldOf({ objects: [held, closed] });
    const putClosed = executeWorldAction(world2, {
      actor: NPC,
      source: "npc",
      action: {
        type: "put",
        objectId: "held-bottle",
        intoObjectId: "closed-box",
      },
    });
    expect(putClosed.ok).toBe(false);
    expect(held.location.kind).toBe("held");
  });

  test("open door with matching key object; without key, refusal and type unchanged", () => {
    const key = object({
      id: "brass-key",
      keyId: "key1",
      location: { kind: "held", actor: NPC },
      body: { w: 1, h: 1, solid: false },
    });
    const locked = door({ id: "a-to-b", type: "keyLock", keyId: "key1" });
    const world = worldOf({
      objects: [key],
      doors: [locked],
      figures: { "npc-a": { roomId: "a", x: 6, y: 3 } },
    });

    const opened = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "open", targetId: "a-to-b" },
    });
    expect(opened.ok).toBe(true);
    expect(world.getDoor("a-to-b")?.type).toBe("open");
    expect(opened.events.some((event) => event.type === "door.opened")).toBe(
      true,
    );

    const lockedAgain = door({ id: "a-to-b", type: "keyLock", keyId: "key1" });
    const noKey = worldOf({
      objects: [],
      doors: [lockedAgain],
      figures: { "npc-a": { roomId: "a", x: 6, y: 3 } },
    });
    const failed = executeWorldAction(noKey, {
      actor: NPC,
      source: "npc",
      action: { type: "open", targetId: "a-to-b" },
    });
    expect(failed.ok).toBe(false);
    expect(failed.refusal).toBeTruthy();
    expect(noKey.getDoor("a-to-b")?.type).toBe("keyLock");
  });

  test("hallucinated object id refuses", () => {
    const world = worldOf({ objects: [] });
    const result = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "ghost-cup" },
    });
    expect(result).toEqual(refused("no such object"));
  });

  test("action out of reach refuses", () => {
    const bottle = object({
      id: "bottle",
      location: { kind: "room", roomId: "a", x: 10, y: 10 },
    });
    const world = worldOf({
      objects: [bottle],
      figures: { "npc-a": { roomId: "a", x: 1, y: 1 } },
    });
    const result = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "bottle" },
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("out of reach");
    expect(bottle.location.kind).toBe("room");
  });

  test("affordance missing refuses", () => {
    const crate = object({
      id: "crate",
      mobility: "carryable",
      affordances: ["examine"],
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const world = worldOf({ objects: [crate] });
    const result = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "crate" },
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBeTruthy();
    expect(crate.location.kind).toBe("room");
  });

  test("NPC envelope with actor.kind player refuses", () => {
    const world = worldOf({ objects: [] });
    const result = executeWorldAction(world, {
      actor: PLAYER,
      source: "npc",
      action: { type: "moveTo", x: 5, y: 5 },
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe(
      "npc actor must be a figure; server wraps figureId",
    );
  });

  test("take then drop preserves clueId and holdsShardId", () => {
    const shard = object({
      id: "note",
      clueId: "clue-1",
      holdsShardId: "shard1",
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const world = worldOf({ objects: [shard] });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "note" },
      }).ok,
    ).toBe(true);
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "drop", objectId: "note" },
      }).ok,
    ).toBe(true);
    expect(shard.clueId).toBe("clue-1");
    expect(shard.holdsShardId).toBe("shard1");
  });

  test("same take function works for actor player and actor figure", () => {
    const forNpc = object({
      id: "apple",
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const npcWorld = worldOf({ objects: [forNpc] });
    expect(
      executeWorldAction(npcWorld, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "apple" },
      }).ok,
    ).toBe(true);

    const forPlayer = object({
      id: "pear",
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const playerWorld = worldOf({ objects: [forPlayer] });
    expect(
      executeWorldAction(playerWorld, {
        actor: PLAYER,
        source: "player",
        action: { type: "take", objectId: "pear" },
      }).ok,
    ).toBe(true);
    expect(forPlayer.location).toEqual({ kind: "held", actor: PLAYER });
  });

  test("use emits object.used even without a script", () => {
    const wand = object({
      id: "wand",
      location: { kind: "held", actor: NPC },
      body: { w: 1, h: 1, solid: false },
    });
    const world = worldOf({ objects: [wand] });
    const result = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "use", objectId: "wand" },
    });
    expect(result.ok).toBe(true);
    expect(result.events).toEqual([
      { type: "object.used", objectId: "wand", targetId: null, actor: NPC },
    ]);
  });

  test("authored refusal is returned when the affordance is blocked", () => {
    const pear = object({
      id: "pear",
      mobility: "fixed",
      affordances: ["examine"],
      interaction: {
        reach: 1.5,
        prompt: "груша",
        refusal: "достать её нельзя, это проверено",
      },
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const world = worldOf({ objects: [pear] });
    const result = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "take", objectId: "pear" },
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("достать её нельзя, это проверено");
  });
});

describe("cloneWorldMutator", () => {
  test("mutate clone, live unchanged", () => {
    const bottle = object({ id: "bottle" });
    const live = worldOf({
      objects: [bottle],
      keysHeld: ["spare"],
    });
    const clone = cloneWorldMutator(live);
    expect(
      executeWorldAction(clone, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "bottle" },
      }).ok,
    ).toBe(true);

    expect(bottle.location.kind).toBe("room");
    expect(clone.objectById.get("bottle")?.location.kind).toBe("held");
    expect(live.keysHeld.has("spare")).toBe(true);
    clone.keysHeld.delete("spare");
    expect(live.keysHeld.has("spare")).toBe(true);
    clone.setFigurePose("npc-a", { roomId: "b", x: 0, y: 0 });
    expect(live.getFigurePose("npc-a")?.roomId).toBe("a");
    expect(clone.objects).not.toBe(live.objects);
    expect(clone.keysHeld).not.toBe(live.keysHeld);
    expect(clone.figurePoses).not.toBe(live.figurePoses);
    expect(clone.doorById).not.toBe(live.doorById);
  });
});

describe("createWorld integration", () => {
  test("son pack migrates courtyard objects", () => {
    const artifact = sonArtifact();
    const world = createWorld(artifact);
    expect(world.objects.length).toBeGreaterThan(0);
    const bottle = world.objectById.get(
      "butylka-riadom-s-turyshevym-ne-pervaia",
    );
    expect(bottle).toBeTruthy();
    expect(bottle?.location).toEqual({
      kind: "room",
      roomId: "19-dvor-i-oranzhevye-lavochki",
      x: 2,
      y: 4,
    });
    const mutator = bindWorldMutator(
      world,
      staticPlayerPose({
        roomId: "19-dvor-i-oranzhevye-lavochki",
        x: 10,
        y: 6,
      }),
    );
    expect(mutator.objects.length).toBe(world.objects.length);
    expect(
      mutator.getDoor([...world.doorById.keys()][0]!)?.fromRoomId,
    ).toBeTruthy();
  });
});
