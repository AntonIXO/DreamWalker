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
  createPlayerWorldSession,
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

function okResult(extras: Partial<WorldActionResult> = {}): WorldActionResult {
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
    expect(() => assertReplayMatches(okResult(), refused("no"))).toThrow(
      /replay mismatch: ok/,
    );
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

describe("NPC deliberation", () => {
  function planningSnapshot(): WorldSnapshot {
    const snapshot = snap([
      objectAt("box", {
        location: { kind: "room", roomId: "hall", x: 5, y: 5 },
        mobility: "fixed",
        affordances: ["open", "close"],
        tags: ["container"],
      }),
      objectAt("cup", {
        location: { kind: "inside", objectId: "box" },
        affordances: ["take", "drop", "put"],
      }),
    ]);
    snapshot.geometry = {
      hall: { width: 8, height: 8, cells: Array(8).fill("........") },
    };
    return snapshot;
  }

  test("records successful, refused, and unknown physical attempts with revisions", () => {
    const session = createNpcWorldSession(planningSnapshot(), "npc-1");
    expect(session.runTool("take", { objectId: "cup" }).ok).toBe(false);
    expect(
      session.runTool("open", {
        targetId: "box",
        actor: { kind: "player" },
        source: "player",
      }).ok,
    ).toBe(true);
    expect(session.runTool("invent_room", { roomId: "imaginary" }).ok).toBe(
      false,
    );
    expect(session.attempts).toHaveLength(3);
    expect(session.attempts.map((attempt) => attempt.result.ok)).toEqual([
      false,
      true,
      false,
    ]);
    expect(session.attempts.map((attempt) => attempt.revisionBefore)).toEqual([
      3, 3, 4,
    ]);
    expect(
      session.attempts.map((attempt) => attempt.result.worldRevision),
    ).toEqual([3, 4, 4]);
    expect(session.attempts[0]?.action).toEqual({
      type: "take",
      objectId: "cup",
    });
    expect(session.attempts[1]?.input).toEqual({ targetId: "box" });
    expect(
      session.attempts.every(
        (attempt) =>
          attempt.actor.kind === "figure" && attempt.actor.id === "npc-1",
      ),
    ).toBe(true);
    expect(session.attempts[2]?.action).toBeNull();
    expect(session.successful).toHaveLength(1);
    expect(session.remainingActions).toBe(MAX_WORLD_ACTIONS_PER_TURN - 3);
  });

  test("reuses an identical refusal until world revision changes", () => {
    let executions = 0;
    const session = createNpcWorldSession(
      planningSnapshot(),
      "npc-1",
      (world, envelope) => {
        executions += 1;
        if (envelope.action.type === "open") {
          world.bumpRevision();
          return okResult();
        }
        return refused(`blocked at ${world.revision}`);
      },
    );
    const first = session.runTool("take", { objectId: "cup" });
    const repeated = session.runTool("take", {
      explanation: "try harder",
      objectId: "cup",
    });
    expect(repeated).toEqual(first);
    expect(executions).toBe(1);
    expect(session.attempts.map((attempt) => attempt.cached)).toEqual([
      false,
      true,
    ]);
    expect(session.remainingActions).toBe(MAX_WORLD_ACTIONS_PER_TURN - 2);
    session.runTool("open", { targetId: "box" });
    const afterChange = session.runTool("take", { objectId: "cup" });
    expect(afterChange.refusal).toBe("blocked at 4");
    expect(executions).toBe(3);
    expect(session.attempts[3]?.cached).toBe(false);
  });

  test("refused and cached attempts exhaust the bounded physical budget", () => {
    let executions = 0;
    const session = createNpcWorldSession(planningSnapshot(), "npc-1", () => {
      executions += 1;
      return refused("blocked");
    });
    for (let i = 0; i < MAX_WORLD_ACTIONS_PER_TURN; i++)
      session.runTool("take", { objectId: "cup" });
    const receipts = [...session.attempts];
    expect(session.runTool("open", { targetId: "box" }).refusal).toBe(
      "turn action cap reached",
    );
    expect(session.remainingActions).toBe(0);
    expect(session.attempts).toEqual(receipts);
    expect(session.attempts).toHaveLength(MAX_WORLD_ACTIONS_PER_TURN);
    expect(session.successful).toHaveLength(0);
    expect(executions).toBe(1);
  });

  test("attempt receipts do not retain mutable caller input or returned result", () => {
    const session = createNpcWorldSession(planningSnapshot(), "npc-1");
    const input = { targetId: "box", detail: { reason: "look inside" } };
    const result = session.runTool("open", input);
    input.detail.reason = "changed";
    result.affectedObjects.length = 0;
    expect(session.attempts[0]?.input).toEqual({
      targetId: "box",
      detail: { reason: "look inside" },
    });
    expect(session.attempts[0]?.result.affectedObjects).toEqual(["box"]);
  });

  test("previews sequential real actions without changing world, receipts, or budget", () => {
    const session = createNpcWorldSession(planningSnapshot(), "npc-1");
    const preview = session.preview([
      { type: "open", targetId: "box" },
      { type: "take", objectId: "cup" },
    ]);
    expect(preview.ok).toBe(true);
    expect(preview.refusal).toBeNull();
    expect(preview.baseRevision).toBe(3);
    expect(preview.worldRevision).toBe(5);
    expect(preview.steps.map((step) => step.result.worldRevision)).toEqual([
      4, 5,
    ]);
    expect(preview.world.objectById.get("cup")?.location).toEqual({
      kind: "held",
      actor: { kind: "figure", id: "npc-1" },
    });
    expect(preview.actorPose).toEqual({ roomId: "hall", x: 5, y: 6 });
    expect(session.world.objectById.get("box")?.state.open).toBe(false);
    expect(session.world.objectById.get("cup")?.location).toEqual({
      kind: "inside",
      objectId: "box",
    });
    expect(session.world.revision).toBe(3);
    expect(session.attempts).toHaveLength(0);
    expect(session.successful).toHaveLength(0);
    expect(session.remainingActions).toBe(MAX_WORLD_ACTIONS_PER_TURN);
    expect(session.runTool("take", { objectId: "cup" }).refusal).toBe(
      "container is closed",
    );
  });

  test("the projected world does not share nested held-actor references", () => {
    const snapshot = planningSnapshot();
    snapshot.objects![1]!.location = {
      kind: "held",
      actor: { kind: "figure", id: "npc-1" },
    };
    const session = createNpcWorldSession(snapshot, "npc-1");
    const preview = session.preview([]);
    const location = preview.world.objectById.get("cup")!.location;
    if (location.kind === "held" && location.actor.kind === "figure") {
      location.actor.id = "another-figure";
    }
    expect(session.world.objectById.get("cup")?.location).toEqual({
      kind: "held",
      actor: { kind: "figure", id: "npc-1" },
    });
    expect(session.attempts).toHaveLength(0);
  });

  test("previews stop at the first refused action and preserve the successful prefix", () => {
    const session = createNpcWorldSession(planningSnapshot(), "npc-1");
    const preview = session.preview([
      { type: "open", targetId: "box" },
      { type: "take", objectId: "missing" },
      { type: "take", objectId: "cup" },
    ]);
    expect(preview.ok).toBe(false);
    expect(preview.refusal).toBe("no such object");
    expect(preview.steps).toHaveLength(2);
    expect(preview.worldRevision).toBe(4);
    expect(preview.world.objectById.get("box")?.state.open).toBe(true);
    expect(preview.world.objectById.get("cup")?.location.kind).toBe("inside");
    expect(session.world.objectById.get("box")?.state.open).toBe(false);
  });

  test("previews honor remaining physical budget and bind every step to the session actor", () => {
    const calls: WorldActionEnvelope[] = [];
    const session = createNpcWorldSession(
      planningSnapshot(),
      "npc-1",
      (_world, envelope) => {
        calls.push(envelope);
        return okResult();
      },
    );
    for (let i = 0; i < MAX_WORLD_ACTIONS_PER_TURN - 1; i++)
      session.runTool("open", { targetId: "box" });
    calls.length = 0;
    const tooLong = session.preview([
      { type: "open", targetId: "box" },
      { type: "take", objectId: "cup" },
    ]);
    expect(tooLong.ok).toBe(false);
    expect(tooLong.refusal).toBe("plan exceeds remaining action budget");
    expect(tooLong.steps).toHaveLength(0);
    expect(calls).toHaveLength(0);
    const preview = session.preview([{ type: "take", objectId: "cup" }]);
    expect(preview.ok).toBe(true);
    expect(calls[0]?.actor).toEqual({ kind: "figure", id: "npc-1" });
    expect(calls[0]?.source).toBe("npc");
    expect(session.remainingActions).toBe(1);
    expect(session.attempts).toHaveLength(MAX_WORLD_ACTIONS_PER_TURN - 1);
  });
});

describe("NPC physical presence", () => {
  test("dead and gone snapshot figures cannot act or receive predicted transfers", () => {
    for (const fate of ["dead", "gone"] as const) {
      const snapshot = snap([
        objectAt("cup", {
          location: { kind: "held", actor: { kind: "figure", id: "npc-1" } },
          affordances: ["give"],
        }),
        objectAt("loose", {
          location: { kind: "room", roomId: "hall", x: 5, y: 5 },
          body: null,
        }),
      ]);
      snapshot.geometry = {
        hall: { width: 8, height: 8, cells: Array(8).fill("........") },
      };
      snapshot.figures.push({
        ...snapshot.figures[0]!,
        id: "absent",
        x: 5,
        y: 5,
        fate,
      });
      const session = createNpcWorldSession(snapshot, "npc-1");
      expect(session.world.getFigurePose("absent")).toBeNull();
      expect(session.world.figurePoses.has("absent")).toBe(false);
      const preview = session.preview([
        { type: "give", objectId: "cup", to: { kind: "figure", id: "absent" } },
      ]);
      expect(preview.ok).toBe(false);
      expect(preview.refusal).toBe("actor does not exist");
      expect(session.world.objectById.get("cup")?.location).toEqual({
        kind: "held",
        actor: { kind: "figure", id: "npc-1" },
      });
      const absent = createNpcWorldSession(snapshot, "absent");
      expect(absent.runTool("take", { objectId: "loose" }).refusal).toBe(
        "actor does not exist",
      );
      expect(absent.preview([{ type: "moveTo", x: 4, y: 5 }]).refusal).toBe(
        "actor does not exist",
      );
      expect(absent.successful).toHaveLength(0);
      expect(absent.world.revision).toBe(3);
    }
  });

  test("broken, leveraged, and led figures retain their physical bodies", () => {
    const snapshot = snap();
    for (const fate of ["broken", "leveraged", "led"] as const) {
      snapshot.figures.push({ ...snapshot.figures[0]!, id: fate, fate });
    }
    const world = sandboxFromSnapshot(snapshot);
    for (const id of ["npc-1", "broken", "leveraged", "led"]) {
      expect(world.getFigurePose(id)).toEqual({ roomId: "hall", x: 5, y: 6 });
    }
  });
});

describe("player item command sessions", () => {
  function itemSnapshot() {
    const snapshot = snap([
      objectAt("cup", {
        location: { kind: "held", actor: { kind: "player" } },
        affordances: ["take", "drop", "give", "use"],
      }),
    ]);
    snapshot.geometry = {
      hall: { width: 8, height: 8, cells: Array(8).fill("........") },
    };
    return snapshot;
  }

  test("commands bind player identity and persist alterations only after real execution", () => {
    const session = createPlayerWorldSession(itemSnapshot());
    const action = {
      type: "alter" as const,
      objectId: "cup",
      verb: "подписать",
      changes: { dirty: true, inscription: "Моя чашка" },
      actor: { kind: "figure", id: "npc-1" },
      source: "npc",
    };
    const preview = session.preview([action]);
    expect(preview.ok).toBe(true);
    expect(preview.actorPose).toEqual({ roomId: "hall", x: 1, y: 1 });
    expect(preview.world.objectById.get("cup")?.state.inscription).toBe(
      "Моя чашка",
    );
    expect(
      session.world.objectById.get("cup")?.state.inscription,
    ).toBeUndefined();
    expect(session.remainingActions).toBe(8);
    expect(session.runAction(action).ok).toBe(true);
    expect(session.successful[0]?.actor).toEqual({ kind: "player" });
    expect(session.successful[0]?.source).toBe("player");
    expect(session.attempts[0]?.actor).toEqual({ kind: "player" });
    expect(session.attempts[0]?.input).not.toHaveProperty("actor");
    expect(session.world.objectById.get("cup")?.state).toEqual({
      open: false,
      dirty: true,
      inscription: "Моя чашка",
    });
    const state = cloneSandbox(session.world).objectById.get("cup")!.state;
    expect(state.inscription).toBe("Моя чашка");
    state.inscription = "changed projection";
    expect(session.world.objectById.get("cup")?.state.inscription).toBe(
      "Моя чашка",
    );
  });

  test("item sessions reject movement and admin commands in execution and preview", () => {
    let executed = 0;
    const session = createPlayerWorldSession(itemSnapshot(), () => {
      executed++;
      return okResult();
    });
    const actions = [
      { type: "moveTo", x: 3, y: 3 },
      { type: "traverseDoor", doorId: "d1" },
      { type: "shiftWalls", roomId: "hall" },
    ] as unknown as Parameters<typeof session.runAction>[0][];
    for (const action of actions) {
      expect(session.preview([action]).ok).toBe(false);
      expect(session.runAction(action).ok).toBe(false);
    }
    expect(executed).toBe(0);
    expect(session.successful).toHaveLength(0);
    expect(session.attempts).toHaveLength(3);
    expect(session.world.getPlayerPose()).toEqual({
      roomId: "hall",
      x: 1,
      y: 1,
    });
  });

  test("failed player alterations obey the same retry cache and turn budget", () => {
    let executed = 0;
    const session = createPlayerWorldSession(itemSnapshot(), () => {
      executed++;
      return refused("blocked");
    });
    for (let i = 0; i < 9; i++)
      session.runAction({
        type: "alter",
        objectId: "cup",
        verb: "намочить",
        changes: { wet: true },
      });
    expect(executed).toBe(1);
    expect(session.remainingActions).toBe(0);
    expect(session.attempts).toHaveLength(8);
    expect(session.attempts.slice(1).every((attempt) => attempt.cached)).toBe(
      true,
    );
  });
});
