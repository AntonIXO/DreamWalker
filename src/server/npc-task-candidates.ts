/** Build executable choices in a sandbox; Jev may only select their opaque ids. */
import type { WorldSnapshot } from "../shared/ai";
import { EpisodicMemory } from "../shared/episodic-memory";
import {
  npcDependencyFingerprint,
  type NpcDecisionRequest,
  type NpcTask,
  type NpcTaskDependencies,
} from "../shared/npc-decision";
import type { WorldAction } from "../shared/world-action";
import {
  availableActions,
  executeWorldAction,
  planApproach,
} from "../shared/world-action-engine";
import { worldMindForFigure } from "../shared/world-mind";
import type {
  ActorRef,
  WorldObjectPhysicalState,
} from "../shared/world-object";
import { sandboxFromSnapshot, SnapshotSandbox } from "../shared/world-sandbox";
import { dialogueWorldContext } from "./dialogue-messages";

export interface NpcTaskCandidate {
  id: string;
  description: string;
  task: NpcTask | null;
}

export interface NpcCandidateOptions {
  pinnedRoomId?: string | null;
  /** Server-owned character agenda; never inferred from the global room catalog. */
  agendaRoomIds?: string[];
}

const MAX_CANDIDATES = 32;
const MAX_TASK_ACTIONS = 32;

function observedState(
  state: Omit<WorldObjectPhysicalState, "occupancy"> & {
    occupancy?: Pick<
      NonNullable<WorldObjectPhysicalState["occupancy"]>,
      "actor" | "pose"
    > | null;
  },
) {
  const { occupancy, ...physical } = state;
  return {
    ...physical,
    ...(occupancy && state.open !== false && occupancy.pose !== "hidden"
      ? { occupancy: { actor: occupancy.actor, pose: occupancy.pose } }
      : {}),
  };
}

function objectDependencies(
  world: WorldSnapshot,
  figureId: string,
  actions: readonly WorldAction[],
): NpcTaskDependencies {
  const objects = new Set<string>();
  const doors = new Set<string>();
  const actors = new Set<string>();
  const doorIds = new Set(world.doors.map((door) => door.id));
  const include = (id: string) =>
    doorIds.has(id) ? doors.add(id) : objects.add(id);
  for (const action of actions) {
    if ("objectId" in action && action.objectId) include(action.objectId);
    if ("targetId" in action && action.targetId) include(action.targetId);
    if ("intoObjectId" in action) include(action.intoObjectId);
    if ("doorId" in action) doors.add(action.doorId);
    if (action.type === "give")
      actors.add(action.to.kind === "player" ? "player" : action.to.id);
  }
  // The containing object's lock/open state and holder are real prerequisites.
  for (const id of objects) {
    const object = world.objects.find((entry) => entry.id === id);
    if (object?.location.kind === "inside")
      objects.add(object.location.objectId);
    if (object?.location.kind === "held")
      actors.add(
        object.location.actor.kind === "player"
          ? "player"
          : object.location.actor.id,
      );
    if (object?.state.attachedTo) objects.add(object.state.attachedTo);
  }
  for (const object of world.objects) {
    if (
      object.state.occupancy?.actor.kind === "figure" &&
      object.state.occupancy.actor.id === figureId
    )
      objects.add(object.id);
    if (
      object.location.kind === "held" &&
      object.location.actor.kind === "figure" &&
      object.location.actor.id === figureId &&
      object.keyId
    )
      objects.add(object.id);
  }
  return {
    figureId,
    objectIds: [...objects],
    doorIds: [...doors],
    actorIds: [...actors],
  };
}

/** The planner owns a disposable world, so every prefix is physically validated. */
class TaskPlan {
  readonly world: SnapshotSandbox;
  readonly actions: WorldAction[] = [];
  readonly actor: { kind: "figure"; id: string };

  constructor(snapshot: WorldSnapshot | SnapshotSandbox, figureId: string) {
    this.world =
      snapshot instanceof SnapshotSandbox
        ? snapshot
        : sandboxFromSnapshot(snapshot);
    this.actor = { kind: "figure", id: figureId };
  }

  clone(): TaskPlan {
    const clone = new TaskPlan(this.world.clone(), this.actor.id);
    clone.actions.push(...this.actions);
    return clone;
  }

  act(action: WorldAction): boolean {
    if (this.actions.length >= MAX_TASK_ACTIONS) return false;
    const result = executeWorldAction(this.world, {
      actor: this.actor,
      source: "npc",
      action,
    });
    if (!result.ok) return false;
    this.actions.push(action);
    return true;
  }

