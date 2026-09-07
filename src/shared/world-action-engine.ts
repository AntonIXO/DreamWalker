/**
 * Shared executor for embodied world actions.
 *
 * Player, NPC, pack scripts, and Heartbeat call executeWorldAction. The
 * signature is frozen. Must stay free of DOM and node APIs.
 *
 * Sealed doors are sleeper-only: patch.ts `openDoor` restores sealHistory.
 * This engine will not unseal.
 */

import {
  NPC_ACTION_TYPES,
  type ActionOption,
  type WorldAction,
  type WorldActionEnvelope,
  type WorldActionResult,
  type WorldEvent,
} from "./world-action";
import {
  actorsEqual,
  cloneObject,
  findChebyshevPath,
  isActorRef,
  isHeldBy,
  solidObjectCovers,
  type ActorPose,
  type ActorRef,
  type AnyActor,
  type ObjectAffordance,
  type WorldDoorView,
  type WorldMutator,
  type WorldObjectState,
} from "./world-object";

const DEFAULT_REACH = 1.5;

export function refused(message: string): WorldActionResult {
  return {
    ok: false,
    refusal: message,
    affectedRooms: [],
    affectedObjects: [],
    events: [],
  };
}

export interface WorldMutatorSeed {
  revision?: number;
  objects: WorldObjectState[];
  keysHeld?: Iterable<string>;
  playerPose?: ActorPose | null;
  figurePoses?: Iterable<[string, ActorPose]>;
  doors?: WorldDoorView[];
  isWalkableTile: (roomId: string, x: number, y: number) => boolean;
  canPassDoor?: (doorId: string) => boolean;
}

export function createWorldMutator(seed: WorldMutatorSeed): WorldMutator {
  const objects = seed.objects;
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const keysHeld =
    seed.keysHeld instanceof Set ? seed.keysHeld : new Set(seed.keysHeld ?? []);
  const figurePoses = new Map<string, ActorPose>();
  for (const [id, pose] of seed.figurePoses ?? []) {
    figurePoses.set(id, { ...pose });
  }
  const doorById = new Map<string, WorldDoorView>();
  for (const door of seed.doors ?? []) {
    doorById.set(door.id, { ...door });
  }
  let playerPose = seed.playerPose ? { ...seed.playerPose } : null;
  let revision = seed.revision ?? 0;

  const canWalk = (
    roomId: string,
    x: number,
    y: number,
    ignoreObjectId?: string,
  ): boolean => {
    if (!seed.isWalkableTile(roomId, x, y)) return false;
    return !solidObjectCovers(objects, roomId, x, y, ignoreObjectId);
  };

  const mutator: WorldMutator = {
    get revision() {
      return revision;
    },
    set revision(value: number) {
      revision = value;
    },
    objects,
    objectById,
    keysHeld,
    figurePoses,
    doorById,
    getPlayerPose: () => (playerPose ? { ...playerPose } : null),
    setPlayerPose: (pose) => {
      playerPose = { ...pose };
    },
    getFigurePose: (figureId) => {
      const pose = figurePoses.get(figureId);
      return pose ? { ...pose } : null;
    },
    setFigurePose: (figureId, pose) => {
      figurePoses.set(figureId, { ...pose });
    },
    getDoor: (doorId) => {
      const door = doorById.get(doorId);
      return door ? { ...door } : null;
    },
    setDoorType: (doorId, type) => {
      const door = doorById.get(doorId);
      if (door) door.type = type;
    },
    isWalkableTile: seed.isWalkableTile,
    canPassDoor: (doorId) => {
      const door = doorById.get(doorId);
      if (!door) return false;
      if (door.type === "open" || door.type === "ledge") return true;
      if (door.type === "sealed") return false;
      if (door.type === "keyLock") {
        return door.keyId !== null && keysHeld.has(door.keyId);
      }
      if (seed.canPassDoor) return seed.canPassDoor(doorId);
      return false;
    },
    canWalk,
    hasPath: (roomId, from, to, ignoreObjectId) => {
      const sx = Math.round(from.x);
      const sy = Math.round(from.y);
      const path = findChebyshevPath(from, to, (x, y) => {
        if (x === sx && y === sy) return true;
        return canWalk(roomId, x, y, ignoreObjectId);
      });
      return path !== null;
    },
    bumpRevision: () => {
      revision += 1;
    },
  };
  return mutator;
}

