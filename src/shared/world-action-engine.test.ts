/**
 * WorldActionEngine: player and NPC share one executor.
 */

import { describe, expect, test } from "bun:test";

import { sonArtifact } from "../../dreams/son/pack";
import {
  availableActions,
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
      action: { type: "drop", objectId: "bottle", x: 4, y: 4 },
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
    expect(world.getDoor("a-to-b")?.type).toBe("keyLock");
    expect(world.getDoor("a-to-b")?.closed).toBe(false);
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

  test("script take removes a fixed object without holding it", () => {
    const crate = object({
      id: "crate",
      mobility: "fixed",
      affordances: ["examine"],
      location: { kind: "room", roomId: "a", x: 5, y: 5 },
    });
    const world = worldOf({ objects: [crate], player: null });
    const result = executeWorldAction(world, {
      actor: { kind: "script", id: "pack" },
      source: "script",
      action: { type: "take", objectId: "crate" },
    });
    expect(result.ok).toBe(true);
    expect(crate.location).toEqual({ kind: "removed" });
  });

  test("sleeper open uses the door tile as pose, not a body", () => {
    const hatch = door({ id: "hatch", type: "open", keyId: null, x: 8, y: 8 });
    const world = worldOf({
      doors: [hatch],
      player: null,
      figures: {},
    });
    const result = executeWorldAction(world, {
      actor: { kind: "sleeper" },
      source: "sleeper",
      action: { type: "open", targetId: "hatch" },
    });
    expect(result.ok).toBe(true);
    expect(hatch.type).toBe("open");
  });

  test("Turyshev's courtyard bottle is carryable in the son artifact", () => {
    const world = createWorld(sonArtifact());
    const bottle = world.objectById.get(
      "butylka-riadom-s-turyshevym-ne-pervaia",
    );
    expect(bottle?.mobility).toBe("carryable");
    expect(bottle?.affordances).toContain("take");
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

describe("door and drop regressions", () => {
  test("fractional arrivals use the containing tile without rounding the actor or collision", () => {
    const mutator = createWorldMutator({
      objects: [
        object({
          id: "narrow-body",
          location: { kind: "room", roomId: "b", x: 1, y: 6 },
          body: { w: 0.25, h: 1, solid: true },
        }),
      ],
      figurePoses: [[NPC.id, { roomId: "a", x: 6, y: 3 }]],
      doors: [
        door({ id: "fractional-door", type: "open", toX: 1.5, toY: 6.5 }),
      ],
      isWalkableTile: (roomId, x, y) =>
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        (roomId === "a" ? openFloor(roomId, x, y) : x === 1 && y === 6),
    });
    expect(mutator.canWalk("b", 1.1, 6.5)).toBe(false);
    expect(mutator.canWalk("b", 0.9, 6.5)).toBe(false);
    const result = executeWorldAction(mutator, {
      actor: NPC,
      source: "npc",
      action: { type: "traverseDoor", doorId: "fractional-door" },
    });
    expect(result.ok).toBe(true);
    expect(mutator.getFigurePose(NPC.id)).toEqual({
      roomId: "b",
      x: 1.5,
      y: 6.5,
    });
  });

  test("ordinary close/open and traversal preserve lock policy", () => {
    const world = worldOf({
      doors: [door({ id: "d", type: "open", keyId: null })],
      figures: { "npc-a": { roomId: "a", x: 6, y: 3 } },
    });
    const act = (action: Parameters<typeof executeWorldAction>[1]["action"]) =>
      executeWorldAction(world, { actor: NPC, source: "npc", action });
    expect(act({ type: "close", targetId: "d" }).ok).toBe(true);
    expect(world.getDoor("d")?.closed).toBe(true);
    expect(world.getDoor("d")?.type).toBe("open");
    expect(act({ type: "open", targetId: "d" }).ok).toBe(true);
    expect(world.getDoor("d")?.closed).toBe(false);
    expect(act({ type: "close", targetId: "d" }).ok).toBe(true);
    expect(act({ type: "traverseDoor", doorId: "d" }).ok).toBe(true);
    expect(world.getDoor("d")?.closed).toBe(false);
    expect(world.getFigurePose(NPC.id)?.roomId).toBe("b");
  });

  test("explicit drops cannot teleport a carried item", () => {
    const bottle = object({ id: "b", location: { kind: "held", actor: NPC } });
    const world = worldOf({ objects: [bottle] });
    const far = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "drop", objectId: "b", x: 10, y: 10 },
    });
    expect(far.ok).toBe(false);
    expect(far.refusal).toBe("out of reach");
    expect(bottle.location).toEqual({ kind: "held", actor: NPC });
    const near = executeWorldAction(world, {
      actor: NPC,
      source: "npc",
      action: { type: "drop", objectId: "b", x: 4, y: 6 },
    });
    expect(near.ok).toBe(true);
    expect(bottle.location).toEqual({ kind: "room", roomId: "a", x: 4, y: 6 });
  });
});

