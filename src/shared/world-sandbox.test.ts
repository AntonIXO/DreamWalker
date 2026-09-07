import { describe, expect, test } from "bun:test";

import type { WorldSnapshot, WorldSnapshotObject } from "./ai";
import type { WorldActionEnvelope, WorldActionResult } from "./world-action";
import { MAX_WORLD_ACTIONS_PER_TURN } from "./world-action";
import { refused } from "./world-action-engine";
import type { WorldMutator } from "./world-object";
import {
  NPC_WORLD_TOOL_NAMES,
  applyActionList,
  assertReplayMatches,
  cloneSandbox,
  createNpcWorldSession,
  sandboxFromSnapshot,
  worldActionFromTool,
  type WorldActionExecutor,
} from "./world-sandbox";

function objectAt(
  id: string,
  extras: Partial<WorldSnapshotObject> = {},
): WorldSnapshotObject {
  return {
    id,
    name: id,
    location: { kind: "room", roomId: "hall", x: 2, y: 3 },
    mobility: "carryable",
    affordances: ["take", "open", "close"],
    state: { open: false },
    keyId: null,
    body: { w: 1, h: 1, solid: true },
    clueId: null,
    holdsShardId: null,
    tags: [],
    ...extras,
  };
}

function snap(objects: WorldSnapshotObject[] = []): WorldSnapshot {
  return {
    rooms: [
      {
        id: "hall",
        name: "Hall",
        kind: "place",
        personality: null,
        visitCount: 1,
        tags: [],
      },
    ],
    doors: [
      {
        id: "d1",
        type: "open",
        fromRoomId: "hall",
        toRoomId: "yard",
        x: 4,
        y: 1,
        keyId: null,
        threshold: "door",
      },
    ],
    figures: [
      {
        id: "npc-1",
        name: "Фигура",
        roomId: "hall",
        x: 5,
        y: 6,
        holdsShardId: null,
        role: "часть сна",
        personality: "",
        activity: "стоит",
        fate: "present",
        fateCycle: null,
        fateRoomId: null,
        fateQuoted: null,
      },
    ],
    interests: [],
    fateHistory: [],
    objects,
    player: { roomId: "hall", x: 1, y: 1 },
    worldRevision: 3,
    mood: "upper-dynamic",
  };
}

function okResult(
  extras: Partial<WorldActionResult> = {},
): WorldActionResult {
  return {
    ok: true,
    refusal: null,
    affectedRooms: ["hall"],
    affectedObjects: [],
    events: [],
    ...extras,
  };
}

