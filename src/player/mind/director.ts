/** Background composition, foreground physical truth. Network latency never pauses play. */
import {
  DIRECTOR_LIMITS,
  npcGuidanceSchema,
  type ActiveNpcGuidance,
  directorPlanSchema,
  directorSituationSchema,
  type ActiveDirectorSituation,
  type DirectorContext,
  type DirectorGuard,
  type DirectorPlan,
  type DirectorRequest,
  type DirectorReceipt,
  type DirectorSnapshot,
  type DirectorSituation,
  type DirectorStep,
} from "../../shared/director";
import type { WorldSnapshotObject } from "../../shared/ai";
import type { ActorPose, ActorRef } from "../../shared/world-object";
import type {
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
} from "../../shared/world-action";
import type { WorldMindEvent } from "../../shared/world-mind";
import { canObserveWorldPose } from "../../shared/world-mind";
import { perceivedPlayerIdentity } from "../../shared/social-roles";
import { planNpcRoute } from "../game/npc-action-queue";
import {
  NpcTaskCoordinator,
  type NpcTaskOwner,
} from "../game/npc-task-coordinator";
import {
  applyPatch,
  patchTouches,
  type MapPatch,
  type PatchResult,
} from "../game/patch";
import type { WorldState } from "../game/world";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import { scopeIsOnScreen, type ViewportSource } from "./heartbeat";

export interface DirectorHost {
  context(): DirectorContext;
  playerPose(): ActorPose;
  viewport: ViewportSource;
  trySpendCall(): boolean;
  execute(envelope: WorldActionEnvelope): WorldActionResult;
  onPatch?(patch: MapPatch, result: PatchResult): void;
  onSpeech?(figureId: string, text: string): void;
  onChange?(): void;
  onGuidanceChange?(guidance: readonly ActiveNpcGuidance[]): void;
  request?(
    payload: DirectorRequest,
    signal: AbortSignal,
  ): Promise<DirectorPlan>;
}

export interface WorldDirectorOptions {
  coordinator?: NpcTaskCoordinator;
  eventDriven?: boolean | (() => boolean);
}

export interface DirectorTickOptions {
  paused?: boolean;
  foregroundBusy?: boolean;
  presentationHeld?: boolean;
}

/** Independent NDJSON transport: it never touches RemoteMind's waiting/controller. */
export async function requestDirector(
  payload: DirectorRequest,
  signal: AbortSignal,
): Promise<DirectorPlan> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  const response = await fetch("/api/ai/director", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: combined,
  });
  if (!response.ok || !response.body) throw new Error("Director unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      total += value?.byteLength ?? 0;
      if (total > 256_000) throw new Error("Director response too large");
      const lines = pending.split("\n");
      pending = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "result")
          return directorPlanSchema.parse(event.value);
        if (event.type === "error") throw new Error("Director unavailable");
      }
      if (done) break;
    }
    throw new Error("Director returned no plan");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function sameActor(left: unknown, right: ActorRef): boolean {
  if (!left || typeof left !== "object") return false;
  const candidate = left as ActorRef;
  return (
    candidate.kind === right.kind &&
    (right.kind === "player" ||
      (candidate.kind === "figure" && candidate.id === right.id))
  );
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

/** Include containing objects: moving a bag also changes the context of its contents. */
function referencedObjectIds(
  situation: DirectorSituation,
  objects: ReadonlyMap<string, WorldSnapshotObject>,
): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || ids.has(id)) return;
    const object = objects.get(id);
    if (!object) return; // An open/close target can also be a doorway.
    ids.add(id);
    if (object.location.kind === "inside") add(object.location.objectId);
  };
  for (const step of situation.steps) {
    for (const guard of step.guards)
      if ("objectId" in guard) add(guard.objectId);
    if (step.effect.kind !== "npc") continue;
    for (const action of step.effect.actions) {
      if ("objectId" in action) add(action.objectId);
      if ("targetId" in action) add(action.targetId);
      if ("intoObjectId" in action) add(action.intoObjectId);
    }
  }
  return ids;
}