describe("physical action boundaries", () => {
  test("container contents stay inaccessible through removed, remote, held, or closed ancestors", () => {
    const roots: Partial<WorldObjectState>[] = [
      { location: { kind: "removed" }, state: { open: true } },
      {
        location: { kind: "room", roomId: "b", x: 4, y: 5 },
        state: { open: true },
      },
      { location: { kind: "held", actor: NPC2 }, state: { open: true } },
      {
        location: { kind: "room", roomId: "a", x: 5, y: 5 },
        state: { open: false },
      },
    ];
    for (const root of roots) {
      const outer = object({ id: "outer", tags: ["container"], ...root });
      const inner = object({
        id: "inner",
        tags: ["container"],
        state: { open: true },
        location: { kind: "inside", objectId: "outer" },
      });
      const item = object({
        id: "item",
        location: { kind: "inside", objectId: "inner" },
      });
      const world = worldOf({ objects: [outer, inner, item] });
      const result = executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "item" },
      });
      expect(result.ok).toBe(false);
      expect(world.revision).toBe(0);
      expect(item.location).toEqual({ kind: "inside", objectId: "inner" });
    }
  });

  test("objects cannot be operated after removal or while another actor holds them", () => {
    for (const location of [
      { kind: "removed" as const },
      { kind: "held" as const, actor: NPC2 },
    ]) {
      for (const type of ["open", "close", "activate", "use"] as const) {
        const item = object({
          id: "item",
          location,
          mobility: "fixed",
          affordances: ["open", "close", "activate", "use"],
        });
        const world = worldOf({ objects: [item] });
        const action =
          type === "open" || type === "close"
            ? { type, targetId: "item" }
            : { type, objectId: "item" };
        expect(
          executeWorldAction(world, { actor: NPC, source: "npc", action }).ok,
        ).toBe(false);
        expect(world.revision).toBe(0);
        expect(item.state).toEqual({});
      }
    }
  });

  test("taking from nested open containers held by the acting NPC remains valid", () => {
    const outer = object({
      id: "outer",
      location: { kind: "held", actor: NPC },
      state: { open: true },
    });
    const inner = object({
      id: "inner",
      location: { kind: "inside", objectId: "outer" },
      state: { open: true },
    });
    const item = object({
      id: "item",
      location: { kind: "inside", objectId: "inner" },
    });
    const world = worldOf({ objects: [outer, inner, item] });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "take", objectId: "item" },
      }).ok,
    ).toBe(true);
    expect(item.location).toEqual({ kind: "held", actor: NPC });
  });

  test("put refuses self containment and containment of an ancestor", () => {
    for (const intoObjectId of ["outer", "inner"]) {
      const outer = object({
        id: "outer",
        location: { kind: "held", actor: NPC },
        tags: ["container"],
        state: { open: true },
      });
      const inner = object({
        id: "inner",
        location: { kind: "inside", objectId: "outer" },
        tags: ["container"],
        state: { open: true },
      });
      const world = worldOf({ objects: [outer, inner] });
      expect(
        executeWorldAction(world, {
          actor: NPC,
          source: "npc",
          action: { type: "put", objectId: "outer", intoObjectId },
        }).ok,
      ).toBe(false);
      expect(outer.location).toEqual({ kind: "held", actor: NPC });
      expect(world.revision).toBe(0);
    }
  });

  test("put refuses a container held by a different NPC", () => {
    const item = object({ id: "item", location: { kind: "held", actor: NPC } });
    const box = object({
      id: "box",
      location: { kind: "held", actor: NPC2 },
      tags: ["container"],
      state: { open: true },
    });
    const world = worldOf({ objects: [item, box] });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "put", objectId: "item", intoObjectId: "box" },
      }).ok,
    ).toBe(false);
    expect(item.location).toEqual({ kind: "held", actor: NPC });
  });

  test("use cannot target a remote door or inaccessible object", () => {
    const tool = object({ id: "tool", location: { kind: "held", actor: NPC } });
    const target = object({ id: "target", location: { kind: "removed" } });
    const world = worldOf({
      objects: [tool, target],
      doors: [door({ id: "remote", fromRoomId: "b" })],
    });
    for (const targetId of ["target", "remote"]) {
      expect(
        executeWorldAction(world, {
          actor: NPC,
          source: "npc",
          action: { type: "use", objectId: "tool", targetId },
        }).ok,
      ).toBe(false);
    }
    expect(world.revision).toBe(0);
  });

  test("NPCs can open and traverse the far end of an authored wall threshold", () => {
    const world = createWorldMutator({
      objects: [],
      figurePoses: [[NPC.id, { roomId: "a", x: 6, y: 1 }]],
      doors: [
        door({
          id: "wall-door",
          type: "open",
          keyId: null,
          x: 3,
          y: 0,
          w: 4,
          h: 1,
        }),
      ],
      isWalkableTile: (roomId, x, y) => openFloor(roomId, x, y) && y > 0,
    });
    expect(world.canWalk("a", 6, 0)).toBe(false);
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "open", targetId: "wall-door" },
      }).ok,
    ).toBe(true);
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "traverseDoor", doorId: "wall-door" },
      }).ok,
    ).toBe(true);
    expect(world.getFigurePose(NPC.id)?.roomId).toBe("b");
  });

  test("traverse refuses an arrival tile occupied by a solid object", () => {
    const world = worldOf({
      objects: [
        object({
          id: "blocker",
          location: { kind: "room", roomId: "b", x: 1, y: 6 },
        }),
      ],
      doors: [door({ id: "d", type: "open", keyId: null })],
      figures: { [NPC.id]: { roomId: "a", x: 6, y: 3 } },
    });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "traverseDoor", doorId: "d" },
      }).ok,
    ).toBe(false);
    expect(world.getFigurePose(NPC.id)?.roomId).toBe("a");
    expect(world.revision).toBe(0);
  });
});

