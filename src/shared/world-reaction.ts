/**
 * Deterministic pack-script reactions to WorldEvents.
 *
 * A reaction may only read a little state and `dispatch()` more WorldActions through
 * the same executor the player and NPC use. Physical mutation does not live here.
 *
 * Must stay free of DOM and node APIs.
 */

import type { DreamScript, ScriptFlag } from "./pack";
import type {
  WorldAction,
  WorldActionResult,
  WorldEvent,
} from "./world-action";
import { executeWorldAction } from "./world-action-engine";
import type { WorldMutator } from "./world-object";

export type ExecuteWorldAction = typeof executeWorldAction;

/**
 * Narrow host a reaction may use. Pack scripts get the wider ScriptHost at other
 * hooks; `onWorldEvent` is typed against this so a reaction cannot shiftWalls.
 */
export interface WorldReactionHost {
  readonly currentRoomId: string;
  readonly exhaustion: number;
  readonly cycleNumber: number;
  getFlag(key: string): ScriptFlag | undefined;
  setFlag(key: string, value: ScriptFlag): void;
  dispatch(action: WorldAction): WorldActionResult;
}

export function runReactions(
  host: WorldReactionHost,
  events: readonly WorldEvent[],
  scripts: readonly DreamScript[],
): WorldAction[] {
  const dispatched: WorldAction[] = [];
  const recording: WorldReactionHost = {
    get currentRoomId() {
      return host.currentRoomId;
    },
    get exhaustion() {
      return host.exhaustion;
    },
    get cycleNumber() {
      return host.cycleNumber;
    },
    getFlag: (key) => host.getFlag(key),
    setFlag: (key, value) => host.setFlag(key, value),
    dispatch: (action) => {
      dispatched.push(action);
      return host.dispatch(action);
    },
  };
  for (const event of events) {
    for (const script of scripts) {
      script.onWorldEvent?.(recording, event);
    }
  }
  return dispatched;
}

/** Room-script gestures that used to mutate directly; they now wrap dispatch. */
export function physicalGestures(
  dispatch: (action: WorldAction) => WorldActionResult,
): {
  openDoor(doorId: string): WorldActionResult;
  removeProp(propId: string): WorldActionResult;
  closeHotspot(hotspotId: string): WorldActionResult;
} {
  return {
    openDoor: (doorId) => dispatch({ type: "open", targetId: doorId }),
    removeProp: (propId) => dispatch({ type: "take", objectId: propId }),
    closeHotspot: (hotspotId) => dispatch({ type: "close", targetId: hotspotId }),
  };
}

export function isEngineStubResult(result: WorldActionResult): boolean {
  return (
    !result.ok &&
    (result.refusal?.includes("world-action-engine stub") ?? false)
  );
}

/**
 * Stand-in WorldMutator until the engine agent's adapter exists.
 * executeWorldAction's stub ignores it; tests inject a fake executor.
 */
export function placeholderMutator(): WorldMutator {
  return {
    revision: 0,
    objects: [],
    objectById: new Map(),
    keysHeld: new Set(),
    getPlayerPose: () => null,
    setPlayerPose: () => undefined,
    getFigurePose: () => null,
    setFigurePose: () => undefined,
    getDoor: () => null,
    setDoorType: () => undefined,
    canWalk: () => false,
    hasPath: () => false,
    bumpRevision: () => undefined,
  };
}
