/**
 * A dream as code. The player and the tests import a pack; the Lord CLI is not
 * on this path. Secrets (souls, wallet, mnemonic plaintext) stay in `server.ts`
 * of the dream folder and must never be imported from here.
 */

import type { DialogueResult, ExamineResult } from "./ai";
import type { PortraitState } from "./content";
import type { DreamArtifact } from "./dream";
import type { RoomHotspot } from "./room";
import type { WorldEvent } from "./world-action";
import type { WorldReactionHost } from "./world-reaction";

export type ScriptFlag = number | boolean | string;

/**
 * What a room script may do. Implemented by the live session, not by the pack —
 * the pack only names the gestures.
 *
 * Physical object/door changes go through `dispatch`. `removeProp` / `openDoor` /
 * `closeHotspot` remain as compatibility wrappers around that.
 */
export interface ScriptHost extends WorldReactionHost {
  readonly playerX: number;
  readonly playerY: number;
  readonly playerMoving: boolean;
  readonly tileSize: number;
  now(): number;
  addExhaustion(delta: number): void;
  knownClueIds(): readonly string[];
  enterRoom(
    roomId: string,
    entryId: string | null,
    style?: "rift" | "door" | "meta-exit" | "cut",
  ): void;
  placePlayer(entryId: string | null): void;
  closeHotspot(hotspotId: string): void;
  removeProp(propId: string): void;
  retargetRift(doorId: string, toRoomId: string): void;
  openDoor(doorId: string): void;
  /** Mark a clue as seen. Meta-rooms cannot hold interests, so a grabbed object uses this. */
  observeClue(clueId: string): void;
  hideFigure(figureId: string): void;
  showFigure(figureId: string, roomId: string): void;
  figureInWorld(figureId: string): boolean;
  whisper(text: string): void;
}

export interface DreamScript {
  id: string;
  /** Omit for a run-wide script. */
  roomId?: string;
  onEnter?(host: ScriptHost): void;
  onUpdate?(host: ScriptHost, dt: number): void;
  /** Return true when the script handled the use and the session should stop. */
  onUse?(host: ScriptHost, hotspot: RoomHotspot): boolean;
  /** React to a WorldEvent by dispatching more actions. Read + dispatch only. */
  onWorldEvent?(host: WorldReactionHost, event: WorldEvent): void;
  /** Return false to refuse talk. */
  onApproach?(host: ScriptHost, figureId: string): boolean | void;
  onMemorySpent?(host: ScriptHost): void;
  onCycleReset?(host: ScriptHost): void;
}

export interface FigureTalkContext {
  utterance: string;
  said: string;
  figureId: string;
  figureName: string;
  roomId: string;
  portrait: PortraitState;
  holdsShardId: string | null;
  exhaustion: number;
  cycle: number;
  visitCounts: ReadonlyMap<string, number>;
  offeredMemoryText: string | null;
  leverageOffered: string | null;
  knownClueIds: readonly string[];
  knownShardIds: readonly string[];
  conversationTurns: number;
  getFlag(key: string): ScriptFlag | undefined;
  setFlag(key: string, value: ScriptFlag): void;
  addExhaustion(delta: number): void;
}

export interface FigureLookContext {
  roomId: string | null;
  hotspotId: string | null;
  interestId: string | null;
  interestName: string | null;
  sensorySeed: string | null;
}

/**
 * Authored behaviour for one figure. Lives in the dream folder, not in the engine.
 * Live dialogue uses the figure's soul.md through the model; `talk` is the offline
 * stand-in for tests, not a fallback the player hears when inference drops.
 */
export interface FigureAi {
  id: string;
  placeholder?: string;
  hideMemoryOffer?: boolean;
  hideLeverage?: boolean;
  skipExhaustionClamp?: boolean;
  talk(ctx: FigureTalkContext): DialogueResult | null;
  look?(ctx: FigureLookContext): ExamineResult | null;
}

export interface DreamPack {
  artifact(): DreamArtifact;
  /** Optional modular material/foliage atlas regions, loaded at boot. */
  sceneAssets?: Readonly<Record<string, string>>;
  scripts: readonly DreamScript[];
  npcs: Readonly<Record<string, FigureAi>>;
}