describe("availableActions", () => {
  test("ground objects never offer inventory verbs or self targets", () => {
    const world = worldOf({ objects: [object({ id: "bottle" })] });
    const actions = availableActions(world, PLAYER, {
      kind: "object",
      id: "bottle",
    });
    expect(actions.map((entry) => entry.action.type)).not.toContain("drop");
    expect(actions.map((entry) => entry.action.type)).not.toContain("give");
    expect(actions.map((entry) => entry.action.type)).not.toContain("put");
    expect(actions.find((entry) => entry.action.type === "use")?.refusal).toBe(
      "not held",
    );
    expect(world.revision).toBe(0);
  });

  test("object action refusals account for the acting body's reach", () => {
    const world = worldOf({
      objects: [object({ id: "bottle" })],
      player: { roomId: "a", x: 0, y: 0 },
    });
    const actions = availableActions(world, PLAYER, {
      kind: "object",
      id: "bottle",
    });
    expect(actions.find((entry) => entry.action.type === "take")?.refusal).toBe(
      "out of reach",
    );
    expect(
      actions.find((entry) => entry.action.type === "examine")?.refusal,
    ).toBe("out of reach");
  });

  test("container targets offer concrete put actions for carried items", () => {
    const box = object({
      id: "box",
      mobility: "fixed",
      affordances: ["open", "close"],
      tags: ["container"],
      state: { open: true },
    });
    const bottle = object({
      id: "bottle",
      location: { kind: "held", actor: PLAYER },
    });
    const world = worldOf({ objects: [box, bottle] });
    const actions = availableActions(world, PLAYER, {
      kind: "object",
      id: "box",
    });
    expect(
      actions.find((entry) => entry.action.type === "put")?.action,
    ).toEqual({ type: "put", objectId: "bottle", intoObjectId: "box" });
    expect(bottle.location).toEqual({ kind: "held", actor: PLAYER });
  });

  test("figure targets offer every transferable item and explain distance refusals", () => {
    const world = worldOf({
      objects: [
        object({
          id: "bound",
          location: { kind: "held", actor: PLAYER },
          affordances: ["use"],
        }),
        object({ id: "bottle", location: { kind: "held", actor: PLAYER } }),
        object({ id: "cup", location: { kind: "held", actor: PLAYER } }),
      ],
    });
    const actions = availableActions(world, PLAYER, {
      kind: "figure",
      id: NPC2.id,
    });
    expect(actions).toHaveLength(2);
    expect(
      actions.every(
        (entry) =>
          entry.action.type === "give" && entry.refusal === "different room",
      ),
    ).toBe(true);
  });
});