export function cloneWorldMutator(world: WorldMutator): WorldMutator {
  const passable = new Map<string, boolean>();
  for (const id of world.doorById.keys()) {
    passable.set(id, world.canPassDoor(id));
  }
  const figurePoses = new Map<string, ActorPose>();
  for (const [id, pose] of world.figurePoses) {
    figurePoses.set(id, { ...pose });
  }
  for (const id of figurePoses.keys()) {
    const live = world.getFigurePose(id);
    if (live) figurePoses.set(id, live);
  }
  return createWorldMutator({
    revision: world.revision,
    objects: world.objects.map(cloneObject),
    keysHeld: new Set(world.keysHeld),
    playerPose: world.getPlayerPose(),
    figurePoses,
    doors: [...world.doorById.values()].map((door) => ({ ...door })),
    isWalkableTile: (roomId, x, y) => world.isWalkableTile(roomId, x, y),
    canPassDoor: (doorId) => passable.get(doorId) ?? false,
  });
}

export function executeWorldAction(
  world: WorldMutator,
  envelope: WorldActionEnvelope,
): WorldActionResult {
  const { actor, source, action } = envelope;

  const pose = poseOf(world, actor);
  if (!pose) return refused("actor does not exist");

  if (source === "npc") {
    if (actor.kind !== "figure") {
      return refused("npc actor must be a figure; server wraps figureId");
    }
    if (!NPC_ACTION_TYPES.has(action.type)) {
      return refused("npc cannot perform this action");
    }
  }

  if (!isActorRef(actor)) return refused("actor does not exist");

  switch (action.type) {
    case "moveTo":
      return execMoveTo(world, actor, pose, action);
    case "take":
      return execTake(world, actor, pose, action.objectId);
    case "drop":
      return execDrop(world, actor, pose, action);
    case "give":
      return execGive(world, actor, pose, action);
    case "put":
      return execPut(world, actor, pose, action);
    case "open":
      return execOpen(world, actor, pose, action.targetId);
    case "close":
      return execClose(world, actor, pose, action.targetId);
    case "activate":
      return execActivate(world, actor, pose, action.objectId);
    case "use":
      return execUse(world, actor, pose, action);
    case "traverseDoor":
      return execTraverse(world, actor, pose, action.doorId);
    default:
      return refused("unknown action");
  }
}

export function availableActions(
  world: WorldMutator,
  actor: ActorRef,
  target:
    | { kind: "object"; id: string }
    | { kind: "figure"; id: string }
    | { kind: "door"; id: string }
    | { kind: "ground"; roomId: string; x: number; y: number },
): ActionOption[] {
  const pose = poseOf(world, actor);
  if (!pose) return [];

  if (target.kind === "object") {
    const object = world.objectById.get(target.id);
    if (!object) return [];
    return object.affordances.map((affordance) => ({
      action: actionForAffordance(affordance, object, actor),
      affordance,
      label: object.interaction?.prompt || object.name,
      refusal: object.affordances.includes(affordance)
        ? null
        : (object.interaction?.refusal ?? "cannot"),
    }));
  }

  if (target.kind === "door") {
    const door = world.getDoor(target.id);
    if (!door) return [];
    return [
      {
        action: { type: "open", targetId: door.id },
        affordance: "open",
        label: "open",
        refusal: null,
      },
      {
        action: { type: "close", targetId: door.id },
        affordance: "close",
        label: "close",
        refusal: null,
      },
      {
        action: { type: "traverseDoor", doorId: door.id },
        affordance: "traverse",
        label: "go through",
        refusal: null,
      },
    ];
  }

  if (target.kind === "ground") {
    return [
      {
        action: {
          type: "moveTo",
          x: target.x,
          y: target.y,
          roomId: target.roomId,
        },
        affordance: "move",
        label: "walk",
        refusal: target.roomId !== pose.roomId ? "no teleports" : null,
      },
    ];
  }

  const held = world.objects.find((object) => isHeldBy(object, actor));
  if (!held) return [];
  return [
    {
      action: { type: "give", objectId: held.id, to: { kind: "figure", id: target.id } },
      affordance: "give",
      label: held.name,
      refusal: null,
    },
  ];
}

