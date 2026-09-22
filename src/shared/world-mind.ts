/** Factual, cycle-local receipts. A figure remembers only what it did or witnessed. */
import type {
  ActionCause,
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
  WorldActionSource,
  WorldEvent,
} from "./world-action";
import type {
  ActorPose,
  AnyActor,
  ObjectLocation,
  WorldDoorView,
  WorldMutator,
  WorldObjectState,
} from "./world-object";
import {
  actorIsConcealed,
  getActorEquipment,
  getActorOccupancy,
  isActorRef,
} from "./world-object";

export const MAX_WORLD_MIND_EVENTS = 128;
export const WORLD_MIND_WITNESS_RADIUS = 8;

export interface WorldMindObjectFact {
  id: string;
  name: string;
  location: ObjectLocation;
  state: WorldObjectState["state"];
}

export type WorldMindDoorFact = Pick<
  WorldDoorView,
  "id" | "type" | "closed" | "fromRoomId" | "x" | "y" | "w" | "h"
>;

export interface WorldMindActionState {
  actor: ActorPose | null;
  objects: WorldMindObjectFact[];
  door: WorldMindDoorFact | null;
}

interface WorldMindVisibility {
  actor: boolean;
  objectIds: string[];
  door: boolean;
}

interface WorldMindWitnessView {
  before: WorldMindVisibility;
  after: WorldMindVisibility;
}

export interface WorldMindEvent {
  sequence: number;
  cycle: number;
  revision: number;
  actor: AnyActor | null;
  source: WorldActionSource | null;
  actionType: WorldAction["type"] | null;
  /** Only the actor receives the complete command; witnesses receive observed facts. */
  action: WorldAction | null;
  /** Optional for older saves; shared by nested scripted consequences. */
  cause?: ActionCause;
  events: WorldEvent[];
  roomIds: string[];
  witnessIds: string[];
  witnessRooms: Record<string, string[]>;
  /** Visibility is captured before reactions can move a witness or change the scene. */
  witnessViews: Record<string, WorldMindWitnessView>;
  before: WorldMindActionState;
  after: WorldMindActionState;
}

export interface WorldMindState {
  nextSequence: number;
  events: WorldMindEvent[];
}

export interface WorldMindCapture {
  actorConcealed?: boolean;
  state: WorldMindActionState;
  figures: Array<{ id: string; pose: ActorPose }>;
  objectPoses: Record<string, ActorPose | null>;
}

export function createWorldMind(): WorldMindState {
  return { nextSequence: 1, events: [] };
}

function actorPose(world: WorldMutator, actor: AnyActor): ActorPose | null {
  if (actor.kind === "player") return world.getPlayerPose();
  if (actor.kind === "figure") return world.getFigurePose(actor.id);
  return null;
}

function objectPose(
  world: WorldMutator,
  object: WorldObjectState,
): ActorPose | null {
  const seen = new Set<string>();
  let current: WorldObjectState | undefined = object;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const location = current.location;
    if (location.kind === "room")
      return { roomId: location.roomId, x: location.x, y: location.y };
    if (location.kind === "held")
      return actorIsConcealed(world.objects, location.actor)
        ? null
        : actorPose(world, location.actor);
    if (location.kind !== "inside") return null;
    current = world.objectById.get(location.objectId);
    if (!current || current.state.open !== true) return null;
  }
  return null;
}

