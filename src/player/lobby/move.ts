/**
 * Walking inside the prep room.
 *
 * The mechanics now live in `src/shared/roomWalk.ts`, which the dream uses too — the
 * lobby was the first hand-authored room and every dream room is built the same way.
 * What stays here is the binding to `LobbyDefinition`, because keeping the lobby off
 * `WorldState` is what stops the cycle and the heartbeat from existing just because
 * the sanitar took a step.
 */

import type { Direction } from "../../shared/roomGrid";
import {
  createWalker,
  updateWalker,
  walkFrame,
  type Walker,
} from "../../shared/roomWalk";
import type { LobbyDefinition } from "./types";

export type LobbyWalker = Walker;

export function createLobbyWalker(definition: LobbyDefinition): LobbyWalker {
  const size = definition.tileSize;
  return createWalker(
    definition.spawn.x * size,
    definition.spawn.y * size,
    definition.spawn.facing as Direction,
  );
}

export function updateLobbyWalker(
  walker: LobbyWalker,
  definition: LobbyDefinition,
  axis: { x: number; y: number },
  deltaSeconds: number,
): void {
  updateWalker(
    walker,
    definition,
    definition.furniture,
    definition.tileSize,
    axis,
    deltaSeconds,
  );
}

export function lobbyWalkFrame(walker: LobbyWalker): number {
  return walkFrame(walker);
}