function actionForAffordance(
  affordance: ObjectAffordance,
  object: WorldObjectState,
  actor: ActorRef,
): WorldAction {
  switch (affordance) {
    case "take":
      return { type: "take", objectId: object.id };
    case "drop":
      return { type: "drop", objectId: object.id };
    case "give":
      return { type: "give", objectId: object.id, to: actor };
    case "put":
      return { type: "put", objectId: object.id, intoObjectId: object.id };
    case "open":
      return { type: "open", targetId: object.id };
    case "close":
      return { type: "close", targetId: object.id };
    case "activate":
      return { type: "activate", objectId: object.id };
    case "use":
      return { type: "use", objectId: object.id };
    case "traverse":
      return { type: "traverseDoor", doorId: object.id };
    default:
      return { type: "use", objectId: object.id };
  }
}

function execMoveTo(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: { x: number; y: number; roomId?: string },
): WorldActionResult {
  if (action.roomId && action.roomId !== pose.roomId) {
    return refused("no teleports");
  }
  const dest = { x: Math.round(action.x), y: Math.round(action.y) };
  if (!world.canWalk(pose.roomId, dest.x, dest.y)) {
    return refused("blocked");
  }
  if (!world.hasPath(pose.roomId, pose, dest)) {
    return refused("no path");
  }
  const next = { roomId: pose.roomId, x: dest.x, y: dest.y };
  setPose(world, actor, next);
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [],
    events: [
      {
        type: "actor.moved",
        actor,
        roomId: next.roomId,
        x: next.x,
        y: next.y,
      },
    ],
  });
}

function execTake(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  if (isHeldBy(object, actor)) return refused("already held");
  if (object.location.kind === "held") return refused("already held");
  const blocked = requireAffordance(object, "take");
  if (blocked) return blocked;
  if (object.mobility !== "carryable") return refused("cannot take this");

  if (object.location.kind === "inside") {
    const parent = world.objectById.get(object.location.objectId);
    if (!parent) return refused("no such object");
    if (parent.state.open !== true) return refused("container is closed");
    const parentHere = parent.location.kind === "room" ? parent.location : null;
    if (parentHere) {
      if (parentHere.roomId !== pose.roomId) return refused("different room");
      if (!inReachOfObject(pose, parent)) return refused("out of reach");
      if (!world.hasPath(pose.roomId, pose, tileOf(parentHere), parent.id)) {
        return refused("no path");
      }
    }
  } else if (object.location.kind === "room") {
    if (object.location.roomId !== pose.roomId) return refused("different room");
    if (!inReachOfObject(pose, object)) return refused("out of reach");
    if (!world.hasPath(pose.roomId, pose, tileOf(object.location), object.id)) {
      return refused("no path");
    }
  } else {
    return refused("cannot take this");
  }

  const fromRoomId =
    object.location.kind === "room" ? object.location.roomId : null;
  object.location = { kind: "held", actor };
  syncKeyPossession(world, object);
  return succeed(world, {
    rooms: compact([fromRoomId, pose.roomId]),
    objects: [object.id],
    events: [
      {
        type: "object.taken",
        objectId: object.id,
        actor,
        fromRoomId,
      },
    ],
  });
}

