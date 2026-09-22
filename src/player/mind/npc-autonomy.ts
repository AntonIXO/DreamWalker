/** Event-driven Jev decisions. Walking, task prefixes and time never poll the model. */
import {
  npcDependencyFingerprint,
  type NpcDecisionCause,
  type NpcDecisionDiagnostics,
  type NpcDecisionRequest,
  type NpcDecisionResult,
  type NpcGoal,
  type NpcTask,
  type NpcTaskDependencies,
} from "../../shared/npc-decision";
import {
  worldMindForFigure,
  type WorldMindEvent,
} from "../../shared/world-mind";
import type { NpcTaskCoordinator } from "../game/npc-task-coordinator";
import type { ReplayOutcome } from "../game/npc-action-queue";
import { fateOf } from "../game/fates";
import type { WorldState } from "../game/world";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import type { WorldMutator } from "../../shared/world-object";
import { RETURNS_WHOLE } from "../../shared/verbs";
import type { RumorDelivery } from "./rumors";

export const NPC_AUTONOMY_LIMITS = {
  coalesceSeconds: 0.3,
  decisionsPerRoot: 2,
  lifetimeSeconds: 180,
  maxPending: 128,
  maxRecords: 40,
} as const;

export interface NpcAutonomyHost {
  context(
    figureId: string,
  ): Omit<
    NpcDecisionRequest,
    "requestId" | "figureId" | "cause" | "goal" | "currentTask"
  >;
  coordinator: NpcTaskCoordinator;
  request?(
    payload: NpcDecisionRequest,
    signal: AbortSignal,
  ): Promise<NpcDecisionResult>;
  onChange?(): void;
}

export interface NpcAutonomyTickOptions {
  paused?: boolean;
  foregroundBusy?: boolean;
  presentationHeld?: boolean;
}

interface PendingDecision {
  figureId: string;
  cause: NpcDecisionCause;
  dependencies: NpcTaskDependencies;
  evidenceKey: string;
  direct: boolean;
  queuedAt: number;
  readyAt: number;
  /** Failed physical suffix, supplied only for a one-off blocked reconsideration. */
  currentTask?: NpcTask;
  goalId?: string;
}

interface DecisionRoot {
  rootId: string;
  count: number;
  /** Evidence already considered by each NPC, rather than merely a receipt sequence. */
  considered: Record<string, string[]>;
}

interface DormantDecision {
  figureId: string;
  cause: NpcDecisionCause;
  status: "wait" | "blocked" | "unavailable" | "deferred";
  dependencies: NpcTaskDependencies;
  contextKey: string;
  reason?: string;
}

interface ActiveTask {
  task: NpcTask;
  goalId?: string;
  expiresAt: number;
  queuedAt: number;
  startedAt: number | null;
}

interface SavedGoal {
  goal: NpcGoal;
  expiresAt: number;
}

export interface NpcAutonomyRecord extends NpcDecisionDiagnostics {
  figureId: string;
  rootId: string;
  status:
    | NpcDecisionResult["status"]
    | "stale"
    | "blocked"
    | "completed"
    | "expired"
    | "cancelled";
  source: "jev";
  taskId?: string;
  task?: string;
  startLatencyMs?: number;
  completionMs?: number;
}

export interface NpcAutonomySnapshot {
  version: 1;
  elapsedSeconds: number;
  roots: DecisionRoot[];
  pending: PendingDecision[];
  dormant: DormantDecision[];
  active: ActiveTask[];
  goals: SavedGoal[];
  origins: Array<[string, string]>;
  knownFacts: string[];
  totals: {
    decisions: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  records: NpcAutonomyRecord[];
}

/** Separate from dialogue/Heartbeat: one bounded ordinary JSON call, without retry. */
export async function requestNpcDecision(
  payload: NpcDecisionRequest,
  signal: AbortSignal,
): Promise<NpcDecisionResult> {
  const response = await fetch("/api/ai/npc-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
  });
  if (!response.ok)
    throw new Error(`NPC decision unavailable (${response.status})`);
  const value = await response.json();
  if (!isDecisionResult(value))
    throw new Error("Invalid NPC decision response");
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 240,
    )
  );
}

function isDependencies(value: unknown): value is NpcTaskDependencies {
  return (
    record(value) &&
    typeof value.figureId === "string" &&
    ids(value.objectIds) &&
    ids(value.doorIds) &&
    ids(value.actorIds)
  );
}

function isCause(value: unknown): value is NpcDecisionCause {
  return (
    record(value) &&
    typeof value.rootId === "string" &&
    value.rootId.length > 0 &&
    value.rootId.length <= 240 &&
    ["receipt", "goal", "discovery", "blocked"].includes(String(value.kind)) &&
    (value.evidenceIds === undefined || ids(value.evidenceIds))
  );
}

