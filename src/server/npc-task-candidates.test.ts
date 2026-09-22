import { describe, expect, test } from "bun:test";
import type { WorldSnapshotObject } from "../shared/ai";
import type { MemoryEpisode } from "../shared/episodic-memory";
import {
  npcDependencyFingerprint,
  npcTaskIsCurrent,
  type NpcDecisionRequest,
} from "../shared/npc-decision";
import type { WorldActionEnvelope } from "../shared/world-action";
import { executeWorldAction } from "../shared/world-action-engine";
import {
  captureWorldAction,
  createWorldMind,
  recordWorldAction,
} from "../shared/world-mind";
import { sandboxFromSnapshot } from "../shared/world-sandbox";
import { buildNpcTaskCandidates } from "./npc-task-candidates";
import { dialogueWorldContext } from "./dialogue-messages";

function cup(
  overrides: Partial<WorldSnapshotObject> = {},
): WorldSnapshotObject {
  return {
    id: "cup",
    name: "чашка",
    location: { kind: "room", roomId: "hall", x: 5, y: 2 },
    mobility: "carryable",
    affordances: ["take", "drop", "give", "put", "use"],
    state: {},
    keyId: null,
    body: null,
    clueId: "private-clue",
    holdsShardId: "private-shard",
    tags: ["private-tag"],
    ...overrides,
  };
}

function request(objects = [cup()]): NpcDecisionRequest {
  const room = (id: string) => ({
    id,
    name: id,
    kind: "place" as const,
    personality: "private-room-mind",
    visitCount: 3,
    tags: ["private-room-tag"],
  });
  const figure = (id: string, x: number) => ({
    id,
    name: id,
    roomId: "hall",
    x,
    y: 2,
    holdsShardId: "private-figure-shard",
    role: "сосед",
    personality: "бережливый",
    activity: "прибирает",
    fate: "present" as const,
    fateCycle: null,
    fateRoomId: null,
    fateQuoted: null,
  });
  return {
    slug: "test",
    requestId: "r1",
    runId: "run",
    cycleNumber: 1,
    figureId: "neighbor",
    cause: { rootId: "root", kind: "receipt" },
    world: {
      rooms: [room("hall"), room("yard"), room("private-unknown-room")],
      geometry: {
        hall: { width: 12, height: 10, cells: Array(10).fill("............") },
        yard: { width: 12, height: 10, cells: Array(10).fill("............") },
      },
      doors: [],
      figures: [figure("neighbor", 2), figure("friend", 3)],
      interests: [],
      fateHistory: [],
      objects,
      player: { roomId: "hall", x: 4, y: 2 },
      worldRevision: 1,
      mood: "upper-dynamic",
    },
  };
}

function act(req: NpcDecisionRequest, envelopes: WorldActionEnvelope[]) {
  const world = sandboxFromSnapshot(req.world);
  const ledger = createWorldMind();
  for (const envelope of envelopes) {
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(ledger, world, envelope, result, before, req.cycleNumber);
  }
  req.world.objects = structuredClone(world.objects);
  req.world.player = world.getPlayerPose()!;
  req.world.worldMind = ledger.events;
  req.cause.evidenceIds = ledger.events.map(
    (entry) => `receipt:${entry.cycle}:${entry.sequence}`,
  );
}