function receiptMatches(
  receipt: WorldMindEvent,
  guard: Extract<DirectorGuard, { kind: "receipt" }>,
  afterSequence: number,
): boolean {
  const action = receipt.action;
  const targetMatches =
    !guard.objectId ||
    (!!action &&
      (("objectId" in action && action.objectId === guard.objectId) ||
        ("targetId" in action && action.targetId === guard.objectId) ||
        ("intoObjectId" in action && action.intoObjectId === guard.objectId)));
  return (
    receipt.sequence >= afterSequence &&
    receipt.actionType === guard.actionType &&
    sameActor(receipt.actor, guard.actor) &&
    (!guard.witnessId || receipt.witnessIds.includes(guard.witnessId)) &&
    targetMatches
  );
}

/** Closed predicate vocabulary; no strings are evaluated as code or instructions. */
export function directorGuardHolds(
  world: WorldState,
  guard: DirectorGuard,
  afterSequence: number,
): boolean {
  switch (guard.kind) {
    case "actorRoom": {
      const actor = guard.actor;
      return actor.kind === "player"
        ? world.currentRoomId === guard.roomId
        : world.figures.some(
            (figure) =>
              figure.id === actor.id && figure.roomId === guard.roomId,
          );
    }
    case "objectState":
      return (
        world.objectById.get(guard.objectId)?.state[guard.field] === guard.value
      );
    case "heldBy": {
      const location = world.objectById.get(guard.objectId)?.location;
      return (
        location?.kind === "held" && sameActor(location.actor, guard.actor)
      );
    }
    case "wearing":
      return sameActor(
        world.objectById.get(guard.objectId)?.state.wornBy,
        guard.actor,
      );
    case "occupying":
      return sameActor(
        world.objectById.get(guard.objectId)?.state.occupancy?.actor,
        guard.actor,
      );
    case "role":
      return world.objects.some(
        (object) =>
          sameActor(object.state.wornBy, guard.actor) &&
          object.profile?.wear?.appearanceFigureId === guard.appearanceFigureId,
      );
    case "acceptedRole": {
      const perception = perceivedPlayerIdentity(
        { objects: world.objects, roleRecognition: world.roleRecognition },
        guard.figureId,
      );
      return (
        perception.roleId === guard.roleId && perception.recognition === "role"
      );
    }
    case "roomVisits":
      return (world.visitCounts.get(guard.roomId) ?? 0) >= guard.atLeast;
    case "receipt":
      return world.worldMind.events.some((receipt) =>
        receiptMatches(receipt, guard, afterSequence),
      );
  }
}

export class WorldDirector {
  readonly npcQueue: NpcTaskCoordinator;
  private guidance: ActiveNpcGuidance[] = [];
  private seenGuidanceIds: Array<{ figureId: string; goalId: string }> = [];
  private elapsedSeconds = 0;
  private lastCallAt: number | null = null;
  private lastProgressAt = 0;
  private pendingSince: number | null = null;
  private signals: string[] = [];
  private active: ActiveDirectorSituation[] = [];
  private completedIds: string[] = [];
  private receipts: DirectorReceipt[] = [];
  private controller: AbortController | null = null;
  private inflightSignals: string[] = [];
  private generation = 0;
  private failures = 0;

  constructor(
    private readonly world: WorldState,
    private readonly host: DirectorHost,
    private readonly options: WorldDirectorOptions = {},
  ) {
    this.npcQueue =
      options.coordinator ??
      new NpcTaskCoordinator(world, (envelope) => host.execute(envelope));
  }

  get activeGuidance(): readonly ActiveNpcGuidance[] {
    return structuredClone(this.guidance);
  }

  private get eventDriven(): boolean {
    return typeof this.options.eventDriven === "function"
      ? this.options.eventDriven()
      : (this.options.eventDriven ?? false);
  }

  private taskOwner(situation: ActiveDirectorSituation): NpcTaskOwner {
    return { kind: "director", id: `${situation.plan.id}:${situation.step}` };
  }

  get waiting(): boolean {
    return this.controller !== null;
  }
  get failureCount(): number {
    return this.failures;
  }
  get activeSituations(): readonly ActiveDirectorSituation[] {
    return this.active;
  }