function isTask(value: unknown): value is NpcTask {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.figureId === "string" &&
    typeof value.summary === "string" &&
    typeof value.contextKey === "string" &&
    isDependencies(value.dependencies) &&
    isCause(value.cause) &&
    finite(value.lifetimeSeconds) &&
    Array.isArray(value.actions) &&
    value.actions.length <= 256 &&
    value.actions.every(
      (action) => record(action) && typeof action.type === "string",
    )
  );
}

function isDecisionResult(value: unknown): value is NpcDecisionResult {
  return (
    record(value) &&
    typeof value.requestId === "string" &&
    typeof value.contextKey === "string" &&
    isDependencies(value.dependencies) &&
    ["selected", "wait", "deferred", "unavailable"].includes(
      String(value.status),
    ) &&
    (value.status !== "selected" || isTask(value.task))
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function emptyDependencies(figureId: string): NpcTaskDependencies {
  return { figureId, objectIds: [], doorIds: [], actorIds: [] };
}

function mergeDependencies(
  left: NpcTaskDependencies,
  right: NpcTaskDependencies,
): NpcTaskDependencies {
  return {
    figureId: left.figureId,
    objectIds: [...new Set([...left.objectIds, ...right.objectIds])],
    doorIds: [...new Set([...left.doorIds, ...right.doorIds])],
    actorIds: [...new Set([...left.actorIds, ...right.actorIds])],
  };
}

function hasNewDependencies(
  incoming: NpcTaskDependencies,
  known: NpcTaskDependencies,
): boolean {
  return (
    incoming.objectIds.some((id) => !known.objectIds.includes(id)) ||
    incoming.doorIds.some((id) => !known.doorIds.includes(id)) ||
    incoming.actorIds.some((id) => !known.actorIds.includes(id))
  );
}

function eventDependencies(
  figureId: string,
  event: WorldMindEvent,
): NpcTaskDependencies {
  const objects = [...event.before.objects, ...event.after.objects];
  const actorIds = new Set<string>();
  for (const object of objects) {
    if (object.location.kind === "held")
      actorIds.add(
        object.location.actor.kind === "player"
          ? "player"
          : object.location.actor.id,
      );
  }
  return {
    figureId,
    objectIds: [...new Set(objects.map((object) => object.id))],
    doorIds: [
      ...new Set(
        [event.before.door?.id, event.after.door?.id].filter(
          (id): id is string => !!id,
        ),
      ),
    ],
    actorIds: [...actorIds],
  };
}

function meaningful(event: WorldMindEvent): boolean {
  return event.events.some(
    (entry) =>
      ![
        "actor.moved",
        "actor.enteredRoom",
        "door.traversed",
        "object.gestured",
        "object.profiled",
      ].includes(entry.type),
  );
}

function directlyAffected(figureId: string, event: WorldMindEvent): boolean {
  return (
    [...event.before.objects, ...event.after.objects].some(
      (object) =>
        object.location.kind === "held" &&
        object.location.actor.kind === "figure" &&
        object.location.actor.id === figureId,
    ) ||
    event.events.some(
      (entry) =>
        entry.type === "object.given" &&
        entry.to.kind === "figure" &&
        entry.to.id === figureId,
    )
  );
}

/** Facts only: sequence, positions of walking actors and global revision are excluded. */
function evidenceKey(event: WorldMindEvent): string {
  return JSON.stringify({
    action: event.actionType,
    objects: event.after.objects,
    door: event.after.door,
    events: event.events.filter(
      (entry) =>
        !["actor.moved", "actor.enteredRoom", "door.traversed"].includes(
          entry.type,
        ),
    ),
  });
}

function pendingKey(figureId: string, rootId: string): string {
  return JSON.stringify([figureId, rootId]);
}

function intentionalCancellation(reason: string | undefined): boolean {
  return (
    [
      "replaced",
      "cycle reset",
      "new goal",
      "actor unavailable",
      "actor does not exist",
      "cancelled",
    ].includes(reason ?? "") ||
    ["preempted by ", "conversation ", "figure "].some((prefix) =>
      reason?.startsWith(prefix),
    )
  );
}

export class NpcAutonomy {
  private elapsedSeconds = 0;
  private roots = new Map<string, DecisionRoot>();
  private pending = new Map<string, PendingDecision>();
  private dormant = new Map<string, DormantDecision>();
  private active = new Map<string, ActiveTask>();
  private goals = new Map<string, SavedGoal>();
  private origins = new Map<string, string>();
  private knownFacts = new Set<string>();
  private records: NpcAutonomyRecord[] = [];
  private totals = {
    decisions: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  private controller: AbortController | null = null;
  private generation = 0;
  private readonly guardWorld: WorldMutator;

  constructor(
    private readonly world: WorldState,
    private readonly host: NpcAutonomyHost,
  ) {
    this.guardWorld = bindWorldMutator(world, staticPlayerPose(null));
  }

  get waiting(): boolean {
    return this.controller !== null;
  }

  get diagnostics() {
    return {
      waiting: this.waiting,
      pending: this.pending.size,
      active: this.active.size,
      ...this.totals,
      records: structuredClone(this.records),
    };
  }

  /** Called once after the outer world action and all nested script reactions settle. */
  noteEvents(events: readonly WorldMindEvent[]): void {
    for (const event of events) {
      const rootId =
        event.cause?.rootId ?? `world:${event.cycle}:${event.sequence}`;
      this.origins.set(`world:${event.cycle}:${event.sequence}`, rootId);
      if (!meaningful(event)) continue;
      const observers = new Set(event.witnessIds);
      if (event.actor?.kind === "figure") observers.add(event.actor.id);
      for (const figureId of observers) {
        if (!this.eligible(figureId)) continue;
        const view = worldMindForFigure([event], figureId, 1)[0];
        if (!view || !meaningful(view)) continue;
        const task = this.active.get(figureId)?.task;
        // Session batches include nested scripts before the queue commits its prefix.
        // Their actor can differ while their cause still belongs to this exact task.
        const ownExpected =
          (task && event.cause?.taskId === task.id) ||
          (event.actor?.kind === "figure" &&
            event.actor.id === figureId &&
            event.cause?.taskId !== undefined);
        const newlyVisible =
          ownExpected && task ? this.revealedObjects(view, task) : [];
        const discovered =
          ownExpected &&
          task &&
          (newlyVisible.length > 0 ||
            view.events.some(
              (entry) =>
                (entry.type === "door.revealed" &&
                  !task.dependencies.doorIds.includes(entry.doorId)) ||
                (entry.type === "object.emptied" &&
                  entry.objectIds.some(
                    (id) => !task.dependencies.objectIds.includes(id),
                  )),
            ));
        if (ownExpected && !discovered) continue;
        const deps = eventDependencies(figureId, view);
        deps.objectIds = [...new Set([...deps.objectIds, ...newlyVisible])];
        const cause: NpcDecisionCause = {
          rootId,
          kind: discovered ? "discovery" : "receipt",
          evidenceIds: [`receipt:${event.cycle}:${event.sequence}`],
        };
        this.queue(
          figureId,
          cause,
          deps,
          evidenceKey(view),
          directlyAffected(figureId, view),
          !!discovered,
        );
      }
    }
  }

  noteGuidance(goals: readonly NpcGoal[]): void {
    const incoming = new Set(goals.map((goal) => goal.figureId));
    for (const figureId of this.goals.keys())
      if (!incoming.has(figureId)) this.removeGoal(figureId);
    for (const goal of goals) {
      if (
        !this.eligible(goal.figureId) ||
        !goal.goalId ||
        !finite(goal.lifetimeSeconds)
      )
        continue;
      const current = this.goals.get(goal.figureId);
      if (current?.goal.goalId === goal.goalId) continue;
      if (current) this.removeGoal(goal.figureId);
      this.goals.set(goal.figureId, {
        goal: structuredClone(goal),
        expiresAt:
          this.elapsedSeconds +
          Math.min(goal.lifetimeSeconds, NPC_AUTONOMY_LIMITS.lifetimeSeconds),
      });
      this.cancelTask(goal.figureId, "new goal");
      this.dormant.delete(goal.figureId);
      this.queue(
        goal.figureId,
        {
          rootId: `goal:${goal.figureId}:${goal.goalId}`,
          kind: "goal",
          evidenceIds: [goal.goalId],
        },
        emptyDependencies(goal.figureId),
        goal.goalId,
        true,
      );
    }
  }

  noteDiscovery(
    figureId: string,
    cause: NpcDecisionCause,
    dependencies = emptyDependencies(figureId),
  ): void {
    if (!isCause(cause)) return;
    this.queue(
      figureId,
      { ...cause, kind: "discovery" },
      dependencies,
      JSON.stringify(cause.evidenceIds ?? [cause.rootId]),
      false,
    );
  }

  /** Heard facts retain the original world cause and therefore its two-call ceiling. */
  noteRumor(delivery: RumorDelivery): void {
    this.noteKnownFact(
      delivery.listenerId,
      delivery.originId,
      delivery.cause?.rootId,
    );
  }

  noteKnownFact(figureId: string, originId: string, rootId?: string): void {
    const key = pendingKey(figureId, originId);
    if (this.knownFacts.has(key) || !this.eligible(figureId)) return;
    this.knownFacts.add(key);
    const context = this.host.context(figureId);
    const memory = context.memories?.find(
      (entry) =>
        entry.originId === originId && entry.observerIds.includes(figureId),
    );
    if (!memory || memory.kind === "movement" || memory.kind === "observation")
      return;
    const receipt = this.world.worldMind.events.find(
      (event) => `world:${event.cycle}:${event.sequence}` === originId,
    );
    if (receipt && !meaningful(receipt)) return;
    this.noteDiscovery(
      figureId,
      {
        rootId:
          rootId ??
          memory.cause?.rootId ??
          this.origins.get(originId) ??
          receipt?.cause?.rootId ??
          originId,
        kind: "discovery",
        evidenceIds: [originId],
      },
      {
        figureId,
        objectIds: memory.entityIds.filter((id) =>
          this.world.objectById.has(id),
        ),
        doorIds: memory.entityIds.filter((id) => this.world.doorById.has(id)),
        actorIds: memory.entityIds.filter(
          (id) =>
            id === "player" ||
            this.world.figures.some((figure) => figure.id === id),
        ),
      },
    );
  }

  tick(deltaSeconds: number, options: NpcAutonomyTickOptions = {}): void {
    if (options.paused || options.foregroundBusy || options.presentationHeld) {
      this.cancelRequest();
      return;
    }
    if (finite(deltaSeconds)) this.elapsedSeconds += deltaSeconds;
    for (const [figureId, goal] of this.goals)
      if (goal.expiresAt <= this.elapsedSeconds) this.removeGoal(figureId);
    for (const [figureId, job] of this.active) {
      if (!this.eligible(figureId))
        this.cancelTask(figureId, "actor unavailable");
      else if (job.expiresAt <= this.elapsedSeconds)
        this.cancelTask(figureId, "expired");
    }
    if (this.waiting) return;
    const candidates = [...this.pending.values()].filter((entry) => {
      const owner = this.host.coordinator.ownerOf(entry.figureId);
      return (
        entry.readyAt <= this.elapsedSeconds &&
        (!owner || owner.kind === "routine")
      );
    });
    // A waiting remote witness eventually outranks new nearby events. Whole-world work cannot starve.
    candidates.sort(
      (a, b) =>
        this.priority(b) - this.priority(a) ||
        a.queuedAt - b.queuedAt ||
        a.figureId.localeCompare(b.figureId),
    );
    for (const pending of candidates) {
      this.pending.delete(pendingKey(pending.figureId, pending.cause.rootId));
      if (!this.eligible(pending.figureId)) continue;
      if (
        pending.goalId &&
        this.goals.get(pending.figureId)?.goal.goalId !== pending.goalId
      )
        continue;
      const sleeping = this.dormant.get(pending.figureId);
      if (
        sleeping &&
        pending.cause.kind !== "goal" &&
        pending.cause.kind !== "discovery" &&
        pending.cause.kind !== "blocked" &&
        (sleeping.status === "blocked" ||
          !hasNewDependencies(pending.dependencies, sleeping.dependencies)) &&
        npcDependencyFingerprint(
          this.host.context(pending.figureId).world,
          sleeping.dependencies,
        ) === sleeping.contextKey
      )
        continue;
      const root = this.root(pending.cause.rootId);
      if (
        root.count >= NPC_AUTONOMY_LIMITS.decisionsPerRoot ||
        root.considered[pending.figureId]?.includes(pending.evidenceKey)
      )
        continue;
      void this.decide(pending);
      return;
    }
  }

  cancelRequest(): void {
    if (!this.controller) return;
    this.generation++;
    this.controller.abort();
    this.controller = null;
    this.changed();
  }

  resetCycle(): void {
    this.cancelRequest();
    for (const figureId of [...this.active.keys()])
      this.cancelTask(figureId, "cycle reset");
    this.elapsedSeconds = 0;
    this.pending.clear();
    this.dormant.clear();
    this.goals.clear();
    this.origins.clear();
    this.roots.clear();
    this.knownFacts.clear();
    this.changed();
  }

  snapshot(): NpcAutonomySnapshot {
    const active: ActiveTask[] = [];
    for (const job of this.active.values()) {
      const actions = this.host.coordinator.remaining(job.task.figureId, {
        kind: "jev",
        id: job.task.id,
      });
      if (actions?.length)
        active.push({ ...job, task: { ...job.task, actions } });
    }
    return structuredClone({
      version: 1,
      elapsedSeconds: this.elapsedSeconds,
      roots: [...this.roots.values()],
      pending: [...this.pending.values()],
      dormant: [...this.dormant.values()],
      active,
      goals: [...this.goals.values()],
      origins: [...this.origins],
      knownFacts: [...this.knownFacts],
      totals: this.totals,
      records: this.records,
    });
  }

  restore(value: unknown): void {
    this.resetCycle();
    if (!record(value) || value.version !== 1) return;
    this.elapsedSeconds = finite(value.elapsedSeconds)
      ? value.elapsedSeconds
      : 0;
    for (const item of Array.isArray(value.roots) ? value.roots : []) {
      if (
        !record(item) ||
        typeof item.rootId !== "string" ||
        !finite(item.count) ||
        !record(item.considered)
      )
        continue;
      const considered = Object.fromEntries(
        Object.entries(item.considered).filter(
          ([, keys]) =>
            Array.isArray(keys) && keys.every((key) => typeof key === "string"),
        ),
      ) as Record<string, string[]>;
      this.roots.set(item.rootId, {
        rootId: item.rootId,
        count: Math.min(2, Math.floor(item.count)),
        considered,
      });
    }
    for (const item of Array.isArray(value.pending)
      ? value.pending.slice(0, NPC_AUTONOMY_LIMITS.maxPending)
      : []) {
      if (
        !record(item) ||
        typeof item.figureId !== "string" ||
        !isCause(item.cause) ||
        !isDependencies(item.dependencies) ||
        typeof item.evidenceKey !== "string" ||
        !finite(item.queuedAt) ||
        !finite(item.readyAt)
      )
        continue;
      if (item.currentTask !== undefined && !isTask(item.currentTask)) continue;
      this.pending.set(
        pendingKey(item.figureId, item.cause.rootId),
        structuredClone(item) as unknown as PendingDecision,
      );
    }
    for (const item of Array.isArray(value.dormant) ? value.dormant : []) {
      if (
        !record(item) ||
        typeof item.figureId !== "string" ||
        !isCause(item.cause) ||
        !isDependencies(item.dependencies) ||
        typeof item.contextKey !== "string" ||
        !["wait", "blocked", "unavailable", "deferred"].includes(
          String(item.status),
        )
      )
        continue;
      this.dormant.set(
        item.figureId,
        structuredClone(item) as unknown as DormantDecision,
      );
    }
    for (const item of Array.isArray(value.goals) ? value.goals : []) {
      if (
        !record(item) ||
        !record(item.goal) ||
        typeof item.goal.figureId !== "string" ||
        typeof item.goal.goalId !== "string" ||
        typeof item.goal.goal !== "string" ||
        !finite(item.goal.lifetimeSeconds) ||
        !finite(item.expiresAt)
      )
        continue;
      this.goals.set(
        item.goal.figureId,
        structuredClone(item) as unknown as SavedGoal,
      );
    }
    for (const item of Array.isArray(value.origins) ? value.origins : [])
      if (
        Array.isArray(item) &&
        item.length === 2 &&
        item.every((entry) => typeof entry === "string")
      )
        this.origins.set(item[0], item[1]);
    if (Array.isArray(value.knownFacts))
      this.knownFacts = new Set(
        value.knownFacts.filter(
          (entry): entry is string => typeof entry === "string",
        ),
      );
    if (record(value.totals)) {
      for (const key of [
        "decisions",
        "inputTokens",
        "outputTokens",
        "costUsd",
      ] as const)
        this.totals[key] = finite(value.totals[key]) ? value.totals[key] : 0;
    }
    if (Array.isArray(value.records))
      this.records = value.records
        .filter(
          (entry) =>
            record(entry) &&
            typeof entry.figureId === "string" &&
            typeof entry.rootId === "string",
        )
        .slice(-NPC_AUTONOMY_LIMITS.maxRecords) as NpcAutonomyRecord[];
    for (const item of Array.isArray(value.active) ? value.active : []) {
      if (
        !record(item) ||
        !isTask(item.task) ||
        !finite(item.expiresAt) ||
        !finite(item.queuedAt) ||
        !(item.startedAt === null || finite(item.startedAt)) ||
        item.expiresAt <= this.elapsedSeconds
      )
        continue;
      const job = structuredClone(item) as unknown as ActiveTask;
      if (!this.eligible(job.task.figureId)) continue;
      const context = this.host.context(job.task.figureId);
      if (
        npcDependencyFingerprint(context.world, job.task.dependencies) !==
        job.task.contextKey
      ) {
        this.sleepTask(job, "blocked", "saved dependency changed");
        continue;
      }
      this.install(job);
    }
    this.changed();
  }

  private eligible(figureId: string): boolean {
    return (
      figureId !== "glaz" &&
      this.world.figures.some((figure) => figure.id === figureId) &&
      !["dead", "gone", "broken", "led"].includes(fateOf(this.world, figureId))
    );
  }

  private revealedObjects(event: WorldMindEvent, task: NpcTask): string[] {
    // Use event-time scoped facts: nested scripts may already have moved the item
    // or closed its container by the time this complete transaction is delivered.
    const before = new Set(event.before.objects.map((object) => object.id));
    return event.after.objects
      .filter(
        (object) =>
          !before.has(object.id) &&
          !task.dependencies.objectIds.includes(object.id),
      )
      .map((object) => object.id);
  }

  private root(rootId: string): DecisionRoot {
    let root = this.roots.get(rootId);
    if (!root) {
      root = { rootId, count: 0, considered: {} };
      this.roots.set(rootId, root);
    }
    return root;
  }

  private priority(pending: PendingDecision): number {
    const room = this.world.figures.find(
      (figure) => figure.id === pending.figureId,
    )?.roomId;
    return (
      (pending.direct ? 10 : 0) +
      (room === this.world.currentRoomId ? 3 : 0) +
      Math.floor((this.elapsedSeconds - pending.queuedAt) / 2)
    );
  }

  private queue(
    figureId: string,
    cause: NpcDecisionCause,
    dependencies: NpcTaskDependencies,
    evidence: string,
    direct: boolean,
    preserveTask = false,
    currentTask?: NpcTask,
  ): void {
    if (!this.eligible(figureId)) return;
    const root = this.root(cause.rootId);
    if (root.count >= 2 || root.considered[figureId]?.includes(evidence))
      return;
    const active = this.active.get(figureId);
    const sleeping = this.dormant.get(figureId);
    if (active || sleeping) {
      const context = this.host.context(figureId);
      const guarded = active?.task ?? sleeping!;
      if (
        cause.kind !== "goal" &&
        cause.kind !== "discovery" &&
        cause.kind !== "blocked" &&
        (active ||
          sleeping?.status === "blocked" ||
          !hasNewDependencies(dependencies, guarded.dependencies)) &&
        npcDependencyFingerprint(context.world, guarded.dependencies) ===
          guarded.contextKey
      )
        return;
      if (
        active &&
        !preserveTask &&
        (cause.kind !== "discovery" ||
          npcDependencyFingerprint(context.world, active.task.dependencies) !==
            active.task.contextKey)
      )
        this.cancelTask(figureId, "dependency changed");
      this.dormant.delete(figureId);
    }
    const key = pendingKey(figureId, cause.rootId);
    const existing = this.pending.get(key);
    if (existing) {
      existing.cause.evidenceIds = [
        ...new Set([
          ...(existing.cause.evidenceIds ?? []),
          ...(cause.evidenceIds ?? []),
        ]),
      ];
      existing.dependencies = mergeDependencies(
        existing.dependencies,
        dependencies,
      );
      existing.evidenceKey = evidence;
      existing.direct ||= direct;
      if (currentTask) {
        existing.currentTask = structuredClone(currentTask);
        existing.cause.kind = "blocked";
        existing.goalId = this.goals.get(figureId)?.goal.goalId;
      }
      // Bounded debounce: continuous input cannot postpone this event indefinitely.
      existing.readyAt = Math.min(
        this.elapsedSeconds + 0.3,
        existing.queuedAt + 0.6,
      );
    } else if (this.pending.size < NPC_AUTONOMY_LIMITS.maxPending) {
      this.pending.set(key, {
        figureId,
        cause: structuredClone(cause),
        dependencies: structuredClone(dependencies),
        evidenceKey: evidence,
        direct,
        queuedAt: this.elapsedSeconds,
        // A director goal is already composed; only physical event bursts debounce.
        readyAt:
          this.elapsedSeconds +
          (cause.kind === "goal" ? 0 : NPC_AUTONOMY_LIMITS.coalesceSeconds),
        ...(currentTask
          ? {
              currentTask: structuredClone(currentTask),
              goalId: this.goals.get(figureId)?.goal.goalId,
            }
          : {}),
      });
    }
    this.changed();
  }

  private async decide(pending: PendingDecision): Promise<void> {
    const context = this.host.context(pending.figureId);
    const goal = this.goals.get(pending.figureId)?.goal;
    const payload: NpcDecisionRequest = {
      ...context,
      requestId: crypto.randomUUID(),
      figureId: pending.figureId,
      cause: pending.cause,
      ...(goal ? { goal } : {}),
      ...(pending.currentTask ? { currentTask: pending.currentTask } : {}),
    };
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const root = this.root(pending.cause.rootId);
    root.count++;
    (root.considered[pending.figureId] ??= []).push(pending.evidenceKey);
    this.totals.decisions++;
    const startedAt = performance.now();
    this.changed();
    try {
      const result = await (this.host.request ?? requestNpcDecision)(
        payload,
        controller.signal,
      );
      if (generation !== this.generation || controller.signal.aborted) return;
      if (
        !isDecisionResult(result) ||
        result.requestId !== payload.requestId ||
        result.dependencies.figureId !== payload.figureId
      )
        throw new Error("Mismatched NPC decision response");
      const diagnostics = {
        ...result.diagnostics,
        latencyMs:
          result.diagnostics?.latencyMs ?? performance.now() - startedAt,
      };
      for (const key of ["inputTokens", "outputTokens", "costUsd"] as const)
        if (finite(diagnostics[key])) this.totals[key] += diagnostics[key];
      const current = this.host.context(pending.figureId);
      const currentGoal = this.goals.get(pending.figureId)?.goal;
      const guardedResponse =
        result.status === "selected" || result.status === "wait";
      const stale =
        current.runId !== payload.runId ||
        current.cycleNumber !== payload.cycleNumber ||
        currentGoal?.goalId !== payload.goal?.goalId ||
        !this.eligible(pending.figureId) ||
        (guardedResponse &&
          npcDependencyFingerprint(current.world, result.dependencies) !==
            result.contextKey);
      if (stale) {
        this.log({
          figureId: pending.figureId,
          rootId: pending.cause.rootId,
          status: "stale",
          source: "jev",
          ...diagnostics,
        });
        return;
      }
      this.log({
        figureId: pending.figureId,
        rootId: pending.cause.rootId,
        status: result.status,
        source: "jev",
        taskId: result.task?.id,
        task: result.task?.summary,
        ...diagnostics,
      });
      if (result.status === "selected") {
        const task = result.task!;
        if (
          task.figureId !== payload.figureId ||
          task.dependencies.figureId !== payload.figureId ||
          task.cause.rootId !== payload.cause.rootId ||
          task.contextKey !==
            npcDependencyFingerprint(current.world, task.dependencies)
        )
          throw new Error("Mismatched NPC task");
        this.dormant.delete(pending.figureId);
        this.install({
          task: structuredClone(task),
          ...(goal ? { goalId: goal.goalId } : {}),
          expiresAt: Math.min(
            this.elapsedSeconds +
              Math.min(
                task.lifetimeSeconds,
                NPC_AUTONOMY_LIMITS.lifetimeSeconds,
              ),
            this.goals.get(task.figureId)?.expiresAt ?? Infinity,
          ),
          queuedAt: pending.queuedAt,
          startedAt: null,
        });
      } else {
        const dependencies = result.contextKey
          ? result.dependencies
          : pending.dependencies;
        this.dormant.set(pending.figureId, {
          figureId: pending.figureId,
          cause: pending.cause,
          status: result.status,
          dependencies,
          contextKey:
            result.contextKey ||
            npcDependencyFingerprint(current.world, dependencies),
          reason: result.diagnostics?.reason,
        });
      }
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const reason =
        error instanceof Error ? error.message : "NPC decision unavailable";
      this.dormant.set(pending.figureId, {
        figureId: pending.figureId,
        cause: pending.cause,
        status: "unavailable",
        dependencies: pending.dependencies,
        contextKey: npcDependencyFingerprint(
          context.world,
          pending.dependencies,
        ),
        reason,
      });
      this.log({
        figureId: pending.figureId,
        rootId: pending.cause.rootId,
        status: "unavailable",
        source: "jev",
        reason,
        latencyMs: performance.now() - startedAt,
      });
    } finally {
      if (generation === this.generation && this.controller === controller)
        this.controller = null;
      this.changed();
    }
  }

  private install(job: ActiveTask): void {
    const task = job.task;
    this.active.set(task.figureId, job);
    const accepted = this.host.coordinator.tryEnqueue(
      task.figureId,
      { kind: "jev", id: task.id },
      task.actions,
      {
        cause: { rootId: task.cause.rootId, taskId: task.id },
        lifetimeSeconds: Math.max(0, job.expiresAt - this.elapsedSeconds),
        beforeAction: () => this.beforeAction(job),
        afterAction: (envelope, result) => {
          const remaining =
            this.host.coordinator.remaining(task.figureId, {
              kind: "jev",
              id: task.id,
            }) ?? [];
          // The queue has removed its attempted head already. Keep a refused head
          // so reconsideration cannot replay the successful prefix or choose it again.
          task.actions = result.ok
            ? remaining
            : [structuredClone(envelope.action), ...remaining];
          if (!result.ok) return;
          // Expected prefix effects change the guard; they do not cause another inference.
          task.contextKey = this.liveFingerprint(task.dependencies);
          this.changed();
        },
        onComplete: (outcome) => this.finished(job, outcome),
      },
    );
    if (!accepted) {
      this.active.delete(task.figureId);
      this.sleepTask(job, "blocked", "higher priority task");
    }
    this.changed();
  }

  private beforeAction(job: ActiveTask): boolean | string {
    const task = job.task;
    if (!this.eligible(task.figureId)) return "actor unavailable";
    if (job.goalId && this.goals.get(task.figureId)?.goal.goalId !== job.goalId)
      return "goal expired";
    if (job.expiresAt <= this.elapsedSeconds) return "expired";
    if (this.liveFingerprint(task.dependencies) !== task.contextKey)
      return "dependency changed";
    if (job.startedAt === null) {
      job.startedAt = this.elapsedSeconds;
      const entry = [...this.records]
        .reverse()
        .find((row) => row.taskId === task.id);
      if (entry)
        entry.startLatencyMs = Math.round(
          (this.elapsedSeconds - job.queuedAt) * 1000,
        );
    }
    return true;
  }

  private finished(job: ActiveTask, outcome: ReplayOutcome): void {
    if (this.active.get(job.task.figureId) !== job) return;
    this.active.delete(job.task.figureId);
    const reason = outcome.refusal ?? undefined;
    const status = outcome.ok
      ? "completed"
      : reason === "expired" || reason === "goal expired"
        ? "expired"
        : intentionalCancellation(reason)
          ? "cancelled"
          : "blocked";
    this.log({
      figureId: job.task.figureId,
      rootId: job.task.cause.rootId,
      taskId: job.task.id,
      task: job.task.summary,
      source: "jev",
      status,
      reason,
      completionMs: Math.round((this.elapsedSeconds - job.queuedAt) * 1000),
    });
    if (status === "blocked") {
      this.sleepTask(job, "blocked", reason);
      // A new physical refusal is a fact worth considering once. Guard invalidation
      // is handled by its external event, and administrative cancellation is silent.
      if (reason !== "dependency changed" && reason !== "the situation changed")
        this.reconsiderBlocked(job, reason ?? "action refused");
    }
    // Completion never creates another decision; a blocked decision sleeps afterward.
  }

  private reconsiderBlocked(job: ActiveTask, reason: string): void {
    const task = job.task;
    if (!this.eligible(task.figureId) || !task.actions.length) return;
    const contextKey = this.liveFingerprint(task.dependencies);
    const currentTask: NpcTask = {
      ...structuredClone(task),
      contextKey,
      summary: `Не удалось: ${task.summary}. Отказ движка: ${reason}.`.slice(
        0,
        800,
      ),
    };
    this.queue(
      task.figureId,
      {
        rootId: task.cause.rootId,
        kind: "blocked",
        evidenceIds: [task.id, contextKey],
      },
      task.dependencies,
      JSON.stringify({ taskId: task.id, contextKey, reason }),
      true,
      false,
      currentTask,
    );
  }

  private sleepTask(job: ActiveTask, status: "blocked", reason?: string): void {
    const task = job.task;
    this.dormant.set(task.figureId, {
      figureId: task.figureId,
      cause: task.cause,
      status,
      dependencies: structuredClone(task.dependencies),
      contextKey: npcDependencyFingerprint(
        this.host.context(task.figureId).world,
        task.dependencies,
      ),
      reason,
    });
    this.changed();
  }

  private cancelTask(figureId: string, reason: string): void {
    const job = this.active.get(figureId);
    if (job)
      this.host.coordinator.cancel(
        figureId,
        { kind: "jev", id: job.task.id },
        reason,
      );
    this.active.delete(figureId);
  }

  private removeGoal(figureId: string): void {
    const goal = this.goals.get(figureId)?.goal;
    if (!goal) return;
    this.goals.delete(figureId);
    for (const [key, pending] of this.pending)
      if (
        pending.figureId === figureId &&
        (pending.cause.kind === "goal" || pending.goalId === goal.goalId)
      )
        this.pending.delete(key);
    const job = this.active.get(figureId);
    if (job?.goalId === goal.goalId) this.cancelTask(figureId, "goal expired");
    this.changed();
  }

  /** Per-frame guards read only their dependencies, never clone the complete world. */
  private liveFingerprint(dependencies: NpcTaskDependencies): string {
    const actors = new Set([dependencies.figureId, ...dependencies.actorIds]);
    const figures = [...actors].flatMap((id) => {
      if (id === "player") return [];
      const figure = this.world.figures.find((entry) => entry.id === id);
      const hiddenFate =
        dependencies.figureId !== "glaz" && RETURNS_WHOLE.has(id);
      const fate = hiddenFate ? undefined : this.world.fates.get(id);
      if (!figure && !fate) return [];
      return [
        {
          id,
          roomId: figure?.roomId ?? fate!.roomId,
          fate: fate?.fate ?? ("present" as const),
        },
      ];
    });
    const objects = dependencies.objectIds.flatMap((id) => {
      const object = this.world.objectById.get(id);
      return object ? [object] : [];
    });
    const doors = dependencies.doorIds.flatMap((id) => {
      const door = this.guardWorld.getDoor(id);
      return door ? [door] : [];
    });
    return npcDependencyFingerprint(
      { objects, doors, figures, player: { roomId: this.world.currentRoomId } },
      dependencies,
    );
  }

  private log(entry: NpcAutonomyRecord): void {
    this.records.push(entry);
    if (this.records.length > NPC_AUTONOMY_LIMITS.maxRecords)
      this.records.shift();
    this.changed();
  }

  private changed(): void {
    this.host.onChange?.();
  }
}
