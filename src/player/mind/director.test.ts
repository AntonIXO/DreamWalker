import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import type { DirectorPlan, DirectorSituation } from "../../shared/director";
import type {
  WorldActionEnvelope,
  WorldActionResult,
} from "../../shared/world-action";
import type { WorldMindEvent } from "../../shared/world-mind";
import { createWorld } from "../game/world";
import { snapshot } from "./remote";
import {
  WorldDirector,
  directorGuardHolds,
  type DirectorHost,
  type WorldDirectorOptions,
} from "./director";
import { NpcTaskCoordinator } from "../game/npc-task-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const success = (): WorldActionResult => ({
  ok: true,
  events: [],
  affectedRooms: [],
  affectedObjects: [],
  refusal: null,
});

function setup(
  request: NonNullable<DirectorHost["request"]> = async () => ({
    situations: [],
  }),
  options: WorldDirectorOptions = {},
) {
  const artifact = validateDreamArtifact(structuredClone(fixture));
  const world = createWorld(artifact);
  let calls = 0;
  let cycle = 1;
  let view = { roomId: "b", rect: { x: 0, y: 0, w: 2, h: 2 } };
  const executed: WorldActionEnvelope[] = [];
  const host: DirectorHost = {
    context: () => ({
      runId: "test-run",
      cycleNumber: cycle,
      world: snapshot(world),
    }),
    playerPose: () => ({ roomId: world.currentRoomId, x: 1, y: 1 }),
    viewport: () => view,
    trySpendCall: () => {
      calls++;
      return calls <= 11;
    },
    execute: (envelope) => {
      executed.push(envelope);
      return success();
    },
    request,
  };
  const director = new WorldDirector(world, host, options);
  return {
    world,
    director,
    host,
    executed,
    calls: () => calls,
    setCycle: (value: number) => {
      cycle = value;
    },
    setView: (value: typeof view) => {
      view = value;
    },
  };
}

function advance(director: WorldDirector, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 10); i++) director.tick(0.1);
}

