import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import {
  npcDependencyFingerprint,
  type NpcDecisionRequest,
  type NpcDecisionResult,
  type NpcTaskDependencies,
} from "../../shared/npc-decision";
import type { MemoryEpisode } from "../../shared/episodic-memory";
import type {
  WorldAction,
  WorldActionEnvelope,
} from "../../shared/world-action";
import { executeWorldAction } from "../../shared/world-action-engine";
import {
  captureWorldAction,
  recordWorldAction,
  type WorldMindEvent,
} from "../../shared/world-mind";
import { NpcTaskCoordinator } from "../game/npc-task-coordinator";
import { createWorld, type WorldState } from "../game/world";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import { snapshot } from "./remote";
import { NpcAutonomy, type NpcAutonomyHost } from "./npc-autonomy";

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}

const dependencies = (
  figureId: string,
  objectIds = ["shelf"],
): NpcTaskDependencies => ({ figureId, objectIds, doorIds: [], actorIds: [] });

function waitResult(
  payload: NpcDecisionRequest,
  status: NpcDecisionResult["status"] = "wait",
): NpcDecisionResult {
  const deps = dependencies(payload.figureId);
  return {
    requestId: payload.requestId,
    status,
    dependencies: deps,
    contextKey: npcDependencyFingerprint(payload.world, deps),
  };
}

function selected(
  payload: NpcDecisionRequest,
  actions: WorldAction[] = [
    { type: "take", objectId: "shelf" },
    { type: "drop", objectId: "shelf" },
  ],
): NpcDecisionResult {
  const result = waitResult(payload, "selected");
  return {
    ...result,
    task: {
      id: `task:${payload.requestId}`,
      figureId: payload.figureId,
      summary: "Pick up and replace the shelf",
      actions,
      dependencies: result.dependencies,
      contextKey: result.contextKey,
      lifetimeSeconds: 180,
      cause: payload.cause,
    },
  };
}