export function captureWorldAction(
  world: WorldMutator,
  envelope: WorldActionEnvelope,
  additionalObjectIds: readonly string[] = [],
): WorldMindCapture {
  const action = envelope.action;
  const objectIds = new Set(additionalObjectIds);
  if ("objectId" in action && action.objectId) objectIds.add(action.objectId);
  if (action.type === "leave" && isActorRef(envelope.actor)) {
    const occupied = getActorOccupancy(world.objects, envelope.actor);
    if (occupied) objectIds.add(occupied.id);
  }
  if (action.type === "requestRole" && isActorRef(envelope.actor))
    for (const equipment of getActorEquipment(world.objects, envelope.actor))
      objectIds.add(equipment.id);
  if (action.type === "empty")
    for (const child of world.objects)
      if (
        child.location.kind === "inside" &&
        child.location.objectId === action.objectId
      )
        objectIds.add(child.id);
  if ("targetId" in action && action.targetId) objectIds.add(action.targetId);
  if (action.type === "open") {
    // Capture both sides using their actual state: a closed container contributes
    // no contents before opening. An open nested container exposes its children;
    // a closed nested container exposes only its own exterior, never its contents.
    const inspected = new Set<string>();
    const containers = [action.targetId];
    for (let index = 0; index < containers.length; index++) {
      const containerId = containers[index]!;
      if (
        inspected.has(containerId) ||
        world.objectById.get(containerId)?.state.open !== true
      )
        continue;
      inspected.add(containerId);
      for (const child of world.objects) {
        if (
          child.location.kind !== "inside" ||
          child.location.objectId !== containerId
        )
          continue;
        objectIds.add(child.id);
        containers.push(child.id);
      }
    }
  }
  if ("intoObjectId" in action) objectIds.add(action.intoObjectId);
  const doorId =
    "doorId" in action
      ? action.doorId
      : "targetId" in action
        ? action.targetId
        : undefined;
  const objects: WorldMindObjectFact[] = [];
  const objectPoses: Record<string, ActorPose | null> = {};
  for (const id of objectIds) {
    const object = world.objectById.get(id);
    if (!object) continue;
    objects.push({
      id,
      name: object.name,
      location: structuredClone(object.location),
      state: structuredClone(object.state),
    });
    objectPoses[id] = objectPose(world, object);
  }
  const door = doorId ? world.getDoor(doorId) : null;
  return {
    actorConcealed:
      isActorRef(envelope.actor) &&
      actorIsConcealed(world.objects, envelope.actor),
    state: {
      actor: actorPose(world, envelope.actor),
      objects,
      door: door
        ? {
            id: door.id,
            type: door.type,
            closed: door.closed,
            fromRoomId: door.fromRoomId,
            x: door.x,
            y: door.y,
            w: door.w,
            h: door.h,
          }
        : null,
    },
    figures: [...world.figurePoses]
      .filter(
        ([id]) => !actorIsConcealed(world.objects, { kind: "figure", id }),
      )
      .map(([id, pose]) => ({
        id,
        pose: { ...pose },
      })),
    objectPoses,
  };
}

/** Walls between endpoints hide an action; its own wall-mounted target is visible. */
export function canObserveWorldPose(
  world: WorldMutator,
  observer: ActorPose,
  target: ActorPose,
): boolean {
  if (observer.roomId !== target.roomId) return false;
  if (
    Math.hypot(observer.x - target.x, observer.y - target.y) >
    WORLD_MIND_WITNESS_RADIUS
  )
    return false;
  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  const startX = Math.round(observer.x);
  const startY = Math.round(observer.y);
  const endX = Math.round(target.x);
  const endY = Math.round(target.y);
  for (let i = 1; i < steps; i++) {
    const x = Math.round(observer.x + (dx * i) / steps);
    const y = Math.round(observer.y + (dy * i) / steps);
    if ((x === startX && y === startY) || (x === endX && y === endY)) continue;
    if (!world.isWalkableTile(observer.roomId, x, y)) return false;
  }
  return true;
}

function visibility(
  world: WorldMutator,
  observer: ActorPose,
  capture: WorldMindCapture,
): WorldMindVisibility {
  const door = capture.state.door;
  return {
    actor:
      !capture.actorConcealed &&
      capture.state.actor !== null &&
      canObserveWorldPose(world, observer, capture.state.actor),
    objectIds: capture.state.objects
      .filter((object) => {
        const pose = capture.objectPoses[object.id];
        return !!pose && canObserveWorldPose(world, observer, pose);
      })
      .map((object) => object.id),
    door:
      !!door &&
      canObserveWorldPose(world, observer, {
        roomId: door.fromRoomId,
        x: door.x,
        y: door.y,
      }),
  };
}

function sawAnything(view: WorldMindVisibility): boolean {
  return view.actor || view.door || view.objectIds.length > 0;
}

/** Call immediately after a successful action, before delivering its reactions. */
export function recordWorldAction(
  mind: WorldMindState,
  world: WorldMutator,
  envelope: WorldActionEnvelope,
  result: WorldActionResult,
  before: WorldMindCapture,
  cycle: number,
): WorldMindEvent | null {
  if (!result.ok) return null;
  const after = captureWorldAction(world, envelope, result.affectedObjects);
  const witnessRooms: Record<string, string[]> = {};
  const witnessViews: Record<string, WorldMindWitnessView> = {};
  for (const { id, pose } of before.figures) {
    const beforeView = visibility(world, pose, before);
    const afterView = visibility(world, pose, after);
    const self = envelope.actor.kind === "figure" && envelope.actor.id === id;
    if (!self && !sawAnything(beforeView) && !sawAnything(afterView)) continue;
    witnessRooms[id] = self
      ? [
          ...new Set(
            [before.state.actor?.roomId, after.state.actor?.roomId].filter(
              (room): room is string => !!room,
            ),
          ),
        ]
      : [pose.roomId];
    witnessViews[id] = { before: beforeView, after: afterView };
  }
  const entry: WorldMindEvent = structuredClone({
    sequence: mind.nextSequence++,
    cycle,
    revision: world.revision,
    actor: envelope.actor,
    source: envelope.source,
    actionType: envelope.action.type,
    action: envelope.action,
    ...(envelope.cause ? { cause: envelope.cause } : {}),
    events: result.events,
    roomIds: result.affectedRooms,
    witnessIds: Object.keys(witnessRooms),
    witnessRooms,
    witnessViews,
    before: before.state,
    after: after.state,
  });
  mind.events.push(entry);
  if (mind.events.length > MAX_WORLD_MIND_EVENTS)
    mind.events.splice(0, mind.events.length - MAX_WORLD_MIND_EVENTS);
  return entry;
}