describe("sandbox geometry invariants", () => {
  test("cloning does not resurrect a figure whose live pose was removed", () => {
    const world = worldOf({});
    world.getFigurePose = () => null;
    expect(cloneWorldMutator(world).getFigurePose(NPC.id)).toBeNull();
  });

  test("a cloned mutator observes the latest door view rather than its cached map", () => {
    const world = worldOf({
      doors: [door({ id: "d", type: "open", keyId: null })],
    });
    const latest = door({
      id: "d",
      type: "sealed",
      keyId: null,
      toRoomId: "c",
      closed: true,
    });
    world.getDoor = (id) => (id === "d" ? { ...latest } : null);
    expect(cloneWorldMutator(world).getDoor("d")).toEqual(latest);
  });

  test("NPC movement cannot squeeze diagonally between touching walls", () => {
    const world = createWorldMutator({
      objects: [],
      figurePoses: [[NPC.id, { roomId: "a", x: 0, y: 0 }]],
      isWalkableTile: (_room, x, y) =>
        (x === 0 && y === 0) || (x === 1 && y === 1),
    });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "moveTo", x: 1, y: 1 },
      }).ok,
    ).toBe(false);
    expect(world.getFigurePose(NPC.id)).toEqual({ roomId: "a", x: 0, y: 0 });
  });
});

describe("authored fixture access", () => {
  test("the Nilyufar window remains examinable from the adjacent floor", () => {
    const world = createWorld(sonArtifact());
    const mutator = bindWorldMutator(
      world,
      staticPlayerPose({
        roomId: "21-komnata-niliufar",
        x: 8.5,
        y: 3.15,
      }),
    );
    expect(mutator.isWalkableTile("21-komnata-niliufar", 7, 1)).toBe(false);
    const options = availableActions(mutator, PLAYER, {
      kind: "object",
      id: "okno-s-vidom",
    });
    expect(
      options.find((entry) => entry.affordance === "examine")?.refusal,
    ).toBeNull();
  });
});