function setup(
  request: NonNullable<NpcAutonomyHost["request"]> = async (payload) =>
    waitResult(payload),
  existingWorld?: WorldState,
) {
  const world =
    existingWorld ??
    createWorld(validateDreamArtifact(structuredClone(fixture)));
  let cycle = 1;
  let runId = "run";
  let sequence = 1;
  const calls: NpcDecisionRequest[] = [];
  const executed: WorldActionEnvelope[] = [];
  const memories: MemoryEpisode[] = [];
  let nested: ((event: WorldMindEvent) => WorldMindEvent[]) | undefined;
  const mutator = bindWorldMutator(
    world,
    staticPlayerPose({ roomId: "a", x: 8, y: 4 }),
  );
  const coordinator = new NpcTaskCoordinator(world, (envelope) => {
    const before = captureWorldAction(mutator, envelope);
    const result = executeWorldAction(mutator, envelope);
    executed.push(envelope);
    const event = recordWorldAction(
      world.worldMind,
      mutator,
      envelope,
      result,
      before,
      cycle,
    );
    if (event) autonomy.noteEvents([event, ...(nested?.(event) ?? [])]);
    return result;
  });
  const host: NpcAutonomyHost = {
    coordinator,
    context: () => ({
      slug: "tiny",
      runId,
      cycleNumber: cycle,
      world: snapshot(world),
      memories,
    }),
    request: async (payload, signal) => {
      calls.push(payload);
      return request(payload, signal);
    },
  };
  const autonomy = new NpcAutonomy(world, host);
  function event(
    rootId = `root:${sequence}`,
    type: "open" | "close" | "moveTo" = "open",
    witnesses = world.figures.map((figure) => figure.id),
  ): WorldMindEvent {
    const object = world.objectById.get("shelf")!;
    const fact = {
      id: object.id,
      name: object.name,
      location: structuredClone(object.location),
      state: structuredClone(object.state),
    };
    const visibility = { actor: true, objectIds: [object.id], door: false };
    const receipt: WorldMindEvent = {
      sequence: sequence++,
      cycle,
      revision: world.revision,
      actor: { kind: "player" },
      source: "player",
      actionType: type,
      action:
        type === "moveTo"
          ? { type, x: 8, y: 4 }
          : { type, targetId: object.id },
      cause: { rootId },
      events:
        type === "moveTo"
          ? [
              {
                type: "actor.moved",
                actor: { kind: "player" },
                roomId: "a",
                x: 8,
                y: 4,
              },
            ]
          : [
              {
                type: type === "open" ? "object.opened" : "object.closed",
                actor: { kind: "player" },
                objectId: object.id,
              },
            ],
      roomIds: ["a"],
      witnessIds: witnesses,
      witnessRooms: Object.fromEntries(witnesses.map((id) => [id, ["a"]])),
      witnessViews: Object.fromEntries(
        witnesses.map((id) => [id, { before: visibility, after: visibility }]),
      ),
      before: {
        actor: { roomId: "a", x: 8, y: 4 },
        objects: [fact],
        door: null,
      },
      after: {
        actor: { roomId: "a", x: 8, y: 4 },
        objects: [fact],
        door: null,
      },
    };
    world.worldMind.events.push(receipt);
    return receipt;
  }
  function advance(seconds: number, execute = true) {
    for (let index = 0; index < Math.ceil(seconds * 10); index++) {
      autonomy.tick(0.1);
      if (execute) coordinator.tick(0.1);
    }
  }
  return {
    world,
    autonomy,
    coordinator,
    host,
    calls,
    executed,
    memories,
    event,
    advance,
    setCycle: (value: number) => {
      cycle = value;
    },
    setRun: (value: string) => {
      runId = value;
    },
    setNested: (value: typeof nested) => {
      nested = value;
    },
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("event-driven NPC autonomy", () => {
  test("silence, ordinary movement, and time create no calls", async () => {
    const env = setup();
    env.advance(180);
    for (let index = 0; index < 100; index++) {
      env.autonomy.noteEvents([env.event(undefined, "moveTo")]);
      env.world.figures[0]!.x += 0.01;
      env.world.revision++;
      env.advance(1);
    }
    await flush();
    expect(env.calls).toHaveLength(0);
  });

  test("coalesces nested receipts for 300ms and keeps waiting until a dependency changes", async () => {
    const env = setup();
    env.autonomy.noteEvents([env.event("one"), env.event("one")]);
    env.advance(0.2);
    expect(env.calls).toHaveLength(0);
    env.advance(0.1);
    await flush();
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]!.cause.evidenceIds).toHaveLength(2);
    env.advance(180);
    env.autonomy.noteEvents([env.event("unchanged")]);
    env.advance(1);
    await flush();
    expect(env.calls).toHaveLength(1);
    env.world.objectById.get("shelf")!.state.open = true;
    env.autonomy.noteEvents([env.event("changed")]);
    env.advance(0.4);
    await flush();
    expect(env.calls).toHaveLength(2);
  });

  test("a decision executes its complete physical sequence without follow-up inference", async () => {
    const env = setup(async (payload) => selected(payload));
    env.autonomy.noteEvents([env.event("one")]);
    env.advance(0.3);
    await flush();
    env.advance(3);
    await flush();
    expect(env.calls).toHaveLength(1);
    expect(env.executed.map((entry) => entry.action.type)).toEqual([
      "take",
      "drop",
    ]);
    expect(env.world.objectById.get("shelf")!.location.kind).toBe("room");
    expect(env.autonomy.diagnostics.records.at(-1)?.status).toBe("completed");
  });

  test("script receipts in the same own-action transaction cannot cancel the remaining suffix", async () => {
    const env = setup(async (payload) => selected(payload));
    env.setNested((receipt) => [
      {
        ...structuredClone(receipt),
        sequence: receipt.sequence + 100,
        actor: { kind: "script", id: "reaction" },
      },
    ]);
    env.autonomy.noteEvents([env.event("one")]);
    env.advance(0.3);
    await flush();
    env.advance(3);
    expect(env.calls).toHaveLength(1);
    expect(env.executed.map((entry) => entry.action.type)).toEqual([
      "take",
      "drop",
    ]);
  });

  test("a causal chain is limited to two calls and prioritizes the affected NPC", async () => {
    const env = setup();
    const original = env.world.figures[0]!;
    env.world.figures.push(
      { ...original, id: "figure2" },
      { ...original, id: "figure3" },
    );
    env.world.objectById.get("shelf")!.location = {
      kind: "held",
      actor: { kind: "figure", id: "figure3" },
    };
    env.autonomy.noteEvents([env.event("same-root")]);
    for (let index = 0; index < 5; index++) {
      env.advance(0.4);
      await flush();
    }
    expect(env.calls).toHaveLength(2);
    expect(env.calls[0]!.figureId).toBe("figure3");
    env.world.objectById.get("shelf")!.state.open = true;
    env.autonomy.noteEvents([env.event("same-root")]);
    env.advance(1);
    await flush();
    expect(env.calls).toHaveLength(2);
  });

  test("another root queued before wait does not force an unchanged second decision", async () => {
    const env = setup();
    env.autonomy.noteEvents([env.event("first"), env.event("second")]);
    env.advance(0.4);
    await flush();
    env.advance(1);
    await flush();
    expect(env.calls).toHaveLength(1);
  });

  test("new evidence for the same NPC can use the remaining root call", async () => {
    const env = setup();
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4);
    await flush();
    env.world.objectById.get("shelf")!.state.open = true;
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4);
    await flush();
    expect(env.calls).toHaveLength(2);
  });

  test("walking and unrelated mutations do not stale a late decision; a changed target does", async () => {
    const pending = deferred<NpcDecisionResult>();
    const env = setup(() => pending.promise);
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4);
    env.world.figures[0]!.x += 0.2;
    env.world.revision += 10;
    env.world.objectById.get("rope")!.state.wet = true;
    pending.resolve(selected(env.calls[0]!));
    await flush();
    expect(env.autonomy.diagnostics.active).toBe(1);

    const otherPending = deferred<NpcDecisionResult>();
    const other = setup(() => otherPending.promise);
    other.autonomy.noteEvents([other.event("root")]);
    other.advance(0.4);
    other.world.objectById.get("shelf")!.location = {
      kind: "held",
      actor: { kind: "player" },
    };
    otherPending.resolve(selected(other.calls[0]!));
    await flush();
    expect(other.autonomy.diagnostics.active).toBe(0);
    expect(other.autonomy.diagnostics.records.at(-1)?.status).toBe("stale");
  });

  test("pause, foreground work, cycle reset and run replacement reject late responses", async () => {
    for (const mode of [
      "pause",
      "foreground",
      "reset",
      "cycle",
      "run",
    ] as const) {
      const pending = deferred<NpcDecisionResult>();
      const env = setup(() => pending.promise);
      env.autonomy.noteEvents([env.event("root")]);
      env.advance(0.4);
      if (mode === "pause") env.autonomy.tick(0.1, { paused: true });
      if (mode === "foreground")
        env.autonomy.tick(0.1, { foregroundBusy: true });
      if (mode === "reset") env.autonomy.resetCycle();
      if (mode === "cycle") env.setCycle(2);
      if (mode === "run") env.setRun("another");
      pending.resolve(selected(env.calls[0]!));
      await flush();
      env.advance(3);
      expect(env.executed).toHaveLength(0);
      expect(env.calls).toHaveLength(1);
    }
  });

  test("API failures and unavailable/deferred replies stay distinct from wait without retry loops", async () => {
    for (const status of ["throw", "unavailable", "deferred"] as const) {
      const env = setup(async (payload) => {
        if (status === "throw") throw new Error("offline");
        return {
          ...waitResult(payload, status),
          contextKey: "",
          dependencies: dependencies(payload.figureId, []),
        };
      });
      env.autonomy.noteEvents([env.event("root")]);
      env.advance(0.4);
      await flush();
      env.advance(300);
      env.autonomy.noteEvents([env.event("same-state")]);
      env.advance(1);
      await flush();
      expect(env.calls).toHaveLength(1);
      expect(env.autonomy.diagnostics.records.at(-1)?.status).toBe(
        status === "throw" ? "unavailable" : status,
      );
    }
  });

  test("a blocked dependency sleeps until it changes, and task expiration does not call Jev", async () => {
    const env = setup(async (payload) => selected(payload));
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4);
    await flush();
    env.world.objectById.get("shelf")!.location = {
      kind: "held",
      actor: { kind: "player" },
    };
    env.advance(1);
    expect(env.executed).toHaveLength(0);
    expect(env.autonomy.diagnostics.records.at(-1)?.status).toBe("blocked");
    env.advance(180);
    expect(env.calls).toHaveLength(1);
    env.world.objectById.get("shelf")!.location = {
      kind: "room",
      roomId: "a",
      x: 9,
      y: 4,
    };
    env.autonomy.noteEvents([env.event("unblocked")]);
    env.advance(0.4);
    await flush();
    expect(env.calls).toHaveLength(2);
    env.advance(181, false);
    expect(env.calls).toHaveLength(2);
    expect(env.autonomy.diagnostics.records.at(-1)?.status).toBe("expired");
  });

  test("goal identity ignores paraphrases, and removal/expiry cancels pending and active intent", async () => {
    const env = setup(async (payload) =>
      selected(payload, [{ type: "moveTo", roomId: "a", x: 1, y: 1 }]),
    );
    const goal = {
      figureId: "figure1",
      goalId: "bring-shelf",
      goal: "Bring the shelf",
      lifetimeSeconds: 5,
    };
    env.autonomy.noteGuidance([goal]);
    env.autonomy.noteGuidance([{ ...goal, goal: "Please bring it" }]);
    env.advance(0.4);
    await flush();
    expect(env.calls).toHaveLength(1);
    env.advance(5, false);
    expect(env.autonomy.diagnostics.active).toBe(0);
    expect(env.calls).toHaveLength(1);

    const pending = deferred<NpcDecisionResult>();
    const late = setup(() => pending.promise);
    late.autonomy.noteGuidance([goal]);
    late.advance(0.4);
    late.autonomy.noteGuidance([]);
    pending.resolve(selected(late.calls[0]!));
    await flush();
    expect(late.autonomy.diagnostics.active).toBe(0);
    expect(late.autonomy.diagnostics.records.at(-1)?.status).toBe("stale");

    const before = setup();
    before.autonomy.noteGuidance([goal]);
    before.autonomy.noteGuidance([]);
    before.advance(3);
    expect(before.calls).toHaveLength(0);
  });

  test("saves keep only the unexecuted suffix and preserve processed causes", async () => {
    const env = setup(async (payload) => selected(payload));
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4);
    await flush();
    env.advance(0.1);
    expect(env.executed.map((entry) => entry.action.type)).toEqual(["take"]);
    const saved = env.autonomy.snapshot();
    expect(saved.active[0]!.task.actions.map((entry) => entry.type)).toEqual([
      "drop",
    ]);
    const restored = setup(undefined, env.world);
    restored.autonomy.restore(saved);
    restored.advance(3);
    expect(restored.executed.map((entry) => entry.action.type)).toEqual([
      "drop",
    ]);
    expect(restored.calls).toHaveLength(0);
    expect(restored.autonomy.snapshot().roots[0]!.count).toBe(1);
    restored.autonomy.restore(undefined);
    expect(restored.autonomy.snapshot().active).toHaveLength(0);
  });

  test("routine work can be preempted while higher-priority director work holds the NPC", async () => {
    const env = setup();
    env.coordinator.tryEnqueue("figure1", { kind: "routine", id: "walk" }, [
      { type: "moveTo", x: 1, y: 1 },
    ]);
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4, false);
    await flush();
    expect(env.calls).toHaveLength(1);
    const director = setup();
    director.coordinator.tryEnqueue(
      "figure1",
      { kind: "director", id: "scene" },
      [{ type: "moveTo", x: 1, y: 1 }],
    );
    director.autonomy.noteEvents([director.event("root")]);
    director.advance(1, false);
    expect(director.calls).toHaveLength(0);
    director.coordinator.cancelFigure("figure1");
    director.advance(0.1, false);
    await flush();
    expect(director.calls).toHaveLength(1);
  });

  test("movement rumors do not trigger decisions; meaningful gossip retains its original root", async () => {
    const env = setup();
    const memory: MemoryEpisode = {
      id: "heard",
      sequence: 1,
      cycle: 1,
      kind: "movement",
      text: "Walked",
      roomIds: ["a"],
      entityIds: ["shelf"],
      observerIds: ["figure1"],
      originId: "world:1:100",
      cause: { rootId: "original" },
    };
    env.memories.push(memory);
    env.autonomy.noteRumor({
      listenerId: "figure1",
      speakerId: "other",
      text: "Walked",
      heardByPlayer: false,
      originId: memory.originId!,
      cause: memory.cause,
    });
    env.advance(1);
    await flush();
    expect(env.calls).toHaveLength(0);
    env.memories.push({
      ...memory,
      id: "heard-action",
      kind: "action",
      originId: "world:1:101",
    });
    env.autonomy.noteRumor({
      listenerId: "figure1",
      speakerId: "other",
      text: "Moved the shelf",
      heardByPlayer: false,
      originId: "world:1:101",
      cause: memory.cause,
    });
    env.advance(0.4);
    await flush();
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]!.cause.rootId).toBe("original");
  });

  test("opening a container only creates a second decision when something becomes newly visible", async () => {
    for (const hiddenItem of [false, true]) {
      let requests = 0;
      const env = setup(async (payload) =>
        requests++ === 0
          ? selected(payload, [
              { type: "open", targetId: "shelf" },
              { type: "close", targetId: "shelf" },
            ])
          : waitResult(payload),
      );
      const shelf = env.world.objectById.get("shelf")!;
      shelf.state.open = false;
      shelf.affordances.push("open", "close");
      if (hiddenItem)
        env.world.objectById.get("rope")!.location = {
          kind: "inside",
          objectId: "shelf",
        };
      env.autonomy.noteGuidance([
        {
          figureId: "figure1",
          goalId: "look",
          goal: "Look inside",
          lifetimeSeconds: 180,
        },
      ]);
      env.advance(0.4);
      await flush();
      env.advance(2);
      await flush();
      env.advance(2);
      await flush();
      expect(env.executed.map((entry) => entry.action.type)).toEqual([
        "open",
        "close",
      ]);
      expect(env.calls).toHaveLength(hiddenItem ? 2 : 1);
      if (hiddenItem) {
        expect(env.calls[1]!.cause.kind).toBe("discovery");
        expect(env.calls[1]!.cause.rootId).toBe(env.calls[0]!.cause.rootId);
      }
    }
  });

  test("a newly affected object wakes a waiting NPC, while an unchanged blocked dependency stays asleep", async () => {
    const env = setup();
    env.autonomy.noteEvents([env.event("first")]);
    env.advance(0.4);
    await flush();
    const changed = env.event("new-object");
    const rope = env.world.objectById.get("rope")!;
    const fact = {
      id: rope.id,
      name: rope.name,
      state: {},
      location: rope.location,
    };
    changed.before.objects = [fact];
    changed.after.objects = [fact];
    changed.events = [
      { type: "object.opened", actor: { kind: "player" }, objectId: "rope" },
    ];
    changed.witnessViews.figure1 = {
      before: { actor: true, objectIds: ["rope"], door: false },
      after: { actor: true, objectIds: ["rope"], door: false },
    };
    env.autonomy.noteEvents([changed]);
    env.advance(0.4);
    await flush();
    expect(env.calls).toHaveLength(2);
  });

  test("an offscreen NPC completes its job and a removed actor cannot execute", async () => {
    const env = setup(async (payload) => selected(payload));
    env.world.figures[0]!.roomId = "b";
    env.world.objectById.get("shelf")!.location = {
      kind: "room",
      roomId: "b",
      x: 9,
      y: 4,
    };
    env.autonomy.noteGuidance([
      {
        figureId: "figure1",
        goalId: "tidy",
        goal: "Tidy up",
        lifetimeSeconds: 180,
      },
    ]);
    env.advance(0.4);
    await flush();
    env.advance(3);
    expect(env.executed.map((entry) => entry.action.type)).toEqual([
      "take",
      "drop",
    ]);
    expect(env.world.currentRoomId).toBe("a");
    const removed = setup(async (payload) => selected(payload));
    removed.autonomy.noteEvents([removed.event("root")]);
    removed.advance(0.4);
    await flush();
    removed.world.figures.length = 0;
    removed.advance(3);
    expect(removed.executed).toHaveLength(0);
  });

  test("walking guards do not rebuild the full world context every frame", async () => {
    const env = setup(async (payload) =>
      selected(payload, [{ type: "moveTo", roomId: "a", x: 1, y: 1 }]),
    );
    const context = env.host.context;
    let snapshots = 0;
    env.host.context = (figureId) => {
      snapshots++;
      return context(figureId);
    };
    env.autonomy.noteEvents([env.event("root")]);
    env.advance(0.4);
    await flush();
    const before = snapshots;
    env.advance(1);
    expect(snapshots).toBe(before);
    expect(env.world.figures[0]!.walking).toBe(true);
  });

  test("an unexpected physical refusal receives one reconsideration, then stays quiet for 1000 frames", async () => {
    let count = 0;
    const env = setup(async (payload) =>
      count++ === 0
        ? selected(payload, [
            { type: "take", objectId: "shelf" },
            { type: "open", targetId: "shelf" },
          ])
        : waitResult(payload),
    );
    env.autonomy.noteEvents([env.event("one-cause")]);
    env.advance(0.4);
    await flush();
    env.advance(2);
    await flush();
    expect(env.calls).toHaveLength(2);
    expect(env.calls[1]!.cause.kind).toBe("blocked");
    expect(env.calls[1]!.cause.rootId).toBe("one-cause");
    expect(env.calls[1]!.currentTask?.actions).toEqual([
      { type: "open", targetId: "shelf" },
    ]);
    expect(env.calls[1]!.currentTask?.summary).toContain("Отказ движка");
    expect(env.executed.map((entry) => entry.action.type)).toEqual([
      "take",
      "open",
    ]);
    env.advance(100);
    await flush();
    expect(env.calls).toHaveLength(2);
    expect(env.world.objectById.get("shelf")!.location).toEqual({
      kind: "held",
      actor: { kind: "figure", id: "figure1" },
    });
  });

  test("dialogue and higher-priority preemption do not create blocked reconsiderations", async () => {
    for (const reason of [
      "conversation began",
      "preempted by director",
      "figure talk",
      "cancelled",
    ]) {
      const env = setup(async (payload) =>
        selected(payload, [{ type: "moveTo", roomId: "a", x: 1, y: 1 }]),
      );
      env.autonomy.noteEvents([env.event("root")]);
      env.advance(0.4);
      await flush();
      env.coordinator.cancelFigure("figure1", reason);
      env.advance(100);
      await flush();
      expect(env.calls).toHaveLength(1);
      expect(env.autonomy.diagnostics.records.at(-1)?.status).toBe("cancelled");
    }
  });

  test("an already composed goal starts next tick while receipt bursts still wait 300ms", async () => {
    const goal = setup();
    goal.autonomy.noteGuidance([
      {
        figureId: "figure1",
        goalId: "look",
        goal: "Look around",
        lifetimeSeconds: 180,
      },
    ]);
    expect(goal.calls).toHaveLength(0);
    goal.autonomy.tick(0.01);
    expect(goal.calls).toHaveLength(1);
    const receipt = setup();
    receipt.autonomy.noteEvents([receipt.event("root")]);
    receipt.autonomy.tick(0.01);
    expect(receipt.calls).toHaveLength(0);
    receipt.autonomy.tick(0.29);
    expect(receipt.calls).toHaveLength(1);
    await flush();
  });
});