function execDrop(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: { objectId: string; x?: number; y?: number },
): WorldActionResult {
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  if (!isHeldBy(object, actor)) return refused("not held");
  const blocked = requireAffordance(object, "drop");
  if (blocked) return blocked;

  let dest: { x: number; y: number } | null;
  if (action.x !== undefined && action.y !== undefined) {
    dest = { x: Math.round(action.x), y: Math.round(action.y) };
    if (!world.canWalk(pose.roomId, dest.x, dest.y, object.id)) {
      return refused("blocked");
    }
  } else {
    dest = dropAtFeet(world, pose, object.id);
    if (!dest) return refused("no space");
  }

  object.location = {
    kind: "room",
    roomId: pose.roomId,
    x: dest.x,
    y: dest.y,
  };
  syncKeyPossession(world, object);
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [
      {
        type: "object.dropped",
        objectId: object.id,
        actor,
        roomId: pose.roomId,
        x: dest.x,
        y: dest.y,
      },
    ],
  });
}

function execGive(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: { objectId: string; to: ActorRef },
): WorldActionResult {
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  if (!isHeldBy(object, actor)) return refused("not held");
  const blocked = requireAffordance(object, "give");
  if (blocked) return blocked;
  if (actorsEqual(actor, action.to)) return refused("already held");

  const toPose = poseOf(world, action.to);
  if (!toPose) return refused("actor does not exist");
  if (toPose.roomId !== pose.roomId) return refused("different room");
  if (Math.hypot(pose.x - toPose.x, pose.y - toPose.y) > DEFAULT_REACH) {
    return refused("out of reach");
  }

  object.location = { kind: "held", actor: action.to };
  syncKeyPossession(world, object);
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [
      {
        type: "object.given",
        objectId: object.id,
        from: actor,
        to: action.to,
      },
    ],
  });
}

function execPut(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: { objectId: string; intoObjectId: string },
): WorldActionResult {
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  const container = world.objectById.get(action.intoObjectId);
  if (!container) return refused("no such object");
  if (!isHeldBy(object, actor)) return refused("not held");
  const blocked = requireAffordance(object, "put");
  if (blocked) return blocked;
  if (!isContainer(container)) return refused("not a container");
  if (container.state.open !== true) return refused("container is closed");
  if (container.location.kind === "room") {
    if (container.location.roomId !== pose.roomId) {
      return refused("different room");
    }
    if (!inReachOfObject(pose, container)) return refused("out of reach");
  }

  object.location = { kind: "inside", objectId: container.id };
  syncKeyPossession(world, object);
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id, container.id],
    events: [
      {
        type: "object.moved",
        objectId: object.id,
        intoObjectId: container.id,
      },
    ],
  });
}

function execOpen(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  targetId: string,
): WorldActionResult {
  const door = world.getDoor(targetId);
  if (door) return execOpenDoor(world, actor, pose, door);
  const object = world.objectById.get(targetId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, "open");
  if (blocked) return blocked;
  if (object.location.kind === "room") {
    if (object.location.roomId !== pose.roomId) return refused("different room");
    if (!inReachOfObject(pose, object)) return refused("out of reach");
    if (!world.hasPath(pose.roomId, pose, tileOf(object.location), object.id)) {
      return refused("no path");
    }
  }
  if (object.state.locked) {
    if (!object.keyId || !actorHasKey(world, actor, object.keyId)) {
      return refused(object.interaction?.refusal ?? "locked");
    }
    object.state.locked = false;
  }
  object.state.open = true;
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: "object.opened", objectId: object.id, actor }],
  });
}

function execClose(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  targetId: string,
): WorldActionResult {
  const door = world.getDoor(targetId);
  if (door) return execCloseDoor(world, actor, pose, door);
  const object = world.objectById.get(targetId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, "close");
  if (blocked) return blocked;
  if (object.location.kind === "room") {
    if (object.location.roomId !== pose.roomId) return refused("different room");
    if (!inReachOfObject(pose, object)) return refused("out of reach");
  }
  object.state.open = false;
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: "object.closed", objectId: object.id, actor }],
  });
}