describe("drop placement boundaries", () => {
  test("a carried object's whole body must fit before an explicit drop", () => {
    for (const obstruction of ["wall", "object"] as const) {
      const box = object({
        id: "box",
        location: { kind: "held", actor: NPC },
        body: { w: 3, h: 2, solid: true },
      });
      const items =
        obstruction === "object"
          ? [
              box,
              object({
                id: "blocker",
                location: { kind: "room", roomId: "a", x: 7, y: 5 },
              }),
            ]
          : [box];
      const x = obstruction === "wall" ? 11 : 5;
      const world = worldOf({
        objects: items,
        figures: { [NPC.id]: { roomId: "a", x: x - 1, y: 5 } },
      });
      expect(
        executeWorldAction(world, {
          actor: NPC,
          source: "npc",
          action: { type: "drop", objectId: "box", x, y: 5 },
        }).ok,
      ).toBe(false);
      expect(box.location).toEqual({ kind: "held", actor: NPC });
      expect(world.revision).toBe(0);
    }
  });

  test("automatic drops choose a nearby place where the entire object fits", () => {
    const box = object({
      id: "box",
      location: { kind: "held", actor: NPC },
      body: { w: 3, h: 2, solid: true },
    });
    const world = worldOf({
      objects: [box],
      figures: { [NPC.id]: { roomId: "a", x: 10, y: 5 } },
    });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "drop", objectId: "box" },
      }).ok,
    ).toBe(true);
    expect(box.location).toEqual({ kind: "room", roomId: "a", x: 9, y: 6 });
  });

  test("automatic drops do not move an item across an impassable corner", () => {
    const item = object({ id: "item", location: { kind: "held", actor: NPC } });
    const blocker = object({
      id: "blocker",
      location: { kind: "room", roomId: "a", x: 0, y: 0 },
    });
    const world = createWorldMutator({
      objects: [item, blocker],
      figurePoses: [[NPC.id, { roomId: "a", x: 0, y: 0 }]],
      isWalkableTile: (_roomId, x, y) =>
        (x === 0 && y === 0) || (x === 1 && y === 1),
    });
    expect(
      executeWorldAction(world, {
        actor: NPC,
        source: "npc",
        action: { type: "drop", objectId: "item" },
      }).ok,
    ).toBe(false);
    expect(item.location).toEqual({ kind: "held", actor: NPC });
  });
});