  leave(): boolean {
    const occupied = this.world.objects.some(
      (object) =>
        object.state.occupancy?.actor.kind === "figure" &&
        object.state.occupancy.actor.id === this.actor.id,
    );
    return !occupied || this.act({ type: "leave" });
  }

  approach(objectId: string): boolean {
    let object = this.world.objectById.get(objectId);
    const seen = new Set<string>();
    while (object?.location.kind === "inside" && !seen.has(object.id)) {
      seen.add(object.id);
      object = this.world.objectById.get(object.location.objectId);
    }
    if (!object || !this.leave()) return false;
    const path = planApproach(this.world, this.actor, object.id);
    if (path.refusal) return false;
    const destination = path.path.at(-1);
    return !destination || this.act({ type: "moveTo", ...destination });
  }

  acquire(objectId: string): boolean {
    const object = this.world.objectById.get(objectId);
    if (!object) return false;
    if (object.location.kind === "held")
      return (
        object.location.actor.kind === "figure" &&
        object.location.actor.id === this.actor.id
      );
    if (!this.approach(objectId)) return false;
    if (object.state.attachedTo && !this.act({ type: "detach", objectId }))
      return false;
    return this.act({ type: "take", objectId });
  }

  moveNear(roomId: string, x: number, y: number): boolean {
    if (!this.leave()) return false;
    const pose = this.world.getFigurePose(this.actor.id);
    if (!pose || pose.roomId !== roomId) return false;
    const points: Array<{ x: number; y: number }> = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const point = { x: Math.round(x) + dx, y: Math.round(y) + dy };
        if (
          this.world.canWalk(roomId, point.x, point.y) &&
          this.world.hasPath(roomId, pose, point)
        )
          points.push(point);
      }
    points.sort(
      (a, b) =>
        Math.hypot(a.x - pose.x, a.y - pose.y) -
        Math.hypot(b.x - pose.x, b.y - pose.y),
    );
    return !!points[0] && this.act({ type: "moveTo", roomId, ...points[0] });
  }

  traverse(doorId: string): boolean {
    const door = this.world.getDoor(doorId);
    return (
      !!door &&
      this.moveNear(door.fromRoomId, door.x, door.y) &&
      this.act({ type: "traverseDoor", doorId })
    );
  }
}

function routeTo(
  plan: TaskPlan,
  snapshot: WorldSnapshot,
  roomId: string,
  knownDoorIds: ReadonlySet<string>,
): boolean {
  const pose = plan.world.getFigurePose(plan.actor.id);
  if (!pose) return false;
  if (pose.roomId === roomId) return true;
  const poseKey = (at: { roomId: string; x: number; y: number }) =>
    `${at.roomId}:${at.x}:${at.y}`;
  const queue = [{ roomId: pose.roomId, hops: 0, plan }];
  const visited = new Set([poseKey(pose)]);
  const baseActionCount = plan.actions.length;
  while (queue.length) {
    const current = queue.shift()!;
    if (current.hops >= 6) continue;
    for (const door of snapshot.doors) {
      if (
        door.hidden ||
        !knownDoorIds.has(door.id) ||
        door.fromRoomId !== current.roomId
      )
        continue;
      // A rejected edge must not poison another entrance to the same room.
      const next = current.plan.clone();
      if (!next.traverse(door.id)) continue;
      const arrival = next.world.getFigurePose(next.actor.id);
      if (!arrival) continue;
      if (arrival.roomId === roomId)
        return next.actions
          .slice(baseActionCount)
          .every((action) => plan.act(action));
      const key = poseKey(arrival);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({
        roomId: arrival.roomId,
        hops: current.hops + 1,
        plan: next,
      });
    }
  }
  return false;
}

