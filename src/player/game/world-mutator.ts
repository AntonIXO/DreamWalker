/**
 * Adapt WorldState (plus a player pose that does not live on it) to WorldMutator.
 *
 * The action engine must not import WorldState. This is the write-through
 * surface player, NPC sandbox, and scripts share.
 */

import { cellAt, isWalkableCell } from "../../shared/roomGrid";
import type {
  ActorPose,
  WorldDoorView,
  WorldMutator,
} from "../../shared/world-object";
import {
  findChebyshevPath,
  solidObjectCovers,
} from "../../shared/world-object";
import { canPassDoor, doorDestination, type WorldState } from "./world";

export interface PlayerPoseBinding {
  get(): ActorPose | null;
  set(pose: ActorPose): void;
}

export function staticPlayerPose(pose: ActorPose | null): PlayerPoseBinding {
  let current = pose ? { ...pose } : null;
  return {
    get: () => (current ? { ...current } : null),
    set: (next) => {
      current = { ...next };
    },
  };
}

export function bindWorldMutator(
  world: WorldState,
  player: PlayerPoseBinding,
): WorldMutator {
  const figurePoses = new Map<string, ActorPose>();
  for (const figure of world.figures) {
    figurePoses.set(figure.id, {
      roomId: figure.roomId,
      x: figure.x,
      y: figure.y,
    });
  }

  const doorById = new Map<string, WorldDoorView>();
  for (const id of world.doorById.keys()) {
    if (world.doorById.get(id)?.hidden) continue;
    doorById.set(id, viewOfDoor(world, id));
  }

  const mutator: WorldMutator = {
    get revision() {
      return world.revision;
    },
    set revision(value: number) {
      world.revision = value;
    },
    get objects() {
      return world.objects;
    },
    get objectById() {
      return world.objectById;
    },
    keysHeld: world.keysHeld,
    get figurePoses() {
      figurePoses.clear();
      for (const figure of world.figures) {
        figurePoses.set(figure.id, {
          roomId: figure.roomId,
          x: figure.x,
          y: figure.y,
        });
      }
      return figurePoses;
    },
    get doorById() {
      doorById.clear();
      for (const id of world.doorById.keys())
        if (!world.doorById.get(id)?.hidden)
          doorById.set(id, viewOfDoor(world, id));
      return doorById;
    },
    getPlayerPose: () => {
      const pose = player.get();
      return pose ? { ...pose } : null;
    },
    setPlayerPose: (pose) => {
      player.set(pose);
    },
    getFigurePose: (figureId) => {
      const figure = world.figures.find((entry) => entry.id === figureId);
      if (figure) {
        const pose = { roomId: figure.roomId, x: figure.x, y: figure.y };
        figurePoses.set(figureId, pose);
        return { ...pose };
      }
      figurePoses.delete(figureId);
      return null;
    },
    setFigurePose: (figureId, pose) => {
      const figure = world.figures.find((entry) => entry.id === figureId);
      if (figure) {
        figurePoses.set(figureId, { ...pose });
        figure.roomId = pose.roomId;
        figure.x = pose.x;
        figure.y = pose.y;
        figure.targetX = null;
        figure.targetY = null;
        figure.walking = false;
        figure.revision += 1;
      }
    },
    getDoor: (doorId) => {
      const live = world.doorById.get(doorId);
      if (!live || live.hidden) return null;
      const view = viewOfDoor(world, doorId);
      doorById.set(doorId, view);
      return { ...view };
    },
    setDoorType: (doorId, type) => {
      const door = world.doorById.get(doorId);
      if (!door) return;
      door.type = type as typeof door.type;
      const view = doorById.get(doorId);
      if (view) view.type = type;
      else doorById.set(doorId, viewOfDoor(world, doorId));
    },
    setDoorClosed: (doorId, closed) => {
      const door = world.doorById.get(doorId);
      if (door) door.closed = closed;
    },
    isWalkableTile: (roomId, x, y) => {
      const room = world.roomById.get(roomId);
      if (!room) return false;
      return isWalkableCell(cellAt(room, Math.floor(x), Math.floor(y)));
    },
    roomTileSize: (roomId) => world.roomById.get(roomId)?.tileSize ?? 16,
    canPassDoor: (doorId) => {
      const door = world.doorById.get(doorId);
      if (!door) return false;
      return canPassDoor(world, door);
    },
    canWalk: (roomId, x, y, ignoreObjectId) => {
      const room = world.roomById.get(roomId);
      if (!room) return false;
      // Authored arrivals may sit between tile centres. Only the mask lookup is
      // discrete; keep the actual point for object collision and the final pose.
      if (!isWalkableCell(cellAt(room, Math.floor(x), Math.floor(y))))
        return false;
      return !solidObjectCovers(world.objects, roomId, x, y, ignoreObjectId);
    },
    hasPath: (roomId, from, to, ignoreObjectId) => {
      const room = world.roomById.get(roomId);
      if (!room) return false;
      const sx = Math.round(from.x);
      const sy = Math.round(from.y);
      const path = findChebyshevPath(from, to, (x, y) => {
        if (x === sx && y === sy) return true;
        if (!isWalkableCell(cellAt(room, x, y))) return false;
        return !solidObjectCovers(world.objects, roomId, x, y, ignoreObjectId);
      });
      return path !== null;
    },
    bumpRevision: () => {
      world.revision += 1;
    },
  };

  return mutator;
}

function viewOfDoor(world: WorldState, doorId: string): WorldDoorView {
  const door = world.doorById.get(doorId)!;
  const fromRoomId = world.roomIdByDoorId.get(doorId) ?? "";
  const dest = doorDestination(world, door);
  const destRoom = world.roomById.get(dest.roomId);
  const entry =
    destRoom?.entries.find((candidate) => candidate.id === dest.entryId) ??
    destRoom?.entries[0];
  return {
    closed: door.closed,
    passable: canPassDoor(world, door),
    id: door.id,
    type: door.type,
    fromRoomId,
    toRoomId: dest.roomId,
    x: door.x,
    y: door.y,
    w: door.w,
    h: door.h,
    keyId: door.keyId,
    threshold: door.threshold,
    toX: entry?.x ?? 1,
    toY: entry?.y ?? 1,
  };
}