describe("NPC decision candidates", () => {
  test("approach and take form one validated task, without raw approach teleport", () => {
    const req = request();
    const { candidates } = buildNpcTaskCandidates(req);
    const take = candidates.find(
      (candidate) => candidate.task?.actions.at(-1)?.type === "take",
    )!;
    expect(take.task).toBeDefined();
    expect(take.task!.actions.map((action) => action.type)).toEqual([
      "moveTo",
      "take",
    ]);
    const sandbox = sandboxFromSnapshot(req.world);
    for (const action of take.task!.actions)
      expect(
        executeWorldAction(sandbox, {
          actor: { kind: "figure", id: req.figureId },
          source: "npc",
          action,
        }).ok,
      ).toBe(true);
    expect(sandbox.objectById.get("cup")!.location).toEqual({
      kind: "held",
      actor: { kind: "figure", id: req.figureId },
    });
    expect(req.world.objects[0]!.location.kind).toBe("room");
  });

  test("portable objects can be acquired then transferred or stored in one task", () => {
    const req = request([
      cup(),
      cup({
        id: "box",
        name: "ящик",
        location: { kind: "room", roomId: "hall", x: 6, y: 4 },
        mobility: "fixed",
        affordances: ["open", "close"],
        state: { open: false },
      }),
    ]);
    const { candidates } = buildNpcTaskCandidates(req);
    const transfer = candidates.find(
      (candidate) =>
        candidate.task?.actions.some((action) => action.type === "take") &&
        candidate.task.actions.at(-1)?.type === "give",
    )!;
    const storage = candidates.find(
      (candidate) => candidate.task?.actions.at(-1)?.type === "put",
    )!;
    expect(transfer.task).toBeDefined();
    expect(storage.task!.actions.map((action) => action.type)).toEqual([
      "moveTo",
      "take",
      "moveTo",
      "open",
      "put",
    ]);
    const sandbox = sandboxFromSnapshot(req.world);
    for (const action of storage.task!.actions)
      expect(
        executeWorldAction(sandbox, {
          actor: { kind: "figure", id: req.figureId },
          source: "npc",
          action,
        }).ok,
      ).toBe(true);
    expect(sandbox.objectById.get("cup")!.location).toEqual({
      kind: "inside",
      objectId: "box",
    });
  });

  test("only witnessed previous locations create return tasks", () => {
    const req = request();
    act(req, [
      {
        actor: { kind: "player" },
        source: "player",
        action: { type: "take", objectId: "cup" },
      },
      {
        actor: { kind: "player" },
        source: "player",
        action: { type: "drop", objectId: "cup", x: 4, y: 3 },
      },
    ]);
    const { candidates } = buildNpcTaskCandidates(req);
    const restore = candidates.find((candidate) =>
      candidate.description.includes("прежнее место"),
    )!;
    expect(restore.task!.actions.at(-1)).toEqual({
      type: "drop",
      objectId: "cup",
      x: 5,
      y: 2,
    });
    req.world.worldMind = [];
    expect(
      buildNpcTaskCandidates(req).candidates.some((candidate) =>
        candidate.description.includes("прежнее место"),
      ),
    ).toBe(false);
  });

  test("return to previous holder uses observed ownership, never artifact identity", () => {
    const req = request([
      cup({
        location: { kind: "held", actor: { kind: "figure", id: "friend" } },
      }),
    ]);
    act(req, [
      {
        actor: { kind: "figure", id: "friend" },
        source: "npc",
        action: { type: "drop", objectId: "cup", x: 4, y: 3 },
      },
    ]);
    const restore = buildNpcTaskCandidates(req).candidates.find((candidate) =>
      candidate.description.includes("держал эту вещь"),
    )!;
    expect(restore.task!.actions.at(-1)).toEqual({
      type: "give",
      objectId: "cup",
      to: { kind: "figure", id: "friend" },
    });
    req.world.worldMind = req.world.worldMind!.map((event) => ({
      ...event,
      witnessIds: [],
    }));
    expect(
      buildNpcTaskCandidates(req).candidates.some((candidate) =>
        candidate.description.includes("держал эту вещь"),
      ),
    ).toBe(false);
  });

  test("model context and labels exclude hidden contents, unseen doors and bookkeeping", () => {
    const req = request([
      cup({
        id: "box",
        name: "ящик",
        mobility: "fixed",
        state: { open: false },
        affordances: ["open", "close"],
      }),
      cup({
        id: "private-hidden-item",
        name: "private-hidden-name",
        location: { kind: "inside", objectId: "box" },
      }),
    ]);
    req.world.doors.push({
      id: "private-hidden-door",
      hidden: true,
      fromRoomId: "hall",
      toRoomId: "private-unknown-room",
      x: 3,
      y: 2,
      type: "open",
      keyId: null,
      threshold: "rift",
    });
    const result = buildNpcTaskCandidates(req);
    const wire = JSON.stringify({
      context: result.context,
      options: result.candidates.map(({ id, description }) => ({
        id,
        description,
      })),
    });
    for (const hidden of [
      "private-hidden-item",
      "private-hidden-name",
      "private-hidden-door",
      "private-unknown-room",
      "private-clue",
      "private-shard",
      "private-tag",
      "private-room-mind",
      "private-room-tag",
      "geometry",
      "holdsShardId",
    ])
      expect(wire.includes(hidden)).toBe(false);
  });

  test("foreign memories and unseen receipts never enter model context", () => {
    const req = request();
    req.memories = [
      {
        id: "m1",
        sequence: 1,
        cycle: 1,
        kind: "observation",
        text: "private-foreign-memory",
        observerIds: ["friend"],
        roomIds: ["hall"],
        entityIds: ["cup"],
      },
    ];
    act(req, [
      {
        actor: { kind: "player" },
        source: "player",
        action: { type: "take", objectId: "cup" },
      },
    ]);
    req.world.worldMind![0]!.witnessIds = ["friend"];
    const wire = JSON.stringify(buildNpcTaskCandidates(req).context);
    expect(wire.includes("private-foreign-memory")).toBe(false);
    expect(wire.includes('"actionType":"take"')).toBe(false);
  });

  test("current witnessed closed-container occupancy does not expose a hidden actor", () => {
    const req = request([
      cup({
        id: "box",
        state: {
          open: false,
          occupancy: {
            actor: { kind: "figure", id: "private-hidden-actor" },
            pose: "hidden",
            returnPose: { roomId: "private-place", x: 1, y: 1 },
          },
        },
        mobility: "fixed",
        affordances: ["open"],
      }),
    ]);
    expect(JSON.stringify(buildNpcTaskCandidates(req).context)).not.toContain(
      "private-hidden-actor",
    );
    expect(JSON.stringify(buildNpcTaskCandidates(req).context)).not.toContain(
      "private-place",
    );
  });

  test("closed-container hidden occupancy cannot change advertised choices", () => {
    const req = request([
      cup({
        id: "box",
        name: "ящик",
        mobility: "fixed",
        affordances: ["open", "close", "occupy"],
        profile: {
          kind: "furniture",
          container: "closed",
          occupancy: { pose: "hidden" },
        },
        state: { open: false },
      }),
    ]);
    const empty = buildNpcTaskCandidates(req).candidates.map(
      ({ description }) => description,
    );
    req.world.objects[0]!.state.occupancy = {
      actor: { kind: "figure", id: "private-hidden-actor" },
      pose: "hidden",
      returnPose: { roomId: "hall", x: 5, y: 2 },
    };
    const occupied = buildNpcTaskCandidates(req).candidates.map(
      ({ description }) => description,
    );
    expect(occupied).toEqual(empty);
  });

  test("real concealed NPCs and their held inventory never appear as visible transfer targets", () => {
    for (const state of [
      { open: false, pose: "sitting" as const },
      { open: true, pose: "hidden" as const },
    ]) {
      const req = request([
        cup(),
        cup({
          id: "box",
          name: "ящик",
          mobility: "fixed",
          affordances: ["open", "close"],
          state: {
            open: state.open,
            occupancy: {
              actor: { kind: "figure", id: "friend" },
              pose: state.pose,
              returnPose: { roomId: "hall", x: 3, y: 2 },
            },
          },
        }),
        cup({
          id: "hidden-held-item",
          name: "скрытая записка",
          location: { kind: "held", actor: { kind: "figure", id: "friend" } },
        }),
      ]);
      req.world.figures.find((figure) => figure.id === "friend")!.name =
        "Скрытый друг";
      for (const observer of ["neighbor", null]) {
        const scene = dialogueWorldContext(req.world, observer);
        expect(scene.figures.some((figure) => figure.id === "friend")).toBe(
          false,
        );
        expect(
          scene.objects.some((object) => object.id === "hidden-held-item"),
        ).toBe(false);
        expect(
          scene.objects.find((object) => object.id === "box")!.state.occupancy,
        ).toBeUndefined();
      }
      const own = dialogueWorldContext(req.world, "friend");
      expect(own.figures.some((figure) => figure.id === "friend")).toBe(true);
      expect(
        own.objects.some((object) => object.id === "hidden-held-item"),
      ).toBe(true);
      const { context, candidates } = buildNpcTaskCandidates(req);
      const advertised = JSON.stringify({
        context,
        candidates: candidates.map(({ id, description }) => ({
          id,
          description,
        })),
      });
      expect(advertised).not.toContain("Скрытый друг");
      expect(advertised).not.toContain("hidden-held-item");
      expect(
        candidates.some((candidate) =>
          candidate.task?.actions.some(
            (action) =>
              action.type === "give" &&
              action.to.kind === "figure" &&
              action.to.id === "friend",
          ),
        ),
      ).toBe(false);
    }
  });

  test("visible threshold traversal is a physical route and does not reveal destination", () => {
    const req = request([]);
    req.world.doors.push({
      id: "door",
      fromRoomId: "hall",
      toRoomId: "yard",
      x: 6,
      y: 2,
      toX: 1,
      toY: 1,
      type: "open",
      keyId: null,
      threshold: "door",
    });
    const result = buildNpcTaskCandidates(req);
    const route = result.candidates.find((candidate) =>
      candidate.task?.actions.some((action) => action.type === "traverseDoor"),
    )!;
    expect(route.task!.actions.map((action) => action.type)).toEqual([
      "moveTo",
      "traverseDoor",
    ]);
    expect(JSON.stringify(result.context)).not.toContain("yard");
    expect(route.description).not.toContain("yard");
    expect(
      buildNpcTaskCandidates(req, { pinnedRoomId: "hall" }).candidates.every(
        (candidate) =>
          !candidate.task?.actions.some(
            (action) => action.type === "traverseDoor",
          ),
      ),
    ).toBe(true);
  });

  test("Eye and absent figures cannot move or interact", () => {
    const req = request();
    req.figureId = "glaz";
    req.world.figures[0]!.id = "glaz";
    expect(buildNpcTaskCandidates(req).candidates).toEqual([
      {
        id: "wait",
        description: "Остаться при своём занятии до существенного изменения",
        task: null,
      },
    ]);
    req.figureId = "neighbor";
    req.world.figures[0]!.id = "neighbor";
    req.world.figures[0]!.fate = "dead";
    expect(
      buildNpcTaskCandidates(req).candidates.every(
        (candidate) => candidate.task === null,
      ),
    ).toBe(true);
  });

  test("blocked reconsideration excludes unchanged failed actions and never offers continue", () => {
    const req = request();
    const task = buildNpcTaskCandidates(req).candidates.find(
      (candidate) => candidate.task?.actions.at(-1)?.type === "take",
    )!.task!;
    req.currentTask = {
      ...task,
      actions: [{ type: "take", objectId: "cup" }],
      summary: "Не удалось взять чашку: отказ движка",
    };
    req.cause.kind = "blocked";
    const blocked = buildNpcTaskCandidates(req);
    expect(
      blocked.candidates.some((candidate) => candidate.id === "continue"),
    ).toBe(false);
    expect(
      blocked.candidates.some((candidate) =>
        candidate.task?.actions.some(
          (action) => action.type === "take" && action.objectId === "cup",
        ),
      ),
    ).toBe(false);
    expect(
      blocked.candidates.some((candidate) => candidate.id === "wait"),
    ).toBe(true);
    expect(blocked.context.blockedTask?.summary).toBe(req.currentTask.summary);
    req.world.objects[0]!.state.dirty = true;
    expect(
      buildNpcTaskCandidates(req).candidates.some((candidate) =>
        candidate.task?.actions.some(
          (action) => action.type === "take" && action.objectId === "cup",
        ),
      ),
    ).toBe(true);
  });

  test("failed macros remain excluded when another approach coordinate would lead to same actions", () => {
    const req = request();
    const task = buildNpcTaskCandidates(req).candidates.find(
      (candidate) => candidate.task?.actions.at(-1)?.type === "take",
    )!.task!;
    req.currentTask = {
      ...task,
      actions: [
        { type: "moveTo", roomId: "hall", x: 1, y: 1 },
        { type: "take", objectId: "cup" },
      ],
    };
    req.cause.kind = "blocked";
    expect(
      buildNpcTaskCandidates(req).candidates.some(
        (candidate) => candidate.task?.actions.at(-1)?.type === "take",
      ),
    ).toBe(false);
  });

  test("unreachable objects and locked thresholds produce no executable choice", () => {
    const req = request([
      cup({ location: { kind: "room", roomId: "hall", x: 10, y: 2 } }),
    ]);
    req.world.geometry!.hall!.cells = Array(10).fill("......#.....");
    req.world.doors.push({
      id: "sealed",
      fromRoomId: "hall",
      toRoomId: "yard",
      x: 2,
      y: 4,
      type: "sealed",
      keyId: null,
      threshold: "door",
    });
    expect(
      buildNpcTaskCandidates(req).candidates.filter(
        (candidate) => candidate.task,
      ),
    ).toHaveLength(0);
  });

  test("known rooms alone never expose an unseen connecting door", () => {
    const req = request([]);
    req.memories = [
      {
        id: "m1",
        sequence: 1,
        cycle: 1,
        kind: "observation",
        text: "Помню двор",
        observerIds: ["neighbor"],
        roomIds: ["yard"],
        entityIds: [],
      } satisfies MemoryEpisode,
    ];
    req.world.doors.push({
      id: "remote-door",
      fromRoomId: "hall",
      toRoomId: "yard",
      x: 11,
      y: 9,
      type: "open",
      keyId: null,
      threshold: "door",
    });
    expect(
      buildNpcTaskCandidates(req).candidates.filter(
        (candidate) => candidate.task,
      ),
    ).toHaveLength(0);
  });

  test("known multi-room routes bypass an earlier sealed parallel exit", () => {
    for (const reverse of [false, true]) {
      const req = request([]);
      req.world.rooms.push({
        ...req.world.rooms[1]!,
        id: "garden",
        name: "сад",
      });
      req.world.geometry!.garden = structuredClone(req.world.geometry!.yard!);
      const parallel = [
        {
          id: "sealed-first",
          fromRoomId: "hall",
          toRoomId: "yard",
          x: 4,
          y: 2,
          toX: 1,
          toY: 1,
          type: "sealed",
          keyId: null,
          threshold: "door",
        },
        {
          id: "open-second",
          fromRoomId: "hall",
          toRoomId: "yard",
          x: 5,
          y: 2,
          toX: 1,
          toY: 1,
          type: "open",
          keyId: null,
          threshold: "door",
        },
      ];
      req.world.doors = [
        ...(reverse ? parallel.reverse() : parallel),
        {
          id: "garden-door",
          fromRoomId: "yard",
          toRoomId: "garden",
          x: 3,
          y: 2,
          toX: 1,
          toY: 1,
          type: "open",
          keyId: null,
          threshold: "door",
        },
      ];
      // The remote threshold is known from the NPC's own earlier traversal.
      req.world.figures[0]!.roomId = "yard";
      act(req, [
        {
          actor: { kind: "figure", id: req.figureId },
          source: "npc",
          action: { type: "traverseDoor", doorId: "garden-door" },
        },
      ]);
      req.world.figures[0]!.roomId = "hall";
      const route = buildNpcTaskCandidates(req).candidates.find(
        (candidate) =>
          candidate.description === "Дойти до знакомого места: сад",
      )?.task;
      expect(route).toBeDefined();
      expect(
        route!.actions
          .filter((action) => action.type === "traverseDoor")
          .map((action) => action.doorId),
      ).toEqual(["open-second", "garden-door"]);
      const sandbox = sandboxFromSnapshot(req.world);
      for (const action of route!.actions)
        expect(
          executeWorldAction(sandbox, {
            actor: { kind: "figure", id: req.figureId },
            source: "npc",
            action,
          }).ok,
        ).toBe(true);
      expect(sandbox.getFigurePose(req.figureId)!.roomId).toBe("garden");
      expect(req.world.figures[0]!.roomId).toBe("hall");
    }
  });

  test("one-hop known destination survives deduplication with its useful label", () => {
    const req = request([]);
    req.world.doors.push({
      id: "opaque-door",
      fromRoomId: "hall",
      toRoomId: "yard",
      x: 4,
      y: 2,
      toX: 1,
      toY: 1,
      type: "open",
      keyId: null,
      threshold: "door",
    });
    req.memories = [
      {
        id: "m-yard",
        sequence: 1,
        cycle: 1,
        kind: "observation",
        text: "Помню двор",
        observerIds: [req.figureId],
        roomIds: ["yard"],
        entityIds: [],
      },
    ];
    req.goal = {
      figureId: req.figureId,
      goalId: "go-yard",
      goal: "Дойти в yard",
      lifetimeSeconds: 180,
    };
    const routes = buildNpcTaskCandidates(req).candidates.filter((candidate) =>
      candidate.task?.actions.some(
        (action) =>
          action.type === "traverseDoor" && action.doorId === "opaque-door",
      ),
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]!.description).toBe("Дойти до знакомого места: yard");
    req.memories = [];
    req.goal = undefined;
    const unknown = buildNpcTaskCandidates(req).candidates.find((candidate) =>
      candidate.task?.actions.some((action) => action.type === "traverseDoor"),
    );
    expect(unknown?.description).toBe("Пройти через видимый порог opaque-door");
  });
});

