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
  getActorEquipment,
  getActorOccupancy,
  findChebyshevPath,
  isActorRef,
  isHeldBy,
  solidObjectCovers,
  MAX_OBJECT_VERB_LENGTH,
  MAX_OBJECT_INSCRIPTION_LENGTH,
  type ActorPose,
  type ActorRef,
  type AnyActor,
  type ObjectAffordance,
  type WorldObjectAlteration,
  type WorldDoorView,
  type WorldMutator,
  type WorldObjectState,
} from "./world-object";
import {
  compilePhysicalProfile,
  effectiveWear,
  validatePhysicalProfile,
} from "./object-profile";
import { BODY_HEIGHT, BODY_WIDTH } from "./roomGrid";

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
  roomTileSize?: (roomId: string) => number;
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
    if (door.hidden) continue;
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
    if (!seed.isWalkableTile(roomId, Math.floor(x), Math.floor(y)))
      return false;
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
    setDoorClosed: (doorId, closed) => {
      const door = doorById.get(doorId);
      if (door) door.closed = closed;
    },
    isWalkableTile: seed.isWalkableTile,
    roomTileSize: seed.roomTileSize ?? (() => 16),
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
  for (const id of world.figurePoses.keys()) {
    const live = world.getFigurePose(id);
    if (live) figurePoses.set(id, { ...live });
  }
  return createWorldMutator({
    revision: world.revision,
    objects: world.objects.map(cloneObject),
    keysHeld: new Set(world.keysHeld),
    playerPose: world.getPlayerPose(),
    figurePoses,
    doors: [...world.doorById.keys()].flatMap((id) => {
      const door = world.getDoor(id);
      return door ? [{ ...door }] : [];
    }),
    isWalkableTile: (roomId, x, y) => world.isWalkableTile(roomId, x, y),
    roomTileSize: (roomId) => world.roomTileSize(roomId),
    canPassDoor: (doorId) => passable.get(doorId) ?? false,
  });
}