  noteEvent(event: WorldMindEvent): void {
    for (const situation of this.active)
      situation.plan.steps.forEach((step, stepIndex) =>
        step.guards.forEach((guard, guardIndex) => {
          if (
            guard.kind !== "receipt" ||
            !receiptMatches(event, guard, situation.afterSequence)
          )
            return;
          const key = `${stepIndex}:${guardIndex}`;
          const seen = (situation.seenReceiptGuards ??= []);
          if (!seen.includes(key)) seen.push(key);
        }),
      );
    // Director-generated actions cannot recursively manufacture demand for more noise.
    if (event.source !== "player" || event.actionType === "moveTo") return;
    this.noteProgress(
      `${event.actionType ?? "action"}: ${event.after.objects
        .map((object) => object.name)
        .slice(0, 3)
        .join(", ")}`,
    );
  }

  noteProgress(reason: string): void {
    this.lastProgressAt = this.elapsedSeconds;
    this.addSignal(reason);
  }

  private addSignal(reason: string): void {
    const text = reason.trim().slice(0, 320);
    if (!text) return;
    if (!this.signals.includes(text)) this.signals.push(text);
    this.signals = this.signals.slice(-24);
    // Bound coalescing from the first event; continuous play cannot starve the request.
    this.pendingSince ??= this.elapsedSeconds;
  }

  cancelRequest(): void {
    this.generation++;
    if (this.controller)
      for (const signal of this.inflightSignals) this.addSignal(signal);
    this.inflightSignals = [];
    this.controller?.abort();
    this.controller = null;
  }