describe("NPC dependency guards", () => {
  test("unrelated movement/revision is stable; ownership, actor room and door changes are not", () => {
    const req = request();
    const task = buildNpcTaskCandidates(req).candidates.find((candidate) =>
      candidate.task?.actions.some((action) => action.type === "take"),
    )!.task!;
    req.world.worldRevision += 20;
    req.world.player.x += 2;
    req.world.figures[0]!.x += 1;
    req.world.figures[1]!.activity = "читает";
    expect(npcTaskIsCurrent(req.world, task)).toBe(true);
    req.world.objects[0]!.location = {
      kind: "held",
      actor: { kind: "player" },
    };
    expect(npcTaskIsCurrent(req.world, task)).toBe(false);
    const dep = {
      figureId: "neighbor",
      objectIds: [],
      doorIds: ["door"],
      actorIds: ["friend"],
    };
    const fingerprint = npcDependencyFingerprint(req.world, dep);
    req.world.figures[1]!.roomId = "yard";
    expect(npcDependencyFingerprint(req.world, dep)).not.toBe(fingerprint);
    req.world.figures[1]!.roomId = "hall";
    req.world.doors.push({
      id: "door",
      type: "open",
      fromRoomId: "hall",
      toRoomId: "yard",
      x: 2,
      y: 2,
      keyId: null,
      threshold: "door",
    });
    expect(npcDependencyFingerprint(req.world, dep)).not.toBe(fingerprint);
  });
});