export function executeWorldAction(
  world: WorldMutator,
  envelope: WorldActionEnvelope,
): WorldActionResult {
  const { actor, source, action } = envelope;

  if (source === "npc") {
    if (actor.kind !== "figure") {
      return refused("npc actor must be a figure; server wraps figureId");
    }
    if (!NPC_ACTION_TYPES.has(action.type)) {
      return refused("npc cannot perform this action");
    }
  }

  let pose = poseOf(world, actor);
  if (!pose && (source === "script" || source === "sleeper")) {
    pose = poseAtAction(world, action);
  }
  if (!pose) return refused("actor does not exist");

  if (!isActorRef(actor)) {
    if (source !== "script" && source !== "sleeper") {
      return refused("actor does not exist");
    }
    return execAsSystem(world, actor, pose, action);
  }

  if (
    getActorOccupancy(world.objects, actor) &&
    ["moveTo", "approach", "traverseDoor"].includes(action.type)
  )
    return refused("leave the occupied object first");

  switch (action.type) {
    case "approach":
      return execApproach(world, actor, pose, action.objectId);
    case "occupy":
      return execOccupy(world, actor, pose, action.objectId);
    case "leave":
      return execLeave(world, actor, pose);
    case "wear":
      return execWear(world, actor, pose, action.objectId, true);
    case "removeWear":
      return execWear(world, actor, pose, action.objectId, false);
    case "detach":
      return execDetach(world, actor, pose, action.objectId);
    case "empty":
      return execEmpty(world, actor, pose, action.objectId);
    case "moveObject":
      return execMoveObject(world, actor, pose, action);
    case "refineProfile":
      return execRefineProfile(world, actor, pose, action);
    case "requestRole":
      return execRequestRole(world, actor, pose, action);
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
    case "alter":
    case "gesture":
      return execExpressive(world, actor, pose, action);
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
    const held = isHeldBy(object, actor);
    const access =
      requireObjectAccess(world, actor, pose, object)?.refusal ?? null;
    const options: ActionOption[] = [];
    if (access === "out of reach" || access === "no path") {
      const approach = planApproach(world, actor, object.id);
      const size = world.roomTileSize(pose.roomId);
      const pathFits =
        actor.kind !== "player" ||
        approach.path.every((at) => {
          const minX = Math.floor(at.x - BODY_WIDTH / (2 * size));
          const maxX = Math.floor(at.x + (BODY_WIDTH / 2 - 0.001) / size);
          const minY = Math.floor(at.y - BODY_HEIGHT / (2 * size));
          const maxY = Math.floor(at.y + (BODY_HEIGHT / 2 - 0.001) / size);
          for (let y = minY; y <= maxY; y++)
            for (let x = minX; x <= maxX; x++)
              if (!world.canWalk(at.roomId, x, y)) return false;
          return true;
        });
      if (!approach.refusal && approach.path.length > 0 && pathFits)
        options.push({
          action: { type: "approach", objectId: object.id },
          affordance: "move",
          label: "approach",
          refusal: null,
        });
    }
    for (const affordance of object.affordances) {
      // Give chooses a recipient; put chooses a container. Neither has a
      // meaningful self-target in this object's menu.
      if (affordance === "give" || affordance === "put") continue;
      if (affordance === "drop" && !held) continue;
      if (affordance === "take" && held) continue;
      if (affordance === "moveObject") continue; // A destination is selected in words.
      if (affordance === "wear" && (!held || object.state.wornBy)) continue;
      if (
        affordance === "removeWear" &&
        (!object.state.wornBy || !actorsEqual(object.state.wornBy, actor))
      )
        continue;
      if (
        affordance === "leave" &&
        (!object.state.occupancy ||
          !actorsEqual(object.state.occupancy.actor, actor))
      )
        continue;
      if (affordance === "occupy" && object.state.occupancy) continue;
      if (affordance === "detach" && !object.state.attachedTo) continue;
      let refusal = access;
      if (
        (affordance === "take" || affordance === "wear") &&
        object.state.attachedTo
      )
        refusal = "detach the object first";
      if (affordance === "occupy" && object.state.open === false)
        refusal = "container is closed";
      if (["drop", "give", "put"].includes(affordance) && object.state.wornBy)
        refusal = "remove the worn object first";
      if (affordance === "take" && object.location.kind === "held") {
        refusal = "already held";
      } else if (affordance === "take" && object.mobility !== "carryable") {
        refusal = "cannot take this";
      } else if (
        affordance === "use" &&
        object.mobility === "carryable" &&
        !held
      ) {
        refusal = "not held";
      } else if (affordance === "open" && !access && object.state.locked) {
        if (!object.keyId || !actorHasKey(world, actor, object.keyId)) {
          refusal = object.interaction?.refusal ?? "locked";
        }
      } else if (affordance === "drop" && !dropAtFeet(world, pose, object)) {
        refusal = "no space";
      } else if (affordance === "traverse") {
        const door = world.getDoor(object.id);
        refusal = door
          ? (requireDoorAccess(world, pose, door)?.refusal ?? null)
          : "no such object";
      }
      options.push({
        action: actionForAffordance(affordance, object),
        affordance,
        label: object.interaction?.prompt || object.name,
        refusal,
      });
    }
    if (object.profile && !access) {
      const outfit = getActorEquipment(world.objects, actor).find(
        (item) => effectiveWear(item.profile)?.slot === "body",
      );
      const roleId = effectiveWear(outfit?.profile)?.appearanceFigureId;
      const intent =
        roleId === "hudozhnik"
          ? "gather"
          : roleId === "lysyi"
            ? "inspect"
            : roleId === "ded-slava"
              ? "helpMove"
              : null;
      if (intent)
        options.push({
          action: { type: "requestRole", intent, objectId: object.id },
          affordance: "use",
          label: intent,
          refusal: null,
        });
    }
    if (isContainer(object)) {
      for (const item of world.objects) {
        if (
          !isHeldBy(item, actor) ||
          !item.affordances.includes("put") ||
          item.id === object.id
        )
          continue;
        options.push({
          action: { type: "put", objectId: item.id, intoObjectId: object.id },
          affordance: "put",
          label: item.name,
          refusal:
            requirePutTarget(world, actor, pose, item, object)?.refusal ?? null,
        });
      }
    }
    return options;
  }

  if (target.kind === "door") {
    const door = world.getDoor(target.id);
    if (!door) return [];
    const access = requireDoorAccess(world, pose, door)?.refusal ?? null;
    const policy =
      door.type === "sealed"
        ? "sealed"
        : mayPassDoor(world, actor, door)
          ? null
          : "locked";
    return [
      {
        action: { type: "open", targetId: door.id },
        affordance: "open",
        label: "open",
        refusal: access ?? policy,
      },
      {
        action: { type: "close", targetId: door.id },
        affordance: "close",
        label: "close",
        refusal: access ?? (door.type === "sealed" ? "sealed" : null),
      },
      {
        action: { type: "traverseDoor", doorId: door.id },
        affordance: "traverse",
        label: "go through",
        refusal:
          access ??
          policy ??
          (world.canWalk(door.toRoomId, door.toX, door.toY)
            ? null
            : "blocked arrival"),
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

  const recipient: ActorRef = { kind: "figure", id: target.id };
  const refusal =
    requireGiveTarget(world, actor, pose, recipient)?.refusal ?? null;
  return world.objects
    .filter(
      (object) =>
        isHeldBy(object, actor) && object.affordances.includes("give"),
    )
    .map((object) => ({
      action: { type: "give", objectId: object.id, to: recipient },
      affordance: "give",
      label: object.name,
      refusal,
    }));
}

function actionForAffordance(
  affordance: Exclude<ObjectAffordance, "give" | "put">,
  object: WorldObjectState,
): ActionOption["action"] {
  switch (affordance) {
    case "examine":
      return { type: "examine", objectId: object.id };
    case "take":
      return { type: "take", objectId: object.id };
    case "drop":
      return { type: "drop", objectId: object.id };
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
    case "leave":
      return { type: "leave" };
    case "wear":
    case "removeWear":
    case "occupy":
    case "detach":
    case "empty":
      return { type: affordance, objectId: object.id };
    default:
      return { type: "use", objectId: object.id };
  }
}

/** A bounded, same-room approach. Returned poses exclude the starting tile. */
export function planApproach(
  world: WorldMutator,
  actor: ActorRef,
  objectId: string,
): { path: ActorPose[]; refusal: string | null } {
  const pose = poseOf(world, actor);
  const object = world.objectById.get(objectId);
  if (!pose || !object) return { path: [], refusal: "no such object" };
  if (getActorOccupancy(world.objects, actor))
    return { path: [], refusal: "leave the occupied object first" };
  if (!requireObjectAccess(world, actor, pose, object))
    return { path: [], refusal: null };
  if (object.location.kind !== "room" || object.location.roomId !== pose.roomId)
    return { path: [], refusal: "different room" };
  const candidates: Array<{ x: number; y: number }> = [];
  for (
    let y = Math.floor(object.location.y) - 2;
    y <= object.location.y + (object.body?.h ?? 1) + 2;
    y++
  ) {
    for (
      let x = Math.floor(object.location.x) - 2;
      x <= object.location.x + (object.body?.w ?? 1) + 2;
      x++
    ) {
      if (
        Math.max(Math.abs(x - pose.x), Math.abs(y - pose.y)) <= 8 &&
        world.canWalk(pose.roomId, x, y) &&
        inReachOfObject({ ...pose, x, y }, object)
      )
        candidates.push({ x, y });
    }
  }
  let best: Array<{ x: number; y: number }> | null = null;
  for (const destination of candidates) {
    const path = findChebyshevPath(pose, destination, (x, y) =>
      world.canWalk(pose.roomId, x, y),
    );
    if (path && path.length <= 8 && (!best || path.length < best.length))
      best = path;
  }
  return best
    ? {
        path: best.map((at) => ({ ...at, roomId: pose.roomId })),
        refusal: null,
      }
    : { path: [], refusal: "no nearby path" };
}

function execApproach(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const plan = planApproach(world, actor, objectId);
  if (plan.refusal) return refused(plan.refusal);
  const end = plan.path.at(-1) ?? pose;
  setPose(world, actor, end);
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [],
    events: [{ type: "actor.moved", actor, ...end }],
  });
}

function execOccupy(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  const block =
    requireAffordance(object, "occupy") ??
    requireObjectAccess(world, actor, pose, object);
  if (block) return block;
  if (!object.profile?.occupancy || object.location.kind !== "room")
    return refused("no supported place for a body");
  if (object.state.open === false) return refused("container is closed");
  if (object.state.occupancy || getActorOccupancy(world.objects, actor))
    return refused("already occupied");
  const slot = object.profile.occupancy;
  if (
    (slot.x !== undefined && slot.x > (object.body?.w ?? 1)) ||
    (slot.y !== undefined && slot.y > (object.body?.h ?? 1))
  )
    return refused("occupancy slot is outside object");
  const x = object.location.x + (slot.x ?? (object.body?.w ?? 1) / 2);
  const y = object.location.y + (slot.y ?? (object.body?.h ?? 1) / 2);
  if (!world.canWalk(pose.roomId, x, y, object.id)) return refused("blocked");
  object.state.occupancy = {
    actor: { ...actor },
    pose: slot.pose,
    returnPose: { ...pose },
  };
  setPose(world, actor, { roomId: pose.roomId, x, y });
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: "actor.occupied", actor, objectId }],
  });
}