describe("NPC world tools", () => {
  test("the wrapper stamps figureId from the request and drops a hallucinated actor", () => {
    const calls: WorldActionEnvelope[] = [];
    const execute: WorldActionExecutor = (_world, envelope) => {
      calls.push(envelope);
      return okResult();
    };
    const session = createNpcWorldSession(snap(), "npc-1", execute);
    session.runTool("take", {
      objectId: "cup",
      actor: { kind: "player" },
      source: "player",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.actor).toEqual({ kind: "figure", id: "npc-1" });
    expect(calls[0]?.source).toBe("npc");
    expect(calls[0]?.action).toEqual({ type: "take", objectId: "cup" });
  });

  test("the 9th successful world action is refused by the cap, not thrown", () => {
    const execute: WorldActionExecutor = () => okResult();
    const session = createNpcWorldSession(snap(), "npc-1", execute);
    const results = [];
    for (let i = 0; i < MAX_WORLD_ACTIONS_PER_TURN + 1; i++) {
      results.push(session.runTool("take", { objectId: `o${i}` }));
    }
    expect(results.slice(0, 8).every((result) => result.ok)).toBe(true);
    expect(results[8]?.ok).toBe(false);
    expect(results[8]?.refusal).toBe("turn action cap reached");
    expect(session.successful).toHaveLength(8);
  });

  test("sequential open then take: the fake engine sees open state and call order", () => {
    const order: string[] = [];
    const execute: WorldActionExecutor = (world, envelope) => {
      order.push(envelope.action.type);
      if (envelope.action.type === "open") {
        const target = world.objectById.get(envelope.action.targetId);
        if (target) target.state.open = true;
        world.bumpRevision();
        return okResult({ affectedObjects: [envelope.action.targetId] });
      }
      if (envelope.action.type === "take") {
        const target = world.objectById.get(envelope.action.objectId);
        expect(target?.state.open).toBe(true);
        return okResult({ affectedObjects: [envelope.action.objectId] });
      }
      return refused("unexpected");
    };
    const session = createNpcWorldSession(
      snap([objectAt("box")]),
      "npc-1",
      execute,
    );
    expect(session.world.objectById.get("box")?.state.open).toBe(false);
    const opened = session.runTool("open", { targetId: "box" });
    expect(opened.ok).toBe(true);
    expect(session.world.objectById.get("box")?.state.open).toBe(true);
    const taken = session.runTool("take", { objectId: "box" });
    expect(taken.ok).toBe(true);
    expect(order).toEqual(["open", "take"]);
  });

  test("shiftWalls is not a tool", () => {
    expect(NPC_WORLD_TOOL_NAMES).not.toContain("shiftWalls");
    expect(NPC_WORLD_TOOL_NAMES).not.toContain("shift_walls");
    expect(
      worldActionFromTool("shiftWalls", {
        roomId: "hall",
        variantId: "night",
        reason: "no",
      }),
    ).toBeNull();
    const session = createNpcWorldSession(snap(), "npc-1", () => okResult());
    const result = session.runTool("shiftWalls", { roomId: "hall" });
    expect(result.ok).toBe(false);
    expect(session.successful).toHaveLength(0);
  });
});

describe("sandbox clone", () => {
  test("builds object locations and figure poses from the snapshot", () => {
    const world = sandboxFromSnapshot(
      snap([
        objectAt("cup", {
          location: { kind: "held", actor: { kind: "figure", id: "npc-1" } },
        }),
      ]),
    );
    expect(world.revision).toBe(3);
    expect(world.getFigurePose("npc-1")).toEqual({
      roomId: "hall",
      x: 5,
      y: 6,
    });
    expect(world.getPlayerPose()).toEqual({ roomId: "hall", x: 1, y: 1 });
    expect(world.objectById.get("cup")?.location).toEqual({
      kind: "held",
      actor: { kind: "figure", id: "npc-1" },
    });
    expect(world.getDoor("d1")?.threshold).toBe("door");
  });

  test("clone is independent of later writes", () => {
    const world = sandboxFromSnapshot(snap([objectAt("cup")]));
    const copy = cloneSandbox(world);
    world.objectById.get("cup")!.location = {
      kind: "held",
      actor: { kind: "player" },
    };
    world.bumpRevision();
    expect(copy.objectById.get("cup")?.location).toEqual({
      kind: "room",
      roomId: "hall",
      x: 2,
      y: 3,
    });
    expect(copy.revision).toBe(3);
    expect(world.revision).toBe(4);
  });

  test("applyActionList runs envelopes in order through the injected executor", () => {
    const seen: string[] = [];
    const execute: WorldActionExecutor = (_world, envelope) => {
      seen.push(envelope.action.type);
      return okResult();
    };
    const world = sandboxFromSnapshot(snap());
    const results = applyActionList(
      world,
      [
        {
          actor: { kind: "figure", id: "npc-1" },
          source: "npc",
          action: { type: "open", targetId: "box" },
        },
        {
          actor: { kind: "figure", id: "npc-1" },
          source: "npc",
          action: { type: "take", objectId: "box" },
        },
      ],
      execute,
    );
    expect(seen).toEqual(["open", "take"]);
    expect(results).toHaveLength(2);
  });
});

describe("assertReplayMatches", () => {
  test("passes when ok, affected ids, and object locations match", () => {
    const sandbox = okResult({
      affectedObjects: ["cup"],
      events: [
        {
          type: "object.taken",
          objectId: "cup",
          actor: { kind: "figure", id: "npc-1" },
          fromRoomId: "hall",
        },
      ],
    });
    const live = okResult({
      affectedObjects: ["cup"],
      events: [
        {
          type: "object.taken",
          objectId: "cup",
          actor: { kind: "figure", id: "npc-1" },
          fromRoomId: "hall",
        },
      ],
    });
    expect(() => assertReplayMatches(sandbox, live)).not.toThrow();
  });

  test("throws when live ok disagrees", () => {
    expect(() =>
      assertReplayMatches(okResult(), refused("no")),
    ).toThrow(/replay mismatch: ok/);
  });

  test("compares final object locations on the mutators when given", () => {
    const sandboxWorld = sandboxFromSnapshot(snap([objectAt("cup")]));
    const liveWorld = sandboxFromSnapshot(snap([objectAt("cup")]));
    (liveWorld as WorldMutator).objectById.get("cup")!.location = {
      kind: "held",
      actor: { kind: "player" },
    };
    expect(() =>
      assertReplayMatches(okResult(), okResult(), sandboxWorld, liveWorld),
    ).toThrow(/object locations/);
  });
});