  tick(deltaSeconds: number, options: DirectorTickOptions = {}): void {
    if (options.foregroundBusy) this.cancelRequest();
    if (options.paused || options.foregroundBusy || options.presentationHeld)
      return;
    const delta = Math.max(
      0,
      Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.1),
    );
    this.elapsedSeconds += delta;
    for (const situation of [...this.active]) {
      if (
        this.elapsedSeconds - situation.acceptedAt >=
        situation.plan.lifetimeSeconds
      )
        this.finish(situation, "expired");
      else if (situation.remainingActions && !this.guardsHold(situation))
        this.finish(situation, "the situation changed");
    }
    const beforeExpiry = this.guidance.length;
    this.guidance = this.guidance.filter(
      (entry) => this.elapsedSeconds - entry.acceptedAt < entry.lifetimeSeconds,
    );
    if (beforeExpiry !== this.guidance.length) {
      this.host.onGuidanceChange?.(this.activeGuidance);
      this.host.onChange?.();
    }
    if (!this.options.coordinator) this.npcQueue.tick(delta);
    for (const situation of [...this.active]) this.advance(situation);
    if (this.controller || this.active.length >= DIRECTOR_LIMITS.maxSituations)
      return;
    if (
      this.lastCallAt !== null &&
      this.elapsedSeconds - this.lastCallAt < DIRECTOR_LIMITS.minCallSeconds
    )
      return;
    const idle =
      !this.eventDriven &&
      this.active.length === 0 &&
      this.elapsedSeconds -
        Math.max(this.lastProgressAt, this.lastCallAt ?? 0) >=
        DIRECTOR_LIMITS.idleSeconds;
    const pending =
      this.pendingSince !== null &&
      this.elapsedSeconds - this.pendingSince >=
        DIRECTOR_LIMITS.coalesceSeconds;
    if (!idle && !pending) return;
    if (!this.host.trySpendCall()) return;
    if (idle)
      this.addSignal(
        "No meaningful progress for a minute; offer one local opportunity with breathing room.",
      );
    void this.compose();
  }

  private async compose(): Promise<void> {
    const context = this.host.context();
    // Snapshot projections may share nested state; serialize before the await so a
    // live mutation cannot silently rewrite what the model was actually shown.
    const requestedObjects = new Map(
      context.world.objects.map((object) => [
        object.id,
        structuredClone(object),
      ]),
    );
    const requestedFacts = new Map(
      [...requestedObjects].map(([id, object]) => [id, JSON.stringify(object)]),
    );
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.lastCallAt = this.elapsedSeconds;
    const signals = this.signals;
    this.inflightSignals = [...signals];
    this.signals = [];
    this.pendingSince = null;
    const payload: DirectorRequest = {
      ...context,
      slug: this.world.artifact.slug,
      elapsedSeconds: this.elapsedSeconds,
      signals,
      activeSituations: this.active.map((entry) => ({
        id: entry.proposalId ?? entry.plan.id,
        goal: entry.plan.goal,
        step: entry.step,
      })),
      recentReceipts: structuredClone(this.receipts.slice(-12)),
      activeNpcGuidance: this.activeGuidance.map(
        ({ figureId, goalId, goal, lifetimeSeconds }) => ({
          figureId,
          goalId,
          goal,
          lifetimeSeconds,
        }),
      ),
    };
    try {
      const result = await (this.host.request ?? requestDirector)(
        payload,
        controller.signal,
      );
      if (controller.signal.aborted || generation !== this.generation) return;
      const current = this.host.context();
      if (
        current.runId !== context.runId ||
        current.cycleNumber !== context.cycleNumber
      )
        return;
      const plan = directorPlanSchema.parse(result);
      this.acceptGuidance(plan.npcGuidance ?? []);
      const currentFacts = new Map(
        current.world.objects.map((object) => [
          object.id,
          JSON.stringify(object),
        ]),
      );
      for (const situation of plan.situations) {
        if (this.active.length >= DIRECTOR_LIMITS.maxSituations) break;
        if (
          [...referencedObjectIds(situation, requestedObjects)].some(
            (id) => requestedFacts.get(id) !== currentFacts.get(id),
          )
        ) {
          this.addSignal(
            `The physical context changed while planning: ${situation.goal}`,
          );
          continue;
        }
        if (
          this.active.some(
            (entry) => (entry.proposalId ?? entry.plan.id) === situation.id,
          )
        )
          continue;
        const instanceId = `${situation.id.slice(0, 100)}@${Math.round((this.lastCallAt ?? 0) * 1000).toString(36)}`;
        if (this.completedIds.includes(instanceId)) continue;
        this.active.push({
          plan: { ...structuredClone(situation), id: instanceId },
          proposalId: situation.id,
          step: 0,
          acceptedAt: this.elapsedSeconds,
          lastStepAt: this.elapsedSeconds,
          afterSequence: this.world.worldMind.nextSequence,
        });
      }
      this.host.onChange?.();
    } catch {
      if (!controller.signal.aborted && generation === this.generation)
        this.failures++;
      // Already accepted finite plans continue locally. Failure never fabricates an effect.
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.inflightSignals = [];
      }
    }
  }

  private advance(situation: ActiveDirectorSituation): void {
    if (!this.active.includes(situation)) return;
    if (
      this.elapsedSeconds - situation.acceptedAt >=
      situation.plan.lifetimeSeconds
    ) {
      this.finish(situation, "expired");
      return;
    }
    const step = situation.plan.steps[situation.step];
    if (!step) {
      this.finish(situation);
      return;
    }
    if (
      step.effect.kind === "npc" &&
      this.npcQueue.ownerOf(step.effect.figureId)?.kind === "director"
    )
      return;
    if (this.elapsedSeconds - situation.lastStepAt < step.afterSeconds) return;
    if (!this.guardsHold(situation)) return;
    if (step.effect.kind === "patch") {
      const patch = step.effect.patch as MapPatch;
      const view = this.host.viewport();
      if (
        patchTouches(patch, this.world).some((scope) =>
          scopeIsOnScreen(scope, view, this.world),
        )
      )
        return;
      const beforeRevision = this.world.revision;
      const result = applyPatch(
        this.world,
        patch,
        this.host.context().cycleNumber,
        { source: "sleeper" },
      );
      if (result.ok && this.world.revision === beforeRevision)
        this.world.revision++;
      this.host.onPatch?.(patch, result);
      if (!result.ok) {
        this.finish(situation, result.refusal ?? "patch refused");
        return;
      }
      this.next(situation);
      return;
    }
    const effect = step.effect;
    if (
      this.isLocalEffect(effect) &&
      this.active.some((other) => {
        if (other === situation || !other.remainingActions) return false;
        const otherEffect = other.plan.steps[other.step]?.effect;
        return (
          otherEffect?.kind === "npc" &&
          this.npcQueue.isBusy(otherEffect.figureId) &&
          this.isLocalEffect(otherEffect)
        );
      })
    )
      return;
    if (!this.world.figures.some((figure) => figure.id === effect.figureId)) {
      this.finish(situation, "actor is absent");
      return;
    }
    const route = effect.destination
      ? planNpcRoute(this.world, effect.figureId, effect.destination)
      : [];
    const actions =
      situation.remainingActions ??
      (route ? ([...route, ...effect.actions] as WorldAction[]) : null);
    if (!actions) {
      this.finish(situation, "no route");
      return;
    }
    situation.remainingActions = structuredClone(actions);
    const owner = this.taskOwner(situation);
    const context = this.host.context();
    this.npcQueue.tryEnqueue(effect.figureId, owner, actions, {
      cause: {
        rootId: `director:${context.runId}:${context.cycleNumber}:${situation.plan.id}`,
        taskId: owner.id,
      },
      lifetimeSeconds:
        situation.plan.lifetimeSeconds -
        (this.elapsedSeconds - situation.acceptedAt),
      beforeAction: () =>
        this.active.includes(situation) && this.guardsHold(situation)
          ? true
          : "the situation changed",
      afterAction: (_envelope, result) => {
        if (!result.ok) return;
        const consumed = (situation.consumedGuardIndices ??= []);
        step.guards.forEach((guard, index) => {
          if (
            !directorGuardHolds(this.world, guard, situation.afterSequence) &&
            !consumed.includes(index)
          )
            consumed.push(index);
        });
      },
      onComplete: (result) => {
        if (!this.active.includes(situation)) return;
        delete situation.remainingActions;
        if (!result.ok) {
          this.finish(situation, result.refusal ?? "action refused");
          return;
        }
        if (effect.reply) this.speak(effect.figureId, effect.reply);
        this.next(situation);
      },
    });
  }

  private acceptGuidance(
    entries: NonNullable<DirectorPlan["npcGuidance"]>,
  ): void {
    let changed = false;
    for (const entry of entries) {
      if (
        !this.world.figures.some((figure) => figure.id === entry.figureId) ||
        this.seenGuidanceIds.some(
          (seen) =>
            seen.figureId === entry.figureId && seen.goalId === entry.goalId,
        )
      )
        continue;
      this.seenGuidanceIds.push({
        figureId: entry.figureId,
        goalId: entry.goalId,
      });
      this.guidance = this.guidance.filter(
        (existing) => existing.figureId !== entry.figureId,
      );
      this.guidance.push({
        ...structuredClone(entry),
        acceptedAt: this.elapsedSeconds,
      });
      changed = true;
    }
    if (changed) this.host.onGuidanceChange?.(this.activeGuidance);
  }

  private isLocalEffect(
    effect: Extract<DirectorStep["effect"], { kind: "npc" }>,
  ): boolean {
    const roomId = this.world.currentRoomId;
    return (
      effect.destination?.roomId === roomId ||
      this.world.figures.some(
        (figure) => figure.id === effect.figureId && figure.roomId === roomId,
      )
    );
  }

  private speak(figureId: string, text: string): void {
    const figure = this.world.figures.find((entry) => entry.id === figureId);
    if (!figure) return;
    const pose = this.host.playerPose();
    const mutator = bindWorldMutator(this.world, staticPlayerPose(pose));
    if (
      canObserveWorldPose(mutator, pose, {
        roomId: figure.roomId,
        x: figure.x,
        y: figure.y,
      })
    )
      this.host.onSpeech?.(figureId, text);
  }

  private next(situation: ActiveDirectorSituation): void {
    this.record(situation, true);
    delete situation.consumedGuardIndices;
    situation.step++;
    situation.lastStepAt = this.elapsedSeconds;
    if (situation.step >= situation.plan.steps.length) this.finish(situation);
    this.host.onChange?.();
  }

  private finish(situation: ActiveDirectorSituation, refusal?: string): void {
    if (refusal) this.record(situation, false, refusal);
    this.active = this.active.filter((entry) => entry !== situation);
    const effect = situation.plan.steps[situation.step]?.effect;
    if (effect?.kind === "npc" && situation.remainingActions)
      this.npcQueue.cancel(effect.figureId, this.taskOwner(situation), refusal);
    if (!this.completedIds.includes(situation.plan.id))
      this.completedIds.push(situation.plan.id);
    this.completedIds = this.completedIds.slice(-64);
    if (refusal && refusal !== "expired")
      this.addSignal(
        `Consequence interrupted: ${situation.plan.goal}. ${refusal}`,
      );
    this.host.onChange?.();
  }

  private record(
    situation: ActiveDirectorSituation,
    ok: boolean,
    refusal?: string,
  ): void {
    const step = situation.plan.steps[situation.step];
    if (!step) return;
    this.receipts.push({
      situationId: situation.plan.id,
      stepId: step.id,
      at: this.elapsedSeconds,
      ok,
      effect: structuredClone(step.effect),
      ...(refusal ? { refusal } : {}),
    });
    this.receipts = this.receipts.slice(-32);
  }

  private guardsHold(situation: ActiveDirectorSituation): boolean {
    const step = situation.plan.steps[situation.step];
    return (
      !!step &&
      step.guards.every((guard, index) => {
        if (situation.consumedGuardIndices?.includes(index)) return true;
        const key = `${situation.step}:${index}`;
        if (
          guard.kind === "receipt" &&
          situation.seenReceiptGuards?.includes(key)
        )
          return true;
        const holds = directorGuardHolds(
          this.world,
          guard,
          situation.afterSequence,
        );
        if (holds && guard.kind === "receipt")
          (situation.seenReceiptGuards ??= []).push(key);
        return holds;
      })
    );
  }

  snapshot(): DirectorSnapshot {
    return structuredClone({
      version: 1,
      elapsedSeconds: this.elapsedSeconds,
      lastCallAt: this.lastCallAt,
      lastProgressAt: this.lastProgressAt,
      pendingSince: this.pendingSince,
      signals: this.signals,
      completedIds: this.completedIds,
      receipts: this.receipts,
      npcGuidance: this.guidance,
      seenGuidanceIds: this.seenGuidanceIds,
      active: this.active.map((entry) => {
        const effect = entry.plan.steps[entry.step]?.effect;
        const remaining =
          entry.remainingActions && effect?.kind === "npc"
            ? this.npcQueue.remaining(effect.figureId, this.taskOwner(entry))
            : null;
        return {
          ...entry,
          ...(remaining ? { remainingActions: remaining } : {}),
        };
      }),
    });
  }

  restore(value: unknown): void {
    this.resetCycle();
    if (!value || typeof value !== "object") return;
    const state = value as Partial<DirectorSnapshot>;
    if (state.version !== 1) return;
    this.elapsedSeconds = finite(state.elapsedSeconds, 0);
    this.lastCallAt =
      state.lastCallAt === null
        ? null
        : Math.min(this.elapsedSeconds, finite(state.lastCallAt, 0));
    this.lastProgressAt = Math.min(
      this.elapsedSeconds,
      finite(state.lastProgressAt, this.elapsedSeconds),
    );
    this.pendingSince =
      state.pendingSince === null
        ? null
        : Math.min(
            this.elapsedSeconds,
            finite(state.pendingSince, this.elapsedSeconds),
          );
    this.signals = Array.isArray(state.signals)
      ? state.signals
          .filter((entry): entry is string => typeof entry === "string")
          .slice(-24)
          .map((entry) => entry.slice(0, 320))
      : [];
    this.completedIds = Array.isArray(state.completedIds)
      ? state.completedIds
          .filter((entry): entry is string => typeof entry === "string")
          .slice(-64)
      : [];
    this.receipts = Array.isArray(state.receipts)
      ? state.receipts
          .filter(
            (entry) =>
              typeof entry?.situationId === "string" &&
              typeof entry.stepId === "string" &&
              Number.isFinite(entry.at) &&
              typeof entry.ok === "boolean" &&
              entry.effect &&
              typeof entry.effect === "object",
          )
          .slice(-32)
          .map((entry) => structuredClone(entry))
      : [];
    this.seenGuidanceIds = Array.isArray(state.seenGuidanceIds)
      ? state.seenGuidanceIds
          .filter(
            (entry) =>
              typeof entry?.figureId === "string" &&
              typeof entry?.goalId === "string",
          )
          .slice(-4096)
      : [];
    for (const entry of Array.isArray(state.npcGuidance)
      ? state.npcGuidance
      : []) {
      if (!entry || typeof entry !== "object") continue;
      const { acceptedAt: savedAcceptedAt, ...guidance } = entry;
      const parsed = npcGuidanceSchema.safeParse(guidance);
      if (
        !parsed.success ||
        !this.world.figures.some((figure) => figure.id === parsed.data.figureId)
      )
        continue;
      const acceptedAt = Math.min(
        this.elapsedSeconds,
        finite(savedAcceptedAt, this.elapsedSeconds),
      );
      if (this.elapsedSeconds - acceptedAt >= parsed.data.lifetimeSeconds)
        continue;
      if (
        this.guidance.some(
          (existing) => existing.figureId === parsed.data.figureId,
        )
      )
        continue;
      this.guidance.push({ ...parsed.data, acceptedAt });
      if (
        !this.seenGuidanceIds.some(
          (seen) =>
            seen.figureId === parsed.data.figureId &&
            seen.goalId === parsed.data.goalId,
        )
      )
        this.seenGuidanceIds.push({
          figureId: parsed.data.figureId,
          goalId: parsed.data.goalId,
        });
    }
    // Restored guidance is state, not a new decision trigger. The controller restores its own deduplication state.
    for (const entry of Array.isArray(state.active)
      ? state.active.slice(0, DIRECTOR_LIMITS.maxSituations)
      : []) {
      const parsed = directorSituationSchema.safeParse(entry.plan);
      if (
        !parsed.success ||
        !Number.isInteger(entry.step) ||
        entry.step < 0 ||
        entry.step >= parsed.data.steps.length ||
        this.completedIds.includes(parsed.data.id)
      )
        continue;
      this.active.push({
        plan: parsed.data,
        ...(typeof entry.proposalId === "string"
          ? { proposalId: entry.proposalId.slice(0, 120) }
          : {}),
        step: entry.step,
        acceptedAt: Math.min(
          this.elapsedSeconds,
          finite(entry.acceptedAt, this.elapsedSeconds),
        ),
        lastStepAt: Math.min(
          this.elapsedSeconds,
          finite(entry.lastStepAt, this.elapsedSeconds),
        ),
        afterSequence: finite(
          entry.afterSequence,
          this.world.worldMind.nextSequence,
        ),
        ...(Array.isArray(entry.consumedGuardIndices)
          ? {
              consumedGuardIndices: entry.consumedGuardIndices.filter(
                (index) =>
                  Number.isInteger(index) &&
                  index >= 0 &&
                  index < parsed.data.steps[entry.step]!.guards.length,
              ),
            }
          : {}),
        ...(Array.isArray(entry.seenReceiptGuards)
          ? {
              seenReceiptGuards: entry.seenReceiptGuards
                .filter(
                  (key) => typeof key === "string" && /^\d+:\d+$/.test(key),
                )
                .slice(0, 64),
            }
          : {}),
        ...(Array.isArray(entry.remainingActions)
          ? {
              remainingActions: structuredClone(
                entry.remainingActions.slice(
                  0,
                  this.world.rooms.length * 2 + DIRECTOR_LIMITS.maxActions,
                ),
              ),
            }
          : {}),
      });
    }
  }

  resetCycle(): void {
    this.cancelRequest();
    this.active = [];
    this.npcQueue.cancelOwner("director");
    this.guidance = [];
    this.seenGuidanceIds = [];
    this.elapsedSeconds = 0;
    this.lastCallAt = null;
    this.lastProgressAt = 0;
    this.pendingSince = null;
    this.signals = [];
    this.completedIds = [];
    this.receipts = [];
  }
}