function execLeave(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
): WorldActionResult {
  const object = getActorOccupancy(world.objects, actor);
  if (!object?.state.occupancy || object.location.kind !== "room")
    return refused("not occupying an object");
  const original = object.state.occupancy.returnPose;
  const candidates: ActorPose[] =
    original.roomId === pose.roomId ? [{ ...original }] : [];
  const left = Math.floor(object.location.x),
    top = Math.floor(object.location.y);
  for (let y = top - 1; y <= top + (object.body?.h ?? 1); y++)
    for (let x = left - 1; x <= left + (object.body?.w ?? 1); x++)
      candidates.push({ roomId: pose.roomId, x, y });
  const exit = candidates.find(
    (at) =>
      world.canWalk(at.roomId, at.x, at.y) &&
      world.hasPath(pose.roomId, pose, at, object.id),
  );
  if (!exit) return refused("no space to leave");
  const events: WorldEvent[] = [];
  // Occupancy is never a lock trap: opening from inside is part of leaving.
  if (object.state.open === false) {
    object.state.open = true;
    events.push({ type: "object.opened", objectId: object.id, actor });
  }
  object.state.occupancy = null;
  setPose(world, actor, exit);
  events.push({ type: "actor.left", actor, objectId: object.id });
  return succeed(world, { rooms: [pose.roomId], objects: [object.id], events });
}