export function buildNpcTaskCandidates(
  request: NpcDecisionRequest,
  options: NpcCandidateOptions = {},
) {
  const { world, figureId } = request;
  const figure = world.figures.find((entry) => entry.id === figureId);
  const scene = dialogueWorldContext(world, figureId);
  const memory = new EpisodicMemory();
  memory.restore({ episodes: request.memories ?? [], nextSequence: 1 });
  const ownMemories = memory.forObserver(figureId, request.cycleNumber);
  const evidenceIds = new Set(request.cause.evidenceIds ?? []);
  const receipts = worldMindForFigure(world.worldMind ?? [], figureId).filter(
    (entry) => entry.cycle === request.cycleNumber,
  );
  const relevantReceipts = evidenceIds.size
    ? receipts.filter((entry) =>
        evidenceIds.has(`receipt:${entry.cycle}:${entry.sequence}`),
      )
    : receipts.slice(-2);
  const referencedIds = new Set(
    relevantReceipts.flatMap((entry) =>
      [...entry.before.objects, ...entry.after.objects].map(
        (object) => object.id,
      ),
    ),
  );
  const selectedMemories = ownMemories
    .filter(
      (entry) =>
        entry.entityIds.some((id) => referencedIds.has(id)) ||
        entry.roomIds.includes(figure?.roomId ?? ""),
    )
    .slice(-6);
  const visibleObjects = new Map(
    scene.objects.map((object) => [object.id, object]),
  );
  const visibleActors = new Map<
    string,
    { name: string; roomId: string; x: number; y: number }
  >(scene.figures.map((entry) => [entry.id, entry]));
  if (scene.player)
    visibleActors.set("player", { name: "санитар", ...scene.player });
  const visibleDoors = scene.doors.filter((door) => !door.hidden);
  const knownDoorIds = new Set(visibleDoors.map((door) => door.id));
  const knownRooms = new Set([
    figure?.roomId ?? "",
    ...ownMemories.flatMap((entry) => entry.roomIds),
    ...(options.agendaRoomIds ?? []),
  ]);
  for (const receipt of receipts) {
    for (const event of receipt.events)
      if (event.type === "door.traversed") {
        knownDoorIds.add(event.doorId);
        knownRooms.add(event.fromRoomId);
        knownRooms.add(event.toRoomId);
      }
  }

  const candidates: NpcTaskCandidate[] = [];
  const signatures = new Set<string>();
  const blockedTask =
    request.cause.kind === "blocked" &&
    request.currentTask?.figureId === figureId
      ? request.currentTask
      : null;
  const substantive = (actions: readonly WorldAction[]) =>
    actions.filter(
      (action) => action.type !== "moveTo" && action.type !== "approach",
    );
  const blockedActions = substantive(blockedTask?.actions ?? []);
  const blockedStateUnchanged =
    blockedTask &&
    npcDependencyFingerprint(world, blockedTask.dependencies) ===
      blockedTask.contextKey;
  const add = (description: string, build: (plan: TaskPlan) => boolean) => {
    if (
      candidates.length >= MAX_CANDIDATES - 2 ||
      !figure ||
      figure.fate === "dead" ||
      figure.fate === "gone" ||
      figure.id === "glaz"
    )
      return;
    const plan = new TaskPlan(world, figureId);
    if (!build(plan) || !plan.actions.length) return;
    if (blockedTask && blockedStateUnchanged) {
      const plannedActions = substantive(plan.actions);
      const failed = blockedTask.actions[0];
      if (
        (blockedActions.length > 0 &&
          JSON.stringify(plannedActions) === JSON.stringify(blockedActions)) ||
        (failed &&
          JSON.stringify(failed) ===
            JSON.stringify(
              failed.type === "moveTo" || failed.type === "approach"
                ? plan.actions[0]
                : plannedActions[0],
            ))
      )
        return;
    }
    const destination = plan.world.getFigurePose(figureId);
    if (
      options.pinnedRoomId &&
      (destination?.roomId !== options.pinnedRoomId ||
        plan.actions.some((action) => action.type === "traverseDoor"))
    )
      return;
    const signature = JSON.stringify(plan.actions);
    if (signatures.has(signature)) return;
    signatures.add(signature);
    const id = `choice_${candidates.length + 1}`;
    const dependencies = objectDependencies(world, figureId, plan.actions);
    candidates.push({
      id,
      description,
      task: {
        id: `${request.requestId}:${id}`,
        figureId,
        summary: description,
        actions: plan.actions,
        dependencies,
        contextKey: npcDependencyFingerprint(world, dependencies),
        lifetimeSeconds: 180,
        cause: request.cause,
      },
    });
  };

  // A previous location is evidence only when this NPC actually saw it.
  for (const receipt of relevantReceipts)
    for (const before of receipt.before.objects) {
      const object = visibleObjects.get(before.id);
      if (
        !object ||
        JSON.stringify(object.location) === JSON.stringify(before.location)
      )
        continue;
      if (before.location.kind === "room") {
        const destination = before.location;
        add(
          `Вернуть ${object.name} на увиденное прежнее место`,
          (plan) =>
            plan.acquire(object.id) &&
            routeTo(plan, world, destination.roomId, knownDoorIds) &&
            plan.moveNear(destination.roomId, destination.x, destination.y) &&
            plan.act({
              type: "drop",
              objectId: object.id,
              x: destination.x,
              y: destination.y,
            }),
        );
      } else if (before.location.kind === "held") {
        const recipient = before.location.actor;
        const id = recipient.kind === "player" ? "player" : recipient.id;
        const holder = visibleActors.get(id);
        if (holder && id !== figureId)
          add(
            `Вернуть ${object.name}: ${holder.name} держал эту вещь на глазах персонажа`,
            (plan) =>
              plan.acquire(object.id) &&
              plan.moveNear(holder.roomId, holder.x, holder.y) &&
              plan.act({ type: "give", objectId: object.id, to: recipient }),
          );
      }
    }

  const orderedObjects = [...scene.objects].sort(
    (a, b) => relevance(b) - relevance(a),
  );
  function relevance(entity: { id: string; name: string }): number {
    const goal = request.goal?.goal.toLocaleLowerCase() ?? "";
    return (
      (referencedIds.has(entity.id) ? 2 : 0) +
      (goal &&
      (goal.includes(entity.id.toLocaleLowerCase()) ||
        goal.includes(entity.name.toLocaleLowerCase()))
        ? 4
        : 0)
    );
  }
  const recipients = [...visibleActors.entries()]
    .filter(([id]) => id !== figureId)
    .sort(
      ([aId, a], [bId, b]) =>
        relevance({ id: bId, name: b.name }) -
        relevance({ id: aId, name: a.name }),
    )
    .slice(0, 3);
  const containers = orderedObjects
    .filter(
      (object) =>
        object.affordances.includes("open") ||
        object.affordances.includes("close"),
    )
    .slice(0, 3);
  // Prefer complete reactions over filling the choice cap with independent verbs.
  for (const object of orderedObjects
    .filter((entry) => entry.mobility === "carryable")
    .slice(0, 4)) {
    for (const [id, recipient] of recipients) {
      if (!object.affordances.includes("give")) continue;
      add(
        `Доставить ${object.name}: ${recipient.name}`,
        (plan) =>
          plan.acquire(object.id) &&
          (!object.state.wornBy ||
            plan.act({ type: "removeWear", objectId: object.id })) &&
          plan.moveNear(recipient.roomId, recipient.x, recipient.y) &&
          plan.act({
            type: "give",
            objectId: object.id,
            to: id === "player" ? { kind: "player" } : { kind: "figure", id },
          }),
      );
    }
    for (const container of containers) {
      if (
        object.id === container.id ||
        !object.affordances.includes("put") ||
        (object.location.kind === "inside" &&
          object.location.objectId === container.id)
      )
        continue;
      add(
        `Убрать ${object.name} в ${container.name}`,
        (plan) =>
          plan.acquire(object.id) &&
          (!object.state.wornBy ||
            plan.act({ type: "removeWear", objectId: object.id })) &&
          plan.approach(container.id) &&
          (container.state.open === true ||
            plan.act({ type: "open", targetId: container.id })) &&
          plan.act({
            type: "put",
            objectId: object.id,
            intoObjectId: container.id,
          }),
      );
    }
  }
  const initial = sandboxFromSnapshot(world);
  const actor: ActorRef = { kind: "figure", id: figureId };
  for (const object of orderedObjects) {
    for (const option of availableActions(initial, actor, {
      kind: "object",
      id: object.id,
    })) {
      const action = option.action;
      if (
        action.type === "examine" ||
        action.type === "approach" ||
        action.type === "traverseDoor" ||
        action.type === "requestRole"
      )
        continue;
      if (
        (action.type === "open" && object.state.open === true) ||
        (action.type === "close" && object.state.open === false) ||
        (action.type === "activate" && object.state.active === true) ||
        // A closed receptacle may contain an unseen body. Choosing an open
        // task first avoids leaking that fact through occupy's availability.
        (action.type === "occupy" && object.state.open === false)
      )
        continue;
      const label: Partial<Record<WorldAction["type"], string>> = {
        take: "Взять",
        drop: "Положить рядом",
        open: "Открыть",
        close: "Закрыть",
        activate: "Включить",
        use: "Использовать",
        wear: "Надеть",
        removeWear: "Снять",
        occupy: "Занять",
        leave: "Освободить",
        detach: "Отсоединить",
        empty: "Опустошить",
        put: "Положить в",
      };
      add(`${label[action.type] ?? action.type}: ${object.name}`, (plan) => {
        if (
          (action.type === "wear" || action.type === "use") &&
          object.mobility === "carryable" &&
          !plan.acquire(object.id)
        )
          return false;
        if (action.type === "take") return plan.acquire(object.id);
        const heldBySelf =
          object.location.kind === "held" &&
          object.location.actor.kind === "figure" &&
          object.location.actor.id === figureId;
        if (!heldBySelf && action.type !== "leave" && !plan.approach(object.id))
          return false;
        if (
          (action.type === "put" || action.type === "drop") &&
          "objectId" in action &&
          plan.world.objectById.get(action.objectId)?.state.wornBy &&
          !plan.act({ type: "removeWear", objectId: action.objectId })
        )
          return false;
        return plan.act(action);
      });
    }
    if (
      object.location.kind === "held" &&
      object.location.actor.kind === "figure" &&
      object.location.actor.id === figureId
    ) {
      for (const [id, recipient] of visibleActors) {
        if (id === figureId) continue;
        add(
          `Передать ${object.name}: ${recipient.name}`,
          (plan) =>
            (!object.state.wornBy ||
              plan.act({ type: "removeWear", objectId: object.id })) &&
            plan.moveNear(recipient.roomId, recipient.x, recipient.y) &&
            plan.act({
              type: "give",
              objectId: object.id,
              to: id === "player" ? { kind: "player" } : { kind: "figure", id },
            }),
        );
      }
    }
  }
  if (!options.pinnedRoomId) {
    for (const roomId of knownRooms) {
      if (!roomId || roomId === figure?.roomId) continue;
      const room = world.rooms.find((entry) => entry.id === roomId);
      if (room)
        add(`Дойти до знакомого места: ${room.name}`, (plan) =>
          routeTo(plan, world, roomId, knownDoorIds),
        );
    }
    for (const door of visibleDoors)
      add(`Пройти через видимый порог ${door.id}`, (plan) =>
        plan.traverse(door.id),
      );
  }
  if (request.currentTask?.figureId === figureId && !blockedTask)
    candidates.push({
      id: "continue",
      description: "Продолжить текущее занятие",
      task: null,
    });
  candidates.push({
    id: "wait",
    description: "Остаться при своём занятии до существенного изменения",
    task: null,
  });

  const dependencies: NpcTaskDependencies = {
    figureId,
    objectIds: [
      ...new Set([
        ...visibleObjects.keys(),
        ...candidates.flatMap(
          (candidate) => candidate.task?.dependencies.objectIds ?? [],
        ),
      ]),
    ],
    doorIds: [
      ...new Set([
        ...visibleDoors.map((door) => door.id),
        ...candidates.flatMap(
          (candidate) => candidate.task?.dependencies.doorIds ?? [],
        ),
      ]),
    ],
    actorIds: [...visibleActors.keys()],
  };
  const context = {
    self: figure
      ? {
          id: figure.id,
          name: figure.name,
          role: figure.role,
          personality: figure.personality,
          activity: figure.activity,
        }
      : null,
    room: scene.room ? { id: scene.room.id, name: scene.room.name } : null,
    goal:
      request.goal?.figureId === figureId
        ? { goalId: request.goal.goalId, goal: request.goal.goal }
        : null,
    reason: request.cause.kind,
    ...(blockedTask
      ? {
          blockedTask: {
            summary: blockedTask.summary.slice(0, 800),
            nextAction: blockedTask.actions[0]?.type ?? null,
          },
        }
      : {}),
    figures: scene.figures.map(({ id, name, activity }) => ({
      id,
      name,
      activity,
    })),
    playerVisible: scene.player !== null,
    objects: scene.objects.map(
      ({ id, name, location, mobility, affordances, state }) => ({
        id,
        name,
        location,
        mobility,
        affordances,
        state: observedState(state),
      }),
    ),
    doors: visibleDoors.map(({ id, threshold, closed }) => ({
      id,
      threshold,
      closed,
    })),
    memories: selectedMemories.map(({ text, provenance }) => ({
      text: text.slice(0, 800),
      provenance,
    })),
    observations: relevantReceipts.map((entry) => ({
      id: `receipt:${entry.cycle}:${entry.sequence}`,
      actor: entry.actor,
      actionType: entry.actionType,
      before: entry.before.objects.map(({ id, name, location, state }) => ({
        id,
        name,
        location,
        state: observedState(state),
      })),
      after: entry.after.objects.map(({ id, name, location, state }) => ({
        id,
        name,
        location,
        state: observedState(state),
      })),
    })),
  };
  return {
    context,
    candidates,
    dependencies,
    contextKey: npcDependencyFingerprint(world, dependencies),
  };
}
