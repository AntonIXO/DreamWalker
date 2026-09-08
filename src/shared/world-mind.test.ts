import { describe, expect, test } from "bun:test";
import { createWorldMutator, executeWorldAction } from "./world-action-engine";
import type { WorldActionEnvelope, WorldAction } from "./world-action";
import type { WorldObjectState } from "./world-object";
import { runReactions } from "./world-reaction";
import {
  captureWorldAction,
  createWorldMind,
  MAX_WORLD_MIND_EVENTS,
  recordWorldAction,
  worldMindForFigure,
} from "./world-mind";

function object(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "cup",
    name: "чашка",
    location: { kind: "room", roomId: "a", x: 2, y: 2 },
    mobility: "carryable",
    affordances: ["take", "drop", "put", "give", "use", "open", "close"],
    body: null,
    visual: { role: "prop", image: null },
    interaction: null,
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

function setup() {
  const world = createWorldMutator({
    objects: [object()],
    playerPose: { roomId: "a", x: 1, y: 2 },
    figurePoses: [
      ["actor", { roomId: "a", x: 1, y: 2 }],
      ["near", { roomId: "a", x: 1, y: 3 }],
      ["behind-wall", { roomId: "a", x: 5, y: 2 }],
      ["far", { roomId: "a", x: 24, y: 2 }],
      ["elsewhere", { roomId: "b", x: 1, y: 2 }],
    ],
    isWalkableTile: (_room, x, y) =>
      x >= 0 && y >= 0 && x < 30 && y < 10 && x !== 4,
  });
  const mind = createWorldMind();
  const run = (action: WorldAction) => {
    const envelope: WorldActionEnvelope = {
      actor: { kind: "figure", id: "actor" },
      source: "npc",
      action,
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    return {
      result,
      event: recordWorldAction(mind, world, envelope, result, before, 3),
    };
  };
  return { world, mind, run };
}

describe("World Mind receipts", () => {
  test("records successful before/after facts and only actual nearby witnesses", () => {
    const { world, mind, run } = setup();
    expect(run({ type: "take", objectId: "cup" }).result.ok).toBe(true);
    const event = mind.events[0]!;
    expect(event.cycle).toBe(3);
    expect(event.source).toBe("npc");
    expect(event.witnessIds).toEqual(["actor", "near"]);
    expect(event.before.objects[0]?.location.kind).toBe("room");
    expect(event.after.objects[0]?.location).toEqual({
      kind: "held",
      actor: { kind: "figure", id: "actor" },
    });
    expect(worldMindForFigure(mind, "actor")[0]?.action).toEqual({
      type: "take",
      objectId: "cup",
    });
    expect(worldMindForFigure(mind, "near")[0]?.action).toBeNull();
    expect(worldMindForFigure(mind, "far")).toEqual([]);
    expect(worldMindForFigure(mind, "behind-wall")).toEqual([]);
    world.setFigurePose("far", { roomId: "a", x: 1, y: 2 });
    expect(worldMindForFigure(mind, "far")).toEqual([]);
    world.objectById.get("cup")!.name = "changed later";
    expect(event.after.objects[0]?.name).toBe("чашка");
    const scoped = worldMindForFigure(mind, "near");
    scoped[0]!.before.objects[0]!.name = "changed copy";
    expect(event.before.objects[0]?.name).toBe("чашка");
  });

  test("a refused intention is not recorded as an observed world action", () => {
    const { mind, run } = setup();
    expect(run({ type: "take", objectId: "missing" }).result.ok).toBe(false);
    expect(mind.events).toEqual([]);
    expect(mind.nextSequence).toBe(1);
  });

  test("moving to a distant point in one room does not disclose the endpoint to a source witness", () => {
    const world = createWorldMutator({
      objects: [],
      figurePoses: [
        ["actor", { roomId: "a", x: 1, y: 1 }],
        ["source", { roomId: "a", x: 1, y: 2 }],
        ["destination", { roomId: "a", x: 24, y: 2 }],
      ],
      isWalkableTile: (_room, x, y) => x >= 0 && y >= 0 && x < 30 && y < 10,
    });
    const mind = createWorldMind();
    const envelope: WorldActionEnvelope = {
      actor: { kind: "figure", id: "actor" },
      source: "npc",
      action: { type: "moveTo", x: 24, y: 1 },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(mind, world, envelope, result, before, 1);
    const source = worldMindForFigure(mind, "source")[0]!;
    expect(source.before.actor?.x).toBe(1);
    expect(source.after.actor).toBeNull();
    expect(source.events).toEqual([]);
    expect(source.action).toBeNull();
    const destination = worldMindForFigure(mind, "destination")[0]!;
    expect(destination.before.actor).toBeNull();
    expect(destination.after.actor?.x).toBe(24);
  });

  test("a closed container hides the removal of an item inside it", () => {
    const { world, mind } = setup();
    const box = object({
      id: "box",
      mobility: "fixed",
      state: { open: false },
    });
    world.objects.push(box);
    world.objectById.set(box.id, box);
    const cup = world.objectById.get("cup")!;
    cup.location = { kind: "inside", objectId: "box" };
    const envelope: WorldActionEnvelope = {
      actor: { kind: "script", id: "test" },
      source: "script",
      action: { type: "take", objectId: "cup" },
    };
    const before = captureWorldAction(world, envelope);
    cup.location = { kind: "removed" };
    recordWorldAction(
      mind,
      world,
      envelope,
      {
        ok: true,
        refusal: null,
        affectedObjects: [cup.id],
        affectedRooms: ["a"],
        events: [
          {
            type: "object.taken",
            objectId: cup.id,
            actor: envelope.actor,
            fromRoomId: "a",
          },
        ],
      },
      before,
      1,
    );
    expect(mind.events[0]?.witnessIds).toEqual([]);
    expect(worldMindForFigure(mind, "near")).toEqual([]);
  });

  test("a witnessed drop does not disclose the destination behind a wall", () => {
    const cup = object({
      location: { kind: "held", actor: { kind: "figure", id: "actor" } },
    });
    const world = createWorldMutator({
      objects: [cup],
      figurePoses: [
        ["actor", { roomId: "a", x: 2, y: 0 }],
        ["witness", { roomId: "a", x: 0, y: 0 }],
      ],
      isWalkableTile: (_room, x, y) =>
        x >= 0 && x < 5 && y >= 0 && y < 5 && !(x === 1 && y === 1),
    });
    const mind = createWorldMind();
    const envelope: WorldActionEnvelope = {
      actor: { kind: "figure", id: "actor" },
      source: "npc",
      action: { type: "drop", objectId: "cup", x: 2, y: 1 },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(mind, world, envelope, result, before, 1);
    const seen = worldMindForFigure(mind, "witness")[0]!;
    expect(seen.before.objects).toHaveLength(1);
    expect(seen.after.objects).toEqual([]);
    expect(seen.events).toEqual([]);
    expect(seen.action).toBeNull();
  });

  test("door state is captured independently from a mutable adapter view", () => {
    const { world } = setup();
    const door = {
      id: "door",
      type: "open",
      closed: true,
      fromRoomId: "a",
      toRoomId: "b",
      x: 2,
      y: 2,
      w: 1,
      h: 1,
      keyId: null,
      threshold: "door",
      toX: 3,
      toY: 3,
    };
    world.getDoor = () => door;
    const before = captureWorldAction(world, {
      actor: { kind: "figure", id: "actor" },
      source: "npc",
      action: { type: "open", targetId: "door" },
    });
    door.closed = false;
    expect(before.state.door?.closed).toBe(true);
  });

  test("a disappearing cup does not identify the thief hidden behind a wall", () => {
    const world = createWorldMutator({
      objects: [
        object({ location: { kind: "room", roomId: "a", x: 2, y: 0 } }),
      ],
      figurePoses: [
        ["hidden-thief", { roomId: "a", x: 2, y: 1 }],
        ["witness", { roomId: "a", x: 0, y: 0 }],
      ],
      isWalkableTile: (_room, x, y) =>
        x >= 0 && x < 5 && y >= 0 && y < 5 && !(x === 1 && y === 1),
    });
    const mind = createWorldMind();
    const envelope: WorldActionEnvelope = {
      actor: { kind: "figure", id: "hidden-thief" },
      source: "npc",
      action: { type: "take", objectId: "cup" },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(mind, world, envelope, result, before, 1);
    const seen = worldMindForFigure(mind, "witness")[0]!;
    expect(seen.before.objects).toHaveLength(1);
    expect(seen.after.objects).toEqual([]);
    expect(seen.actor).toBeNull();
    expect(seen.source).toBeNull();
    expect(seen.actionType).toBeNull();
    expect(JSON.stringify(seen)).not.toContain("hidden-thief");
  });

  test("a departing actor does not reveal the far side of a door to a source witness", () => {
    const world = createWorldMutator({
      objects: [],
      figurePoses: [
        ["actor", { roomId: "a", x: 1, y: 1 }],
        ["source", { roomId: "a", x: 1, y: 2 }],
        ["destination", { roomId: "secret-room", x: 8, y: 9 }],
      ],
      doors: [
        {
          id: "door",
          type: "open",
          closed: false,
          fromRoomId: "a",
          toRoomId: "secret-room",
          x: 1,
          y: 1,
          w: 1,
          h: 1,
          keyId: null,
          threshold: "door",
          toX: 8,
          toY: 8,
        },
      ],
      isWalkableTile: (_room, x, y) => x >= 0 && x < 20 && y >= 0 && y < 20,
    });
    const mind = createWorldMind();
    const envelope: WorldActionEnvelope = {
      actor: { kind: "figure", id: "actor" },
      source: "npc",
      action: { type: "traverseDoor", doorId: "door" },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(mind, world, envelope, result, before, 1);
    const source = worldMindForFigure(mind, "source")[0]!;
    expect(source.before.actor?.roomId).toBe("a");
    expect(source.after.actor).toBeNull();
    expect(JSON.stringify(source)).not.toContain("secret-room");
    expect(JSON.stringify(worldMindForFigure(mind, "actor"))).toContain(
      "secret-room",
    );
    const destination = worldMindForFigure(mind, "destination")[0]!;
    expect(destination.before.actor).toBeNull();
    expect(destination.after.actor?.roomId).toBe("secret-room");
    expect(destination.events.map((event) => event.type)).toEqual([
      "actor.moved",
    ]);
  });

  test("history stays bounded while sequence numbers stay monotone", () => {
    const { mind, run } = setup();
    for (let i = 0; i < MAX_WORLD_MIND_EVENTS + 3; i++)
      run({ type: "moveTo", x: 1, y: 2 });
    expect(mind.events).toHaveLength(MAX_WORLD_MIND_EVENTS);
    expect(mind.events[0]?.sequence).toBe(4);
    expect(mind.nextSequence).toBe(MAX_WORLD_MIND_EVENTS + 4);
    expect(worldMindForFigure(mind, "actor", 2)).toHaveLength(2);
    expect(worldMindForFigure(mind, "actor", 0)).toEqual([]);
  });
});

describe("expressive item receipts", () => {
  test("real item changes persist in witnessed facts and can trigger authored reactions", () => {
    const { world, mind } = setup();
    const envelope: WorldActionEnvelope = {
      actor: { kind: "player" },
      source: "player",
      action: {
        type: "alter",
        objectId: "cup",
        verb: "намочить и подписать",
        changes: { wet: true, inscription: "Моя чашка" },
      },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(mind, world, envelope, result, before, 3);
    const witnessed = worldMindForFigure(mind, "near")[0]!;
    expect(witnessed.before.objects[0]?.state.wet).toBeUndefined();
    expect(witnessed.after.objects[0]?.state).toEqual({
      wet: true,
      inscription: "Моя чашка",
    });
    expect(witnessed.events[0]?.type).toBe("object.changed");
    expect(worldMindForFigure(mind, "behind-wall")).toEqual([]);
    let reacted = false;
    runReactions(
      {
        currentRoomId: "a",
        exhaustion: 0,
        cycleNumber: 3,
        getFlag: () => undefined,
        setFlag: () => {
          reacted = true;
        },
        dispatch: (action) =>
          executeWorldAction(world, {
            actor: { kind: "script", id: "reaction" },
            source: "script",
            action,
          }),
      },
      result.events,
      [
        {
          id: "wet-cup",
          onWorldEvent(host, event) {
            if (event.type === "object.changed" && event.after.wet)
              host.setFlag("cup-wet", true);
          },
        },
      ],
    );
    expect(reacted).toBe(true);
    expect(world.objectById.get("cup")?.state.inscription).toBe("Моя чашка");
  });

  test("alter and gesture receipts never expose an unseen secondary participant", () => {
    for (const type of ["alter", "gesture"] as const) {
      const world = createWorldMutator({
        objects: [
          object({ location: { kind: "held", actor: { kind: "player" } } }),
          object({
            id: "hidden-bottle",
            location: { kind: "room", roomId: "a", x: 2, y: 1 },
          }),
        ],
        playerPose: { roomId: "a", x: 2, y: 0 },
        figurePoses: [["witness", { roomId: "a", x: 0, y: 0 }]],
        isWalkableTile: (_room, x, y) =>
          x >= 0 && y >= 0 && x < 8 && y < 8 && !(x === 1 && y === 1),
      });
      const mind = createWorldMind();
      const action: WorldAction =
        type === "alter"
          ? {
              type,
              objectId: "cup",
              targetId: "hidden-bottle",
              verb: "намочить",
              changes: { wet: true },
            }
          : {
              type,
              objectId: "cup",
              targetId: "hidden-bottle",
              verb: "показать чашку бутылке",
            };
      const envelope: WorldActionEnvelope = {
        actor: { kind: "player" },
        source: "player",
        action,
      };
      const before = captureWorldAction(world, envelope);
      const result = executeWorldAction(world, envelope);
      expect(result.ok).toBe(true);
      recordWorldAction(mind, world, envelope, result, before, 1);
      const seen = worldMindForFigure(mind, "witness")[0]!;
      expect(seen.after.objects[0]?.id).toBe("cup");
      expect(JSON.stringify(seen)).not.toContain("hidden-bottle");
    }
  });

  test("gesture history explicitly retains no physical effect", () => {
    const { world, mind } = setup();
    const envelope: WorldActionEnvelope = {
      actor: { kind: "player" },
      source: "player",
      action: { type: "gesture", objectId: "cup", verb: "прислушаться" },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    recordWorldAction(mind, world, envelope, result, before, 3);
    expect(result.ok).toBe(true);
    expect(worldMindForFigure(mind, "near")[0]?.events[0]).toMatchObject({
      type: "object.gestured",
      effect: "none",
    });
    expect(mind.events[0]?.before.objects).toEqual(
      mind.events[0]?.after.objects,
    );
  });
});