function execWear(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
  wear: boolean,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, wear ? "wear" : "removeWear");
  if (blocked) return blocked;
  if (!isHeldBy(object, actor)) return refused("not held");
  const slot = effectiveWear(object.profile)?.slot;
  if (!slot) return refused("not wearable");
  if (wear) {
    if (object.state.attachedTo) return refused("detach the object first");
    if (
      getActorEquipment(world.objects, actor).some(
        (item) => effectiveWear(item.profile)?.slot === slot,
      )
    )
      return refused("wear slot occupied");
    object.state.wornBy = { ...actor };
  } else {
    if (!object.state.wornBy || !actorsEqual(object.state.wornBy, actor))
      return refused("not worn");
    object.state.wornBy = null;
  }
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: wear ? "object.worn" : "object.unworn", objectId, actor }],
  });
}

function execDetach(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  const blocked =
    requireAffordance(object, "detach") ??
    requireObjectAccess(world, actor, pose, object);
  if (blocked) return blocked;
  if (!object.profile?.attachment?.detachable || !object.state.attachedTo)
    return refused("no detachable attachment");
  const fromObjectId = object.state.attachedTo;
  object.state.attachedTo = null;
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [objectId],
    events: [{ type: "object.detached", objectId, fromObjectId, actor }],
  });
}

function execMoveObject(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: Extract<WorldAction, { type: "moveObject" }>,
): WorldActionResult {
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  const block =
    requireAffordance(object, "moveObject") ??
    requireObjectAccess(world, actor, pose, object);
  if (block) return block;
  if (object.mobility !== "movable" || object.location.kind !== "room")
    return refused("not movable furniture");
  if (object.state.attachedTo) return refused("detach the object first");
  if (object.state.occupancy) return refused("object is occupied");
  const x = Math.round(action.x),
    y = Math.round(action.y);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.max(Math.abs(x - object.location.x), Math.abs(y - object.location.y)) >
      4
  )
    return refused("move is too far");
  if (x === object.location.x && y === object.location.y)
    return refused("already there");
  if (actorBlocksPlacement(world, pose.roomId, object, x, y))
    return refused("actor blocks destination");
  const path = findChebyshevPath(
    object.location,
    { x, y },
    (px, py) =>
      canPlaceObject(world, pose.roomId, object, px, py) &&
      !actorBlocksPlacement(world, pose.roomId, object, px, py),
  );
  if (!path || path.length > 4) return refused("no path");
  object.location = { kind: "room", roomId: pose.roomId, x, y };
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [
      {
        type: "object.relocated",
        objectId: object.id,
        actor,
        roomId: pose.roomId,
        x,
        y,
      },
    ],
  });
}

function execEmpty(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  const blocked =
    requireAffordance(object, "empty") ??
    requireObjectAccess(world, actor, pose, object);
  if (blocked) return blocked;
  if (object.state.open !== true) return refused("container is closed");
  const children = world.objects.filter(
    (item) =>
      item.location.kind === "inside" && item.location.objectId === objectId,
  );
  if (!children.length) return refused("container is empty");
  if (children.length > 16)
    return refused("too many objects to empty together");
  const staged = cloneWorldMutator(world);
  const events: WorldEvent[] = [];
  for (const child of children) {
    const copy = staged.objectById.get(child.id)!;
    if (copy.state.attachedTo || copy.state.occupancy)
      return refused("contents are attached or occupied");
    const target = dropAtFeet(staged, pose, copy);
    if (!target) return refused("no space");
    copy.location = { kind: "room", roomId: pose.roomId, ...target };
    events.push({
      type: "object.dropped",
      objectId: copy.id,
      actor,
      roomId: pose.roomId,
      ...target,
    });
  }
  for (const child of children) {
    child.location = { ...staged.objectById.get(child.id)!.location };
    syncKeyPossession(world, child);
  }
  events.push({
    type: "object.emptied",
    objectId,
    objectIds: children.map((child) => child.id),
    actor,
  });
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [objectId, ...children.map((child) => child.id)],
    events,
  });
}