describe("expressive item actions", () => {
  test("breaking a portable item preserves clue/key identity, collision, location, and lock policy", () => {
    for (const mobility of ["movable", "carryable"] as const) {
      const item = object({
        id: "rebus",
        mobility,
        clueId: "clue",
        holdsShardId: "shard",
        keyId: "key1",
        state: { open: false, locked: true },
      });
      const world = worldOf({ objects: [item] });
      const before = structuredClone(item);
      const result = executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: {
          type: "alter",
          objectId: item.id,
          verb: "разбить",
          changes: { broken: true },
        },
      });
      expect(result.ok).toBe(true);
      expect(item).toEqual({
        ...before,
        state: { ...before.state, broken: true },
      });
      expect(world.canWalk("a", 5, 5)).toBe(false);
      expect(result.events).toEqual([
        {
          type: "object.changed",
          objectId: "rebus",
          targetId: null,
          actor: PLAYER,
          verb: "разбить",
          before: { open: false, locked: true },
          after: { open: false, locked: true, broken: true },
        },
      ]);
      item.state.dirty = true;
      const event = result.events[0]!;
      if (event.type === "object.changed")
        expect(event.after.dirty).toBeUndefined();
    }
  });

  test("wetting, cleaning, and inscriptions persist on the acted-on item", () => {
    const bench = object({
      id: "bench",
      mobility: "fixed",
      state: { dirty: true },
    });
    const bottle = object({
      id: "bottle",
      location: { kind: "held", actor: PLAYER },
    });
    const world = worldOf({ objects: [bench, bottle] });
    expect(
      executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: {
          type: "alter",
          objectId: "bench",
          targetId: "bottle",
          verb: "вымыть и подписать",
          changes: { wet: true, dirty: false, inscription: "Я здесь был" },
        },
      }).ok,
    ).toBe(true);
    expect(bench.state).toEqual({
      wet: true,
      dirty: false,
      inscription: "Я здесь был",
    });
    expect(bottle.state).toEqual({});
    expect(
      executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: {
          type: "alter",
          objectId: "bench",
          verb: "стереть надпись",
          changes: { inscription: "" },
        },
      }).ok,
    ).toBe(true);
    expect(bench.state.inscription).toBe("");
  });

  test("alter refuses structural damage, policy changes, invalid text, and empty changes atomically", () => {
    const actions = [
      {
        type: "alter",
        objectId: "wall",
        verb: "сломать",
        changes: { broken: true },
      },
      {
        type: "alter",
        objectId: "wall",
        verb: "починить",
        changes: { broken: false },
      },
      {
        type: "alter",
        objectId: "wall",
        verb: "отпереть",
        changes: { locked: false },
      },
      {
        type: "alter",
        objectId: "wall",
        verb: "открыть",
        changes: { open: true },
      },
      { type: "alter", objectId: "wall", verb: "ничего", changes: {} },
      { type: "alter", objectId: "wall", verb: " ", changes: { dirty: true } },
      {
        type: "alter",
        objectId: "wall",
        verb: "написать",
        changes: { inscription: "x".repeat(241) },
      },
    ];
    for (const action of actions) {
      const wall = object({
        id: "wall",
        mobility: "fixed",
        state: { locked: true },
      });
      const world = worldOf({ objects: [wall] });
      const result = executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: action as Parameters<typeof executeWorldAction>[1]["action"],
      });
      expect(result.ok).toBe(false);
      expect(wall.state).toEqual({ locked: true });
      expect(result.events).toEqual([]);
      expect(world.revision).toBe(0);
    }
  });

  test("alter checks both participants before changing anything", () => {
    const item = object({ id: "item" });
    const other = object({
      id: "other",
      location: { kind: "room", roomId: "b", x: 4, y: 5 },
    });
    const world = worldOf({ objects: [item, other] });
    expect(
      executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: {
          type: "alter",
          objectId: "item",
          targetId: "other",
          verb: "намочить",
          changes: { wet: true },
        },
      }).refusal,
    ).toBe("different room");
    item.location = { kind: "held", actor: NPC };
    expect(
      executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: {
          type: "alter",
          objectId: "item",
          verb: "испачкать",
          changes: { dirty: true },
        },
      }).refusal,
    ).toBe("not held");
    expect(item.state).toEqual({});
    expect(world.revision).toBe(0);
  });

  test("an unmodelled gesture emits an explicit no-effect event without fabricating state", () => {
    const item = object({ id: "cup" });
    const world = worldOf({ objects: [item] });
    const before = structuredClone(item);
    const result = executeWorldAction(world, {
      actor: PLAYER,
      source: "player",
      action: {
        type: "gesture",
        objectId: "cup",
        verb: "прислушаться к чашке",
      },
    });
    expect(result.ok).toBe(true);
    expect(item).toEqual(before);
    expect(result.events).toEqual([
      {
        type: "object.gestured",
        objectId: "cup",
        targetId: null,
        actor: PLAYER,
        verb: "прислушаться к чашке",
        effect: "none",
      },
    ]);
    expect(
      executeWorldAction(world, {
        actor: PLAYER,
        source: "player",
        action: { type: "gesture", objectId: "cup", verb: "x".repeat(81) },
      }).ok,
    ).toBe(false);
  });

  test("script reactions can alter items but new actions do not expand NPC permissions", () => {
    const item = object({ id: "cup" });
    const world = worldOf({ objects: [item] });
    const action = {
      type: "alter" as const,
      objectId: "cup",
      verb: "испачкать",
      changes: { dirty: true },
    };
    expect(
      executeWorldAction(world, { actor: NPC, source: "npc", action }).refusal,
    ).toBe("npc cannot perform this action");
    expect(
      executeWorldAction(world, {
        actor: { kind: "script", id: "reaction" },
        source: "script",
        action,
      }).ok,
    ).toBe(true);
    expect(item.state.dirty).toBe(true);
  });
});

test("expressive actions respect authored refusals on either participant", () => {
  const inaccessible = object({
    id: "pear",
    interaction: { reach: 2, prompt: "груша", refusal: "за стеклом" },
  });
  const cup = object({ id: "cup", location: { kind: "held", actor: PLAYER } });
  const world = worldOf({ objects: [inaccessible, cup] });
  for (const action of [
    {
      type: "alter",
      objectId: "pear",
      verb: "испачкать",
      changes: { dirty: true },
    },
    { type: "gesture", objectId: "pear", verb: "дотронуться" },
    {
      type: "alter",
      objectId: "cup",
      targetId: "pear",
      verb: "натереть грушей",
      changes: { dirty: true },
    },
  ] as const) {
    expect(
      executeWorldAction(world, { actor: PLAYER, source: "player", action })
        .refusal,
    ).toBe("за стеклом");
  }
  expect(world.revision).toBe(0);
  expect(cup.state).toEqual({});
  expect(inaccessible.state).toEqual({});
});