function execOpenDoor(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  door: WorldDoorView,
): WorldActionResult {
  if (door.fromRoomId !== pose.roomId) return refused("different room");
  if (!inReachOfDoor(pose, door)) return refused("out of reach");
  if (!world.hasPath(pose.roomId, pose, { x: door.x, y: door.y })) {
    return refused("no path");
  }
  // Sealed doors are sleeper-only; patch.ts openDoor restores sealHistory.
  if (door.type === "sealed") return refused("sealed");
  if (door.type === "keyLock") {
    if (!door.keyId || !actorHasKey(world, actor, door.keyId)) {
      return refused("locked");
    }
  } else if (door.type === "leverLock" || door.type === "puzzleLock") {
    if (!world.canPassDoor(door.id)) return refused("locked");
  }
  world.setDoorType(door.id, "open");
  return succeed(world, {
    rooms: compact([door.fromRoomId, door.toRoomId]),
    objects: [],
    events: [{ type: "door.opened", doorId: door.id, actor }],
  });
}

function execCloseDoor(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  door: WorldDoorView,
): WorldActionResult {
  if (door.fromRoomId !== pose.roomId) return refused("different room");
  if (!inReachOfDoor(pose, door)) return refused("out of reach");
  world.setDoorType(door.id, "keyLock");
  return succeed(world, {
    rooms: compact([door.fromRoomId, door.toRoomId]),
    objects: [],
    events: [{ type: "door.closed", doorId: door.id, actor }],
  });
}

function execActivate(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, "activate");
  if (blocked) return blocked;
  if (object.location.kind === "room") {
    if (object.location.roomId !== pose.roomId) return refused("different room");
    if (!inReachOfObject(pose, object)) return refused("out of reach");
  }
  object.state.active = true;
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: "object.activated", objectId: object.id, actor }],
  });
}

function execUse(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: { objectId: string; targetId?: string },
): WorldActionResult {
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, "use");
  if (blocked) return blocked;

  const held = isHeldBy(object, actor);
  if (object.mobility === "carryable" && !held) {
    return refused("not held");
  }
  if (!held && object.location.kind === "room") {
    if (object.location.roomId !== pose.roomId) return refused("different room");
    if (!inReachOfObject(pose, object)) return refused("out of reach");
  }

  if (action.targetId) {
    const targetObject = world.objectById.get(action.targetId);
    const targetDoor = world.getDoor(action.targetId);
    if (!targetObject && !targetDoor) return refused("no such object");
    if (targetObject?.location.kind === "room") {
      if (targetObject.location.roomId !== pose.roomId) {
        return refused("different room");
      }
      if (!inReachOfObject(pose, targetObject)) return refused("out of reach");
    }
  }

  return succeed(world, {
    rooms: [pose.roomId],
    objects: compact([object.id, action.targetId ?? null]),
    events: [
      {
        type: "object.used",
        objectId: object.id,
        targetId: action.targetId ?? null,
        actor,
      },
    ],
  });
}

function execTraverse(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  doorId: string,
): WorldActionResult {
  const door = world.getDoor(doorId);
  if (!door) return refused("no such object");
  if (door.fromRoomId !== pose.roomId) return refused("different room");
  if (!inReachOfDoor(pose, door)) return refused("out of reach");
  if (!world.hasPath(pose.roomId, pose, { x: door.x, y: door.y })) {
    return refused("no path");
  }
  if (!mayPassDoor(world, actor, door)) return refused("locked");

  const next = { roomId: door.toRoomId, x: door.toX, y: door.toY };
  setPose(world, actor, next);
  return succeed(world, {
    rooms: compact([door.fromRoomId, door.toRoomId]),
    objects: [],
    events: [
      {
        type: "door.traversed",
        doorId: door.id,
        actor,
        fromRoomId: door.fromRoomId,
        toRoomId: door.toRoomId,
      },
      {
        type: "actor.enteredRoom",
        actor,
        roomId: door.toRoomId,
        viaDoorId: door.id,
      },
      {
        type: "actor.moved",
        actor,
        roomId: next.roomId,
        x: next.x,
        y: next.y,
      },
    ],
  });
}

function poseOf(world: WorldMutator, actor: AnyActor): ActorPose | null {
  if (actor.kind === "player") return world.getPlayerPose();
  if (actor.kind === "figure") return world.getFigurePose(actor.id);
  return null;
}