function execRefineProfile(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: Extract<WorldAction, { type: "refineProfile" }>,
): WorldActionResult {
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;
  if (object.profile || object.interaction?.refusal)
    return refused("authored profile cannot be overridden");
  if (
    validatePhysicalProfile(action.profile).length ||
    action.profile.attachment ||
    action.profile.wear?.appearanceFigureId
  )
    return refused("invalid profile refinement");
  const compiled = compilePhysicalProfile(action.profile);
  object.profile = structuredClone(action.profile);
  object.mobility = compiled.mobility;
  object.affordances = [
    ...new Set([...object.affordances, ...compiled.affordances]),
  ];
  object.tags = [...new Set([...object.tags, ...compiled.tags])];
  object.state = { ...compiled.state, ...object.state };
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: "object.profiled", actor, objectId: object.id }],
  });
}

function execRequestRole(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  action: Extract<WorldAction, { type: "requestRole" }>,
): WorldActionResult {
  const outfit = getActorEquipment(world.objects, actor).find(
    (item) => effectiveWear(item.profile)?.slot === "body",
  );
  const roleId = effectiveWear(outfit?.profile)?.appearanceFigureId;
  const expected =
    roleId === "hudozhnik"
      ? "gather"
      : roleId === "lysyi"
        ? "inspect"
        : roleId === "ded-slava"
          ? "helpMove"
          : null;
  if (!expected || expected !== action.intent)
    return refused("this role does not grant that request");
  if (action.objectId) {
    const object = world.objectById.get(action.objectId);
    if (!object) return refused("no such object");
    const blocked = requireObjectAccess(world, actor, pose, object);
    if (blocked) return blocked;
  }
  return succeed(world, {
    rooms: [pose.roomId],
    objects: action.objectId ? [action.objectId] : [],
    events: [
      {
        type: "actor.requested",
        actor,
        intent: action.intent,
        objectId: action.objectId ?? null,
        roleId: roleId!,
      },
    ],
  });
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
  if (object.state.attachedTo) return refused("detach the object first");
  if (object.state.occupancy) return refused("object is occupied");
  if (isHeldBy(object, actor)) return refused("already held");
  if (object.location.kind === "held") return refused("already held");
  const blocked = requireAffordance(object, "take");
  if (blocked) return blocked;
  if (object.mobility !== "carryable") return refused("cannot take this");

  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;

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
  if (world.objectById.get(action.objectId)?.state.wornBy)
    return refused("remove the worn object first");
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  if (!isHeldBy(object, actor)) return refused("not held");
  const blocked = requireAffordance(object, "drop");
  if (blocked) return blocked;

  let dest: { x: number; y: number } | null;
  if (action.x !== undefined && action.y !== undefined) {
    dest = { x: Math.round(action.x), y: Math.round(action.y) };
    if (Math.hypot(dest.x - pose.x, dest.y - pose.y) > DEFAULT_REACH) {
      return refused("out of reach");
    }
    if (!world.hasPath(pose.roomId, pose, dest, object.id)) {
      return refused("no path");
    }
    if (!canPlaceObject(world, pose.roomId, object, dest.x, dest.y)) {
      return refused("blocked");
    }
  } else {
    dest = dropAtFeet(world, pose, object);
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
  if (world.objectById.get(action.objectId)?.state.wornBy)
    return refused("remove the worn object first");
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  if (!isHeldBy(object, actor)) return refused("not held");
  const blocked = requireAffordance(object, "give");
  if (blocked) return blocked;
  const inaccessible = requireGiveTarget(world, actor, pose, action.to);
  if (inaccessible) return inaccessible;

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
  if (world.objectById.get(action.objectId)?.state.wornBy)
    return refused("remove the worn object first");
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  const container = world.objectById.get(action.intoObjectId);
  if (!container) return refused("no such object");
  if (!isHeldBy(object, actor)) return refused("not held");
  const blocked = requireAffordance(object, "put");
  if (blocked) return blocked;
  const inaccessible = requirePutTarget(world, actor, pose, object, container);
  if (inaccessible) return inaccessible;

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
  actor: AnyActor,
  pose: ActorPose,
  targetId: string,
): WorldActionResult {
  const door = world.getDoor(targetId);
  if (door) return execOpenDoor(world, actor, pose, door);
  const object = world.objectById.get(targetId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, "open");
  if (blocked) return blocked;
  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;
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
  actor: AnyActor,
  pose: ActorPose,
  targetId: string,
): WorldActionResult {
  const door = world.getDoor(targetId);
  if (door) return execCloseDoor(world, actor, pose, door);
  const object = world.objectById.get(targetId);
  if (!object) return refused("no such object");
  const blocked = requireAffordance(object, "close");
  if (blocked) return blocked;
  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;
  object.state.open = false;
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [{ type: "object.closed", objectId: object.id, actor }],
  });
}