function situation(figureId: string, id = "coffin-fitting"): DirectorSituation {
  return {
    id,
    goal: "Open the box and close it",
    cause: "The player tried the fitting room",
    lifetimeSeconds: 120,
    steps: [
      {
        id: "act",
        afterSeconds: 0,
        guards: [],
        effect: {
          kind: "npc",
          figureId,
          actions: [
            { type: "open", targetId: "box" },
            { type: "close", targetId: "box" },
          ],
        },
      },
    ],
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("background world director", () => {
  test("social cooperation stops when the NPC has witnessed the costume change", () => {
    const test = setup();
    const object = test.world.objects[0]!;
    object.profile = {
      kind: "garment",
      wear: { slot: "body", appearanceFigureId: "hudozhnik" },
    };
    object.state.wornBy = { kind: "player" };
    object.location = { kind: "held", actor: { kind: "player" } };
    const figureId = test.world.figures[0]!.id;
    const guard = {
      kind: "acceptedRole" as const,
      figureId,
      roleId: "hudozhnik",
    };
    expect(directorGuardHolds(test.world, guard, 1)).toBe(true);
    test.world.roleRecognition = {
      [figureId]: [{ roleId: "hudozhnik", cycle: 1, eventSequence: 1 }],
    };
    expect(directorGuardHolds(test.world, guard, 1)).toBe(false);
  });
  test("coalesces continuous evidence without starving and leaves the simulation clock running during a request", async () => {
    const pending = deferred<DirectorPlan>();
    const test = setup(() => pending.promise);
    for (let i = 0; i < 40; i++) {
      test.director.noteProgress(`interaction ${i}`);
      test.director.tick(0.1);
    }
    expect(test.calls()).toBe(1);
    expect(test.director.waiting).toBe(true);
    const before = test.director.snapshot().elapsedSeconds;
    advance(test.director, 5);
    expect(test.director.snapshot().elapsedSeconds).toBeGreaterThan(before + 4);
    expect(test.calls()).toBe(1);
    pending.resolve({ situations: [] });
    await flush();
    expect(test.director.waiting).toBe(false);
  });

  test("foreground preempts a late plan and a reset cannot receive an old cycle's effects", async () => {
    const pending = deferred<DirectorPlan>();
    const test = setup(() => pending.promise);
    test.director.noteProgress("coffin");
    advance(test.director, 4);
    test.director.tick(0.1, { foregroundBusy: true });
    pending.resolve({ situations: [situation(test.world.figures[0]!.id)] });
    await flush();
    advance(test.director, 1);
    expect(test.director.activeSituations).toHaveLength(0);
    expect(test.executed).toHaveLength(0);
    test.director.resetCycle();
    test.setCycle(2);
    expect(test.director.snapshot().elapsedSeconds).toBe(0);
  });

  test("a delayed plan cannot act on a changed object, while unrelated changes do not discard it", async () => {
    const pending = deferred<DirectorPlan>();
    const test = setup(() => pending.promise);
    const object = test.world.objects[0]!;
    const other = test.world.objects[1]!;
    const plan = situation(test.world.figures[0]!.id);
    const effect = plan.steps[0]!.effect;
    if (effect.kind !== "npc") throw new Error("fixture");
    effect.actions = [{ type: "open", targetId: object.id }];
    test.director.noteProgress("try opening it");
    advance(test.director, 4);
    object.state.open = true;
    pending.resolve({ situations: [plan] });
    await flush();
    advance(test.director, 1);
    expect(test.director.activeSituations).toHaveLength(0);
    expect(test.executed).toHaveLength(0);
    expect(
      test.director
        .snapshot()
        .signals.some((signal) => signal.includes("context changed")),
    ).toBe(true);

    const fresh = deferred<DirectorPlan>();
    test.host.request = () => fresh.promise;
    advance(test.director, 30);
    other.state.dirty = true;
    test.world.figures[0]!.x += 0.2; // Ordinary walking must not starve composition.
    fresh.resolve({ situations: [plan] });
    await flush();
    advance(test.director, 1);
    expect(test.executed.map((entry) => entry.action.type)).toEqual(["open"]);
  });

  test("moving a containing bag invalidates a delayed plan for its contents", async () => {
    const pending = deferred<DirectorPlan>();
    const test = setup(() => pending.promise);
    const bag = test.world.objects[0]!;
    const item = test.world.objects[1]!;
    item.location = { kind: "inside", objectId: bag.id };
    const plan = situation(test.world.figures[0]!.id);
    const effect = plan.steps[0]!.effect;
    if (effect.kind !== "npc") throw new Error("fixture");
    effect.actions = [{ type: "take", objectId: item.id }];
    test.director.noteProgress("take it from the bag");
    advance(test.director, 4);
    bag.location = { kind: "held", actor: { kind: "player" } };
    pending.resolve({ situations: [plan] });
    await flush();
    advance(test.director, 1);
    expect(test.director.activeSituations).toHaveLength(0);
    expect(test.executed).toHaveLength(0);
  });

  test("rechecks the live viewport after the model returns and waits until a structural change is hidden", async () => {
    const pending = deferred<DirectorPlan>();
    const test = setup(() => pending.promise);
    test.director.noteProgress("entered the hall");
    advance(test.director, 4);
    test.setView({ roomId: "a", rect: { x: 4, y: 0, w: 6, h: 4 } });
    pending.resolve({
      situations: [
        {
          id: "door",
          goal: "Close the old route",
          cause: "repeat visit",
          lifetimeSeconds: 60,
          steps: [
            {
              id: "seal",
              afterSeconds: 0,
              guards: [],
              effect: {
                kind: "patch",
                patch: {
                  kind: "sealDoor",
                  doorId: "a-to-b",
                  reason: "repeat visit",
                },
              },
            },
          ],
        },
      ],
    });
    await flush();
    advance(test.director, 1);
    expect(test.world.doorById.get("a-to-b")?.type).toBe("keyLock");
    test.setView({ roomId: "b", rect: { x: 0, y: 0, w: 2, h: 2 } });
    advance(test.director, 1);
    expect(test.world.doorById.get("a-to-b")?.type).toBe("sealed");
  });

  test("a checkpoint resumes only the unexecuted action suffix, without repeating a successful effect", async () => {
    let figureId = "";
    const test = setup(async () => ({ situations: [situation(figureId)] }));
    figureId = test.world.figures[0]!.id;
    test.director.noteProgress("fitting");
    advance(test.director, 4);
    await flush();
    test.director.tick(0.1); // enqueue
    test.director.tick(0.1); // first physical command
    expect(test.executed.map((entry) => entry.action.type)).toEqual(["open"]);
    const checkpoint = test.director.snapshot();
    expect(
      checkpoint.active[0]?.remainingActions?.map((action) => action.type),
    ).toEqual(["close"]);
    const resumed = new WorldDirector(test.world, test.host);
    resumed.restore(checkpoint);
    advance(resumed, 1);
    expect(test.executed.map((entry) => entry.action.type)).toEqual([
      "open",
      "close",
    ]);
    expect(resumed.activeSituations).toHaveLength(0);
  });

  test("two situations sharing an NPC do not steal its queue or save each other's successful prefix", async () => {
    let figureId = "";
    const test = setup(async () => ({
      situations: [situation(figureId, "one"), situation(figureId, "two")],
    }));
    figureId = test.world.figures[0]!.id;
    test.director.noteProgress("fitting");
    advance(test.director, 4);
    await flush();
    test.director.tick(0.1);
    const state = test.director.snapshot();
    expect(state.active[0]?.remainingActions).toHaveLength(2);
    expect(state.active[1]?.remainingActions).toBeUndefined();
    advance(test.director, 1);
    expect(test.executed.map((entry) => entry.action.type)).toEqual([
      "open",
      "close",
      "open",
      "close",
    ]);
  });

  test("two nearby situations take turns while work in another room can continue", async () => {
    let figureId = "";
    const test = setup(async () => ({
      situations: [
        situation(figureId, "one"),
        situation("second-figure", "two"),
      ],
    }));
    const figure = test.world.figures[0]!;
    figureId = figure.id;
    figure.roomId = test.world.currentRoomId;
    test.world.figures.push({
      ...structuredClone(figure),
      id: "second-figure",
    });
    test.director.noteProgress("fitting");
    advance(test.director, 4);
    await flush();
    test.director.tick(0.1);
    expect(test.director.npcQueue.busyFigureIds.size).toBe(1);
    advance(test.director, 2);
    expect(test.executed.map((entry) => entry.actor)).toEqual([
      { kind: "figure", id: figureId },
      { kind: "figure", id: figureId },
      { kind: "figure", id: "second-figure" },
      { kind: "figure", id: "second-figure" },
    ]);

    test.director.resetCycle();
    test.world.figures[1]!.roomId =
      test.world.currentRoomId === "a" ? "b" : "a";
    test.director.noteProgress("separate rooms");
    advance(test.director, 4);
    await flush();
    test.director.tick(0.1);
    expect(test.director.npcQueue.busyFigureIds.size).toBe(2);
  });

  test("a repeated explicit request can reuse a model label without replaying the previous instance", async () => {
    let figureId = "";
    const test = setup(async () => ({
      situations: [situation(figureId, "repeatable-request")],
    }));
    figureId = test.world.figures[0]!.id;
    test.director.noteProgress("first request");
    advance(test.director, 4);
    await flush();
    advance(test.director, 2);
    expect(test.executed).toHaveLength(2);
    test.director.noteProgress("second request");
    advance(test.director, 30);
    await flush();
    advance(test.director, 2);
    expect(test.executed).toHaveLength(4);
    expect(new Set(test.director.snapshot().completedIds).size).toBe(2);
  });

  test("accepted plans survive model failure; delays pause while the player reads and expire without extra effects", async () => {
    const test = setup(async () => {
      throw new Error("offline");
    });
    const plan = situation(test.world.figures[0]!.id);
    plan.steps[0]!.afterSeconds = 10;
    test.director.restore({
      version: 1,
      elapsedSeconds: 0,
      lastCallAt: null,
      lastProgressAt: 0,
      pendingSince: null,
      signals: [],
      completedIds: [],
      active: [
        { plan, step: 0, acceptedAt: 0, lastStepAt: 0, afterSequence: 1 },
      ],
    });
    for (let i = 0; i < 200; i++)
      test.director.tick(0.1, { presentationHeld: true });
    expect(test.director.snapshot().elapsedSeconds).toBe(0);
    test.director.noteProgress("other event");
    advance(test.director, 5);
    await flush();
    expect(test.director.failureCount).toBe(1);
    expect(test.executed).toHaveLength(0);
    advance(test.director, 6);
    expect(test.executed).toHaveLength(2);
  });

  test("a role or room condition changed during a plan cancels its remaining commands", async () => {
    const test = setup();
    const plan = situation(test.world.figures[0]!.id);
    plan.steps[0]!.guards = [
      {
        kind: "actorRoom",
        actor: { kind: "player" },
        roomId: test.world.currentRoomId,
      },
    ];
    test.director.restore({
      version: 1,
      elapsedSeconds: 0,
      lastCallAt: null,
      lastProgressAt: 0,
      pendingSince: null,
      signals: [],
      completedIds: [],
      active: [
        { plan, step: 0, acceptedAt: 0, lastStepAt: 0, afterSequence: 1 },
      ],
    });
    test.director.tick(0.1);
    test.world.currentRoomId = test.world.currentRoomId === "a" ? "b" : "a";
    advance(test.director, 1);
    expect(test.executed).toHaveLength(0);
    expect(test.director.activeSituations).toHaveLength(0);
  });

  test("a step consumes a precondition changed by its own committed prefix, including after reload", () => {
    const test = setup();
    const object = test.world.objects[0]!;
    object.state.open = false;
    const plan = situation(test.world.figures[0]!.id);
    plan.steps[0]!.guards = [
      { kind: "objectState", objectId: object.id, field: "open", value: false },
    ];
    const executed: string[] = [];
    test.host.execute = (envelope) => {
      executed.push(envelope.action.type);
      object.state.open = envelope.action.type === "open";
      return success();
    };
    test.director.restore({
      version: 1,
      elapsedSeconds: 0,
      lastCallAt: null,
      lastProgressAt: 0,
      pendingSince: null,
      signals: [],
      completedIds: [],
      active: [
        { plan, step: 0, acceptedAt: 0, lastStepAt: 0, afterSequence: 1 },
      ],
    });
    test.director.tick(0.1);
    test.director.tick(0.1);
    expect(object.state.open).toBe(true);
    const saved = test.director.snapshot();
    expect(saved.active[0]?.consumedGuardIndices).toEqual([0]);
    const resumed = new WorldDirector(test.world, test.host);
    resumed.restore(saved);
    advance(resumed, 1);
    expect(executed).toEqual(["open", "close"]);
  });

  test("an observed trigger stays satisfied after reload and physical-log rotation", () => {
    const test = setup();
    const objectId = test.world.objects[0]!.id;
    const plan = situation(test.world.figures[0]!.id);
    plan.steps[0]!.afterSeconds = 5;
    plan.steps[0]!.guards = [
      {
        kind: "receipt",
        actionType: "open",
        actor: { kind: "player" },
        objectId,
      },
    ];
    test.director.restore({
      version: 1,
      elapsedSeconds: 0,
      lastCallAt: null,
      lastProgressAt: 0,
      pendingSince: null,
      signals: [],
      completedIds: [],
      active: [
        { plan, step: 0, acceptedAt: 0, lastStepAt: 0, afterSequence: 1 },
      ],
    });
    const event: WorldMindEvent = {
      sequence: 1,
      cycle: 1,
      revision: 1,
      actor: { kind: "player" },
      source: "player",
      actionType: "open",
      action: { type: "open", targetId: objectId },
      events: [{ type: "object.opened", actor: { kind: "player" }, objectId }],
      roomIds: ["a"],
      witnessIds: [],
      witnessRooms: {},
      witnessViews: {},
      before: { actor: null, objects: [], door: null },
      after: { actor: null, objects: [], door: null },
    };
    test.director.noteEvent(event);
    const saved = test.director.snapshot();
    expect(saved.active[0]?.seenReceiptGuards).toEqual(["0:0"]);
    test.world.worldMind.events = [];
    const resumed = new WorldDirector(test.world, test.host);
    resumed.restore(saved);
    advance(resumed, 7);
    expect(test.executed.map((entry) => entry.action.type)).toEqual([
      "open",
      "close",
    ]);
  });
});

describe("event-driven director and shared NPC ownership", () => {
  test("quiet simulation never invokes the director in event-driven mode", () => {
    const state = setup(undefined, { eventDriven: () => true });
    advance(state.director, 600);
    expect(state.calls()).toBe(0);
  });

  test("guidance is deduplicated by goalId across paraphrases, expiry and reload", async () => {
    const state = setup(undefined, { eventDriven: true });
    const figureId = state.world.figures[0]!.id;
    let goals = 0;
    state.host.onGuidanceChange = (guidance) => {
      if (guidance.length) goals++;
    };
    state.host.request = async () => ({
      situations: [],
      npcGuidance: [
        {
          figureId,
          goalId: "my-bottle",
          goal: "Keep my bottle close",
          lifetimeSeconds: 100,
        },
      ],
    });
    state.director.noteProgress("bottle moved");
    advance(state.director, 4);
    await flush();
    expect(goals).toBe(1);
    expect(state.executed).toHaveLength(0);
    const saved = state.director.snapshot();
    state.director.restore(saved);
    expect(state.director.activeGuidance[0]?.goalId).toBe("my-bottle");
    advance(state.director, 31);
    state.host.request = async () => ({
      situations: [],
      npcGuidance: [
        {
          figureId,
          goalId: "my-bottle",
          goal: "Keep hold of my bottle",
          lifetimeSeconds: 100,
        },
      ],
    });
    state.director.noteProgress("same intention phrased differently");
    advance(state.director, 4);
    await flush();
    expect(goals).toBe(1);
    advance(state.director, 110);
    expect(state.director.activeGuidance).toHaveLength(0);
    state.director.noteProgress("same old goal after expiry");
    advance(state.director, 4);
    await flush();
    expect(goals).toBe(1);
    expect(state.executed).toHaveLength(0);
  });

  test("external coordinator is ticked only by the host and Jev never receives director guards", () => {
    const state = setup();
    const figureId = state.world.figures[0]!.id;
    const coordinator = new NpcTaskCoordinator(state.world, state.host.execute);
    const director = new WorldDirector(state.world, state.host, {
      coordinator,
      eventDriven: true,
    });
    coordinator.tryEnqueue(figureId, { kind: "jev", id: "simple" }, [
      { type: "take", objectId: "bottle" },
    ]);
    director.tick(0.1);
    expect(state.executed).toHaveLength(0);
    coordinator.tick(0.1);
    expect(state.executed).toHaveLength(1);
    expect(director.snapshot().active).toHaveLength(0);
  });
});

test("a rejected shared-queue submission retains a restored director suffix", () => {
  const state = setup();
  const figureId = state.world.figures[0]!.id;
  const coordinator = new NpcTaskCoordinator(state.world, state.host.execute);
  const director = new WorldDirector(state.world, state.host, {
    coordinator,
    eventDriven: true,
  });
  director.restore({
    ...state.director.snapshot(),
    active: [
      {
        plan: situation(figureId),
        step: 0,
        acceptedAt: 0,
        lastStepAt: 0,
        afterSequence: 1,
        remainingActions: [{ type: "close", targetId: "box" }],
      },
    ],
  });
  const replacement = { kind: "director", id: "scripted-replacement" } as const;
  coordinator.tryEnqueue(
    figureId,
    { kind: "jev", id: "initial" },
    [{ type: "take", objectId: "bottle" }],
    {
      onComplete: () => {
        coordinator.tryEnqueue(figureId, replacement, [
          { type: "drop", objectId: "bottle" },
        ]);
      },
    },
  );
  director.tick(0.1);
  expect(director.snapshot().active[0]!.remainingActions).toEqual([
    { type: "close", targetId: "box" },
  ]);
  coordinator.cancel(figureId, replacement);
  director.tick(0.1);
  coordinator.tick(0.1);
  expect(state.executed.map((entry) => entry.action.type)).toEqual(["close"]);
});