function visibleState(
  state: WorldMindActionState,
  view: WorldMindVisibility,
): WorldMindActionState {
  return {
    actor: view.actor ? state.actor : null,
    objects: state.objects
      .filter((object) => view.objectIds.includes(object.id))
      .map((object) => {
        if (
          !object.state.occupancy ||
          (object.state.open !== false &&
            object.state.occupancy.pose !== "hidden")
        )
          return object;
        // Seeing a closed receptacle does not reveal the identity or return pose
        // of an unseen body inside it. An earlier witnessed entry remains memory.
        const { occupancy, ...visible } = object.state;
        void occupancy;
        return { ...object, state: visible };
      }),
    door: view.door ? state.door : null,
  };
}

function visibleEvent(event: WorldEvent, view: WorldMindWitnessView): boolean {
  const before = (id: string) => view.before.objectIds.includes(id);
  const after = (id: string) => view.after.objectIds.includes(id);
  const participant = (id: string | null) =>
    id === null ||
    before(id) ||
    after(id) ||
    view.before.door ||
    view.after.door;
  switch (event.type) {
    case "actor.requested":
      return (
        (view.before.actor || view.after.actor) &&
        (event.objectId === null ||
          before(event.objectId) ||
          after(event.objectId))
      );
    case "object.emptied":
      return (
        (before(event.objectId) || after(event.objectId)) &&
        event.objectIds.every(after)
      );
    case "door.traversed":
      return view.before.actor && view.after.actor;
    case "actor.moved":
      return view.after.actor;
    case "actor.enteredRoom":
      return (
        view.after.actor && (event.viaDoorId === null || view.before.actor)
      );
    case "door.opened":
    case "door.closed":
    case "door.revealed":
      return view.before.door || view.after.door;
    case "object.taken":
    case "object.given":
      return before(event.objectId) && after(event.objectId);
    case "object.dropped":
      return after(event.objectId);
    case "object.moved":
      return after(event.objectId) && after(event.intoObjectId);
    case "object.changed":
      // The event contains both physical states; observing only one phase is
      // insufficient, and an unseen secondary participant must stay unnamed.
      return (
        before(event.objectId) &&
        after(event.objectId) &&
        participant(event.targetId)
      );
    case "object.gestured":
    case "object.used":
      return (
        (before(event.objectId) || after(event.objectId)) &&
        participant(event.targetId)
      );
    default:
      return before(event.objectId) || after(event.objectId);
  }
}

/** A scoped copy: subsequent movement never creates new witnesses retroactively. */
export function worldMindForFigure(
  mind: WorldMindState | readonly WorldMindEvent[],
  figureId: string,
  limit = 12,
): WorldMindEvent[] {
  const events = "events" in mind ? mind.events : mind;
  const count = Number.isFinite(limit)
    ? Math.max(0, Math.min(MAX_WORLD_MIND_EVENTS, Math.floor(limit)))
    : 12;
  if (count === 0) return [];
  return events
    .filter(
      (entry) =>
        (entry.actor?.kind === "figure" && entry.actor.id === figureId) ||
        entry.witnessIds.includes(figureId),
    )
    .slice(-count)
    .map((entry) => {
      const self =
        entry.actor?.kind === "figure" && entry.actor.id === figureId;
      const view = entry.witnessViews?.[figureId];
      const rooms = entry.witnessRooms?.[figureId] ?? [];
      const sawActor = self || !!view?.before.actor || !!view?.after.actor;
      return structuredClone({
        ...entry,
        actor: sawActor ? entry.actor : null,
        source: sawActor ? entry.source : null,
        actionType: sawActor ? entry.actionType : null,
        action: self ? entry.action : null,
        roomIds: self ? entry.roomIds : rooms,
        witnessIds: [figureId],
        witnessRooms: { [figureId]: rooms },
        witnessViews: view ? { [figureId]: view } : {},
        before: self
          ? entry.before
          : visibleState(
              entry.before,
              view?.before ?? { actor: false, objectIds: [], door: false },
            ),
        after: self
          ? entry.after
          : visibleState(
              entry.after,
              view?.after ?? { actor: false, objectIds: [], door: false },
            ),
        events: self
          ? entry.events
          : view && sawActor
            ? entry.events.filter((event) => visibleEvent(event, view))
            : [],
      });
    });
}