function setPose(world: WorldMutator, actor: ActorRef, pose: ActorPose): void {
  if (actor.kind === "player") world.setPlayerPose(pose);
  else world.setFigurePose(actor.id, pose);
}

function requireAffordance(
  object: WorldObjectState,
  affordance: ObjectAffordance,
): WorldActionResult | null {
  if (object.affordances.includes(affordance)) return null;
  if (object.interaction?.refusal) return refused(object.interaction.refusal);
  return refused(`cannot ${affordance} this`);
}

function reachOf(object: WorldObjectState): number {
  return object.interaction?.reach ?? DEFAULT_REACH;
}

function inReachOfObject(pose: ActorPose, object: WorldObjectState): boolean {
  if (object.location.kind !== "room") return false;
  const loc = object.location;
  if (!object.body) {
    return Math.hypot(pose.x - loc.x, pose.y - loc.y) <= reachOf(object);
  }
  return (
    distanceToRect(
      pose.x,
      pose.y,
      Math.floor(loc.x),
      Math.floor(loc.y),
      object.body.w,
      object.body.h,
    ) <= reachOf(object)
  );
}

function inReachOfDoor(pose: ActorPose, door: WorldDoorView): boolean {
  return (
    distanceToRect(pose.x, pose.y, door.x, door.y, door.w, door.h) <=
    DEFAULT_REACH
  );
}

function distanceToRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  if (
    px >= rx &&
    px < rx + rw &&
    py >= ry &&
    py < ry + rh
  ) {
    return 0;
  }
  return Math.hypot(dx, dy);
}

function tileOf(location: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(location.x), y: Math.round(location.y) };
}

function dropAtFeet(
  world: WorldMutator,
  pose: ActorPose,
  ignoreObjectId?: string,
): { x: number; y: number } | null {
  const x = Math.round(pose.x);
  const y = Math.round(pose.y);
  const candidates: Array<[number, number]> = [
    [0, 0],
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dx, dy] of candidates) {
    const tx = x + dx;
    const ty = y + dy;
    if (world.canWalk(pose.roomId, tx, ty, ignoreObjectId)) {
      return { x: tx, y: ty };
    }
  }
  return null;
}

function isContainer(object: WorldObjectState): boolean {
  return (
    object.tags.includes("container") ||
    object.affordances.includes("open") ||
    object.affordances.includes("close")
  );
}

function actorHasKey(
  world: WorldMutator,
  actor: ActorRef,
  keyId: string,
): boolean {
  if (actor.kind === "player" && world.keysHeld.has(keyId)) return true;
  return world.objects.some(
    (object) => object.keyId === keyId && isHeldBy(object, actor),
  );
}

function syncKeyPossession(
  world: WorldMutator,
  object: WorldObjectState,
): void {
  if (!object.keyId) return;
  const keyId = object.keyId;
  const playerHolds = world.objects.some(
    (entry) =>
      entry.keyId === keyId &&
      entry.location.kind === "held" &&
      entry.location.actor.kind === "player",
  );
  if (playerHolds) world.keysHeld.add(keyId);
  else world.keysHeld.delete(keyId);
}

function mayPassDoor(
  world: WorldMutator,
  actor: ActorRef,
  door: WorldDoorView,
): boolean {
  if (door.type === "open" || door.type === "ledge") return true;
  if (door.type === "sealed") return false;
  if (door.type === "keyLock") {
    return door.keyId !== null && actorHasKey(world, actor, door.keyId);
  }
  return world.canPassDoor(door.id);
}

function succeed(
  world: WorldMutator,
  input: {
    rooms: string[];
    objects: string[];
    events: WorldEvent[];
  },
): WorldActionResult {
  world.bumpRevision();
  return {
    ok: true,
    refusal: null,
    affectedRooms: [...new Set(input.rooms)],
    affectedObjects: [...new Set(input.objects)],
    events: input.events,
  };
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => !!value);
}