function execOpenDoor(
  world: WorldMutator,
  actor: AnyActor,
  pose: ActorPose,
  door: WorldDoorView,
): WorldActionResult {
  const inaccessible = requireDoorAccess(world, pose, door);
  if (inaccessible) return inaccessible;
  // Sealed doors are sleeper-only; patch.ts openDoor restores sealHistory.
  if (door.type === "sealed") return refused("sealed");
  if (door.type === "keyLock") {
    if (!door.keyId || !actorHasKey(world, actor, door.keyId)) {
      return refused("locked");
    }
  } else if (door.type === "leverLock" || door.type === "puzzleLock") {
    if (!world.canPassDoor(door.id)) return refused("locked");
  }
  world.setDoorClosed(door.id, false);
  return succeed(world, {
    rooms: compact([door.fromRoomId, door.toRoomId]),
    objects: [],
    events: [{ type: "door.opened", doorId: door.id, actor }],
  });
}

function execCloseDoor(
  world: WorldMutator,
  actor: AnyActor,
  pose: ActorPose,
  door: WorldDoorView,
): WorldActionResult {
  const inaccessible = requireDoorAccess(world, pose, door);
  if (inaccessible) return inaccessible;
  if (door.type === "sealed") return refused("sealed");
  world.setDoorClosed(door.id, true);
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
  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;
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
  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;

  if (action.targetId) {
    const targetObject = world.objectById.get(action.targetId);
    const targetDoor = world.getDoor(action.targetId);
    if (!targetObject && !targetDoor) return refused("no such object");
    const inaccessibleTarget = targetObject
      ? requireObjectAccess(world, actor, pose, targetObject)
      : requireDoorAccess(world, pose, targetDoor!);
    if (inaccessibleTarget) return inaccessibleTarget;
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

/** Interpret bounded physical deltas; never let narrative text mutate structure. */
function execExpressive(
  world: WorldMutator,
  actor: AnyActor,
  pose: ActorPose,
  action: Extract<WorldAction, { type: "alter" | "gesture" }>,
): WorldActionResult {
  if (
    typeof action.verb !== "string" ||
    action.verb.trim().length === 0 ||
    action.verb.length > MAX_OBJECT_VERB_LENGTH
  )
    return refused("invalid interaction text");
  const verb = action.verb.trim();
  const object = world.objectById.get(action.objectId);
  if (!object) return refused("no such object");
  const inaccessible = requireObjectAccess(world, actor, pose, object);
  if (inaccessible) return inaccessible;
  if (object.interaction?.refusal) return refused(object.interaction.refusal);
  if (action.targetId !== undefined) {
    const targetObject = world.objectById.get(action.targetId);
    const targetDoor = world.getDoor(action.targetId);
    if (!targetObject && !targetDoor) return refused("no such object");
    const targetAccess = targetObject
      ? requireObjectAccess(world, actor, pose, targetObject)
      : requireDoorAccess(world, pose, targetDoor!);
    if (targetAccess) return targetAccess;
    if (targetObject?.interaction?.refusal)
      return refused(targetObject.interaction.refusal);
  }
  if (action.type === "gesture") {
    return succeed(world, {
      rooms: [pose.roomId],
      objects: [object.id],
      events: [
        {
          type: "object.gestured",
          objectId: object.id,
          targetId: action.targetId ?? null,
          actor,
          verb,
          effect: "none",
        },
      ],
    });
  }
  const raw = action.changes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return refused("invalid physical changes");
  const allowed = new Set(["broken", "wet", "dirty", "inscription"]);
  if (Object.keys(raw).some((key) => !allowed.has(key)))
    return refused("unsupported physical change");
  const changes: WorldObjectAlteration = {};
  if (raw.broken !== undefined) {
    if (raw.broken !== true) return refused("cannot repair this");
    if (object.mobility === "fixed")
      return refused("cannot break a fixed object");
    changes.broken = true;
  }
  for (const key of ["wet", "dirty"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean")
      return refused("invalid physical changes");
    changes[key] = raw[key];
  }
  if (raw.inscription !== undefined) {
    if (
      typeof raw.inscription !== "string" ||
      raw.inscription.length > MAX_OBJECT_INSCRIPTION_LENGTH
    ) {
      return refused("invalid inscription");
    }
    changes.inscription = raw.inscription;
  }
  if (Object.keys(changes).length === 0)
    return refused("no physical change requested");
  if (
    Object.entries(changes).every(
      ([key, value]) =>
        object.state[key as keyof WorldObjectAlteration] === value,
    )
  ) {
    return refused("already in that state");
  }
  const before = { ...object.state };
  Object.assign(object.state, changes);
  return succeed(world, {
    rooms: [pose.roomId],
    objects: [object.id],
    events: [
      {
        type: "object.changed",
        objectId: object.id,
        targetId: action.targetId ?? null,
        actor,
        verb,
        before,
        after: { ...object.state },
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
  const inaccessible = requireDoorAccess(world, pose, door);
  if (inaccessible) return inaccessible;
  if (!mayPassDoor(world, actor, door)) return refused("locked");
  if (!world.canWalk(door.toRoomId, door.toX, door.toY)) {
    return refused("blocked arrival");
  }

  world.setDoorClosed(door.id, false);
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

function poseAtAction(
  world: WorldMutator,
  action: WorldAction,
): ActorPose | null {
  if (action.type === "moveTo") {
    return {
      roomId: action.roomId ?? world.getPlayerPose()?.roomId ?? "",
      x: action.x,
      y: action.y,
    };
  }
  const id =
    action.type === "alter" || action.type === "gesture"
      ? action.objectId
      : "targetId" in action
        ? action.targetId
        : "objectId" in action
          ? action.objectId
          : "doorId" in action
            ? action.doorId
            : null;
  if (!id) return world.getPlayerPose();
  const door = world.getDoor(id);
  if (door) return { roomId: door.fromRoomId, x: door.x, y: door.y };
  const object = world.objectById.get(id);
  if (object?.location.kind === "room") {
    return {
      roomId: object.location.roomId,
      x: object.location.x,
      y: object.location.y,
    };
  }
  return world.getPlayerPose();
}

function execAsSystem(
  world: WorldMutator,
  actor: AnyActor,
  pose: ActorPose,
  action: WorldAction,
): WorldActionResult {
  switch (action.type) {
    case "open": {
      const door = world.getDoor(action.targetId);
      if (actor.kind === "script" && door?.type === "sealed") {
        world.setDoorType(door.id, "open");
        world.setDoorClosed(door.id, false);
        return succeed(world, {
          rooms: [door.fromRoomId, door.toRoomId],
          objects: [],
          events: [{ type: "door.opened", doorId: door.id, actor }],
        });
      }
      return execOpen(world, actor, pose, action.targetId);
    }
    case "close":
      return execClose(world, actor, pose, action.targetId);
    case "take":
      return execSystemTake(world, actor, pose, action.objectId);
    case "alter":
    case "gesture":
      return actor.kind === "script"
        ? execExpressive(world, actor, pose, action)
        : refused("system actor cannot perform this action");
    default:
      return refused("system actor cannot perform this action");
  }
}

function execSystemTake(
  world: WorldMutator,
  actor: AnyActor,
  pose: ActorPose,
  objectId: string,
): WorldActionResult {
  const object = world.objectById.get(objectId);
  if (!object) return refused("no such object");
  if (object.state.occupancy) return refused("object is occupied");
  if (object.location.kind === "removed") return refused("already gone");
  const fromRoomId =
    object.location.kind === "room" ? object.location.roomId : pose.roomId;
  object.location = { kind: "removed" };
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

function requireGiveTarget(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  recipient: ActorRef,
): WorldActionResult | null {
  if (actorsEqual(actor, recipient)) return refused("already held");
  const toPose = poseOf(world, recipient);
  if (!toPose) return refused("actor does not exist");
  if (toPose.roomId !== pose.roomId) return refused("different room");
  if (Math.hypot(pose.x - toPose.x, pose.y - toPose.y) > DEFAULT_REACH) {
    return refused("out of reach");
  }
  return world.hasPath(pose.roomId, pose, toPose) ? null : refused("no path");
}

function requirePutTarget(
  world: WorldMutator,
  actor: ActorRef,
  pose: ActorPose,
  object: WorldObjectState,
  container: WorldObjectState,
): WorldActionResult | null {
  if (!isContainer(container)) return refused("not a container");
  if (container.state.open !== true) return refused("container is closed");
  const ancestry = new Set<string>();
  let ancestor: WorldObjectState | undefined = container;
  while (ancestor) {
    if (ancestor.id === object.id || ancestry.has(ancestor.id)) {
      return refused("circular containment");
    }
    ancestry.add(ancestor.id);
    ancestor =
      ancestor.location.kind === "inside"
        ? world.objectById.get(ancestor.location.objectId)
        : undefined;
  }
  return requireObjectAccess(world, actor, pose, container);
}

/** Resolve every container boundary before allowing an embodied interaction. */
function requireObjectAccess(
  world: WorldMutator,
  actor: AnyActor,
  pose: ActorPose,
  object: WorldObjectState,
): WorldActionResult | null {
  const visited = new Set<string>();
  let current = object;
  while (true) {
    if (visited.has(current.id)) return refused("circular containment");
    visited.add(current.id);
    switch (current.location.kind) {
      case "removed":
        return refused("already gone");
      case "held":
        return isActorRef(actor) && isHeldBy(current, actor)
          ? null
          : refused("not held");
      case "inside": {
        const parent = world.objectById.get(current.location.objectId);
        if (!parent) return refused("no such object");
        if (parent.state.open !== true) return refused("container is closed");
        current = parent;
        break;
      }
      case "room":
        if (current.location.roomId !== pose.roomId) {
          return refused("different room");
        }
        if (!inReachOfObject(pose, current)) return refused("out of reach");
        return hasObjectApproach(world, pose, current)
          ? null
          : refused("no path");
    }
  }
}

function hasObjectApproach(
  world: WorldMutator,
  pose: ActorPose,
  object: WorldObjectState,
): boolean {
  if (object.location.kind !== "room") return false;
  if (world.hasPath(pose.roomId, pose, tileOf(object.location), object.id))
    return true;
  if (!object.body) return false;
  // A prop can start on a wall (a window, for example). Its authored
  // footprint may still be reachable from the floor along another edge.
  const left = Math.floor(object.location.x);
  const top = Math.floor(object.location.y);
  for (let y = top - 1; y <= top + object.body.h; y += 1) {
    for (let x = left - 1; x <= left + object.body.w; x += 1) {
      const withinX = x >= left && x < left + object.body.w;
      const withinY = y >= top && y < top + object.body.h;
      if (!withinX && !withinY) continue;
      if (
        world.canWalk(pose.roomId, x, y) &&
        world.hasPath(pose.roomId, pose, { x, y })
      )
        return true;
    }
  }
  return false;
}

/** Wall thresholds are entered from an adjacent floor tile, never punched open. */
function requireDoorAccess(
  world: WorldMutator,
  pose: ActorPose,
  door: WorldDoorView,
): WorldActionResult | null {
  if (door.fromRoomId !== pose.roomId) return refused("different room");
  if (!inReachOfDoor(pose, door)) return refused("out of reach");
  for (let y = door.y - 1; y <= door.y + door.h; y += 1) {
    for (let x = door.x - 1; x <= door.x + door.w; x += 1) {
      const withinX = x >= door.x && x < door.x + door.w;
      const withinY = y >= door.y && y < door.y + door.h;
      if (!withinX && !withinY) continue;
      if (Math.hypot(x - pose.x, y - pose.y) > DEFAULT_REACH) continue;
      if (
        world.canWalk(pose.roomId, x, y) &&
        world.hasPath(pose.roomId, pose, { x, y })
      ) {
        return null;
      }
    }
  }
  return refused("no path");
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
  if (px >= rx && px < rx + rw && py >= ry && py < ry + rh) {
    return 0;
  }
  return Math.hypot(dx, dy);
}

function tileOf(location: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(location.x), y: Math.round(location.y) };
}

function canPlaceObject(
  world: WorldMutator,
  roomId: string,
  object: WorldObjectState,
  x: number,
  y: number,
): boolean {
  const width = object.body?.w ?? 1;
  const height = object.body?.h ?? 1;
  if (object.body?.solid && actorBlocksPlacement(world, roomId, object, x, y))
    return false;
  if (
    object.body?.solid &&
    world.objects.some((item) => {
      const exit = item.state.occupancy?.returnPose;
      return (
        exit?.roomId === roomId &&
        exit.x >= x &&
        exit.x < x + width &&
        exit.y >= y &&
        exit.y < y + height
      );
    })
  )
    return false;
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      if (!world.canWalk(roomId, x + dx, y + dy, object.id)) return false;
    }
  }
  return true;
}

/** Solid items cannot be put beneath a body, nor furniture swept through one. */
function actorBlocksPlacement(
  world: WorldMutator,
  roomId: string,
  object: WorldObjectState,
  x: number,
  y: number,
): boolean {
  const player = world.getPlayerPose();
  const actors = [...world.figurePoses.values()];
  if (player?.roomId === roomId) {
    const size = world.roomTileSize(roomId);
    const halfWidth = BODY_WIDTH / (2 * size);
    const halfHeight = BODY_HEIGHT / (2 * size);
    if (
      player.x + halfWidth > x &&
      player.x - halfWidth < x + (object.body?.w ?? 1) &&
      player.y + halfHeight > y &&
      player.y - halfHeight < y + (object.body?.h ?? 1)
    )
      return true;
  }
  return actors.some(
    (at) =>
      at.roomId === roomId &&
      at.x >= x &&
      at.x < x + (object.body?.w ?? 1) &&
      at.y >= y &&
      at.y < y + (object.body?.h ?? 1),
  );
}

function dropAtFeet(
  world: WorldMutator,
  pose: ActorPose,
  object: WorldObjectState,
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
    if (Math.hypot(tx - pose.x, ty - pose.y) > DEFAULT_REACH) continue;
    if (
      canPlaceObject(world, pose.roomId, object, tx, ty) &&
      world.hasPath(pose.roomId, pose, { x: tx, y: ty }, object.id)
    ) {
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
  actor: AnyActor,
  keyId: string,
): boolean {
  if (!isActorRef(actor)) return false;
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
