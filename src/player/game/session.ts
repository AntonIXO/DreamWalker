/**
 * Walking the dream: which room we are in, and what happens when we leave it.
 *
 * This is the piece format 3 kept inline in `main.ts` as a nine-line warp block. It grew
 * because rooms are discrete now and there are three different ways out of one — a
 * threshold, a timer, and the sleeper moving something while you were not looking.
 *
 * Touching a thing used to be a fourth: LSD: Dream Emulator's linking. That, and the
 * rift wall that replaced it, are gone. Rooms sit on a street grid; a door on the east
 * wall is the room to the east. Poking the world is a safe channel again.
 */

import type { RoomHotspot } from "../../shared/room";
import type { DreamScript, ScriptHost } from "../../shared/pack";
import { makeRng } from "../../shared/rng";
import type { WorldAction, WorldActionResult } from "../../shared/world-action";
import { MAX_WORLD_ACTIONS_PER_TURN } from "../../shared/world-action";
import { executeWorldAction } from "../../shared/world-action-engine";
import { runReactions } from "../../shared/world-reaction";
import { bindWorldMutator } from "./world-mutator";
import { FOLLOW_VIEW_TILES, type Camera } from "../render/camera";
import type { RoomScene } from "../render/roomScene";
import type { Shiver } from "../render/shiver";
import {
  isStreetWorld,
  roomContainingPlayer,
  streetRoomsToShow,
  toLocalPixels,
  worldBounds,
} from "../../shared/street";
import { findHotspot } from "../../shared/roomGrid";
import { findTarget, reachableHotspots, type InteractTarget } from "./interact";
import { escortFigure } from "./figures";
import { whoIsLed } from "./fates";
import { applyPatch } from "./patch";
import {
  createPlayer,
  placeAtEntry,
  playerTile,
  updatePlayer,
  type PlayerState,
} from "./player";
import {
  addExhaustion,
  cloneFigureState,
  currentRoom,
  doorDestination,
  noteVisit,
  setWorldFlag,
  visitCount,
  worldFlag,
  type RoomState,
  type WorldState,
} from "./world";

/** How the arrival should feel. A door is continuous; a rift is not. */
export type ArrivalStyle = "door" | "rift" | "meta-exit" | "cut";

export interface SessionCallbacks {
  onEnterRoom(room: RoomState, visits: number): void;
  onRefused(doorId: string, text: string): void;
  whisper?(text: string): void;
  cycleNumber?(): number;
  knownClueIds?(): readonly string[];
  observeClue?(clueId: string): void;
}

interface MetaVisit {
  roomId: string;
  remainingMs: number;
  returnTo: { roomId: string; entryId: string | null };
}

export class DreamSession {
  player: PlayerState;

  private meta: MetaVisit | null = null;
  private dwellMs = new Map<string, number>();
  private transitioning = false;

  constructor(
    private readonly world: WorldState,
    private readonly scene: RoomScene,
    private readonly camera: Camera,
    private readonly shiver: Shiver,
    private readonly callbacks: SessionCallbacks,
    private readonly transition?: { play(): Promise<void> },
    private readonly scripts: readonly DreamScript[] = [],
  ) {
    const room = currentRoom(world);
    this.player = createPlayer(room, world.artifact.spawn.entryId);
    this.showRoom(room);
    noteVisit(world, room.id);
    this.runScripts("enter");
  }

  get room(): RoomState {
    return currentRoom(this.world);
  }

  get inMetaSpace(): boolean {
    return this.meta !== null;
  }

  /** Whatever the sanitar could press E on right now. */
  target(): InteractTarget | null {
    return findTarget(this.world, this.room, this.player);
  }

  update(axis: { x: number; y: number }, deltaSeconds: number): void {
    if (this.transitioning) return;
    const room = this.room;

    updatePlayer(this.player, room, this.world, axis, deltaSeconds);

    if (this.player.refusedDoorId) {
      const door = this.world.doorById.get(this.player.refusedDoorId);
      if (door) {
        this.callbacks.onRefused(door.id, door.prompt ?? "Не открывается.");
      }
    }

    if (this.player.enteredDoorId) {
      const door = this.world.doorById.get(this.player.enteredDoorId);
      if (door) {
        const to = doorDestination(this.world, door);
        void this.enterRoom(
          to.roomId,
          to.entryId,
          door.threshold === "rift" ? "rift" : "door",
        );
        return;
      }
    }

    this.crossStreet();

    this.tickDwell(this.room, deltaSeconds);
    this.tickMeta(deltaSeconds);
    this.runScripts("update", deltaSeconds);
  }

  /**
   * Objects that go off by themselves if you stand near them long enough.
   *
   * §12's тётя is the case this exists for: sitting behind her for ninety seconds is
   * worth (−7, −7), and the player has to *choose* to spend the time. A cost you pay in
   * patience rather than in risk is the only kind that room has.
   */
  private tickDwell(room: RoomState, deltaSeconds: number): void {
    const moving = this.player.moving;
    for (const hotspot of room.hotspots) {
      if (hotspot.dwellMs === null || room.closedHotspotIds.has(hotspot.id)) {
        continue;
      }
      const local = toLocalPixels(room, this.player.x, this.player.y);
      const near =
        !moving &&
        Math.hypot(
          hotspot.x * room.tileSize - local.x,
          hotspot.y * room.tileSize - local.y,
        ) <=
          hotspot.reach * room.tileSize;
      if (!near) {
        this.dwellMs.delete(hotspot.id);
        continue;
      }
      const elapsed = (this.dwellMs.get(hotspot.id) ?? 0) + deltaSeconds * 1000;
      if (elapsed < hotspot.dwellMs) {
        this.dwellMs.set(hotspot.id, elapsed);
        continue;
      }
      this.dwellMs.delete(hotspot.id);
      this.fire(hotspot);
    }
  }

  private tickMeta(deltaSeconds: number): void {
    if (!this.meta) return;
    this.meta.remainingMs -= deltaSeconds * 1000;
    if (this.meta.remainingMs > 0) return;
    const { returnTo } = this.meta;
    this.meta = null;
    void this.enterRoom(returnTo.roomId, returnTo.entryId, "meta-exit");
  }

  /** The player pressed E on something. True when a pack script consumed it. */
  use(hotspot: RoomHotspot): boolean {
    const host = this.host();
    const scripts = this.scriptsFor(this.room.id);
    for (const script of scripts) {
      if (script.onUse?.(host, hotspot)) return true;
    }
    runReactions(
      host,
      [
        {
          type: "object.used",
          objectId: hotspot.id,
          targetId: null,
          actor: { kind: "player" },
        },
      ],
      scripts,
    );
    return false;
  }

  /**
   * Talk was refused; the press still belongs to whatever object is underfoot.
   * М6 seats a figure on the same tile as the shore hotspot, and the figure wins
   * the target tie — without this the pond never sees the third approach.
   */
  useNearbyHotspot(): boolean {
    const room = this.room;
    const local = toLocalPixels(room, this.player.x, this.player.y);
    const hotspot = findHotspot(
      reachableHotspots(this.world, room),
      local.x,
      local.y,
      room.tileSize,
    );
    return hotspot ? this.use(hotspot) : false;
  }

  /** Pack scripts may refuse talk. */
  mayTalk(figureId: string): boolean {
    const host = this.host();
    for (const script of this.scriptsFor(this.room.id)) {
      if (script.onApproach?.(host, figureId) === false) return false;
    }
    return true;
  }

  noteMemorySpent(): void {
    this.runScripts("memory");
  }

  noteCycleReset(): void {
    this.runScripts("cycle");
  }

  /**
   * Standing near a thing long enough for it to go off by itself.
   *
   * This used to be able to teleport — the courtyard bottle threw you into М4 after nine
   * seconds. Nothing here moves the player any more; a thing can only close itself.
   */
  private fire(hotspot: RoomHotspot): void {
    if (hotspot.once) this.room.closedHotspotIds.add(hotspot.id);
  }

  /**
   * Arrive somewhere.
   *
   * Doors are continuous, so they get no wipe: you walked through, and the room changing
   * under you is the whole of it. A rift is a cut, and gets the transition and a harder
   * shiver, because arriving somewhere that does not follow is supposed to read as such.
   */
  async enterRoom(
    roomId: string,
    entryId: string | null,
    style: ArrivalStyle,
  ): Promise<void> {
    const room = this.world.roomById.get(roomId);
    if (!room || this.transitioning) return;

    this.transitioning = true;
    try {
      if (style === "rift" || style === "meta-exit") {
        await this.transition?.play();
      }

      const from = this.world.currentRoomId;
      // A meta-space with no door still dumps you back on a timer. Once it has a
      // threshold of its own, you leave by walking, like anywhere else.
      if (room.kind === "meta" && room.meta && room.doors.length === 0) {
        const rng = makeRng(`meta:${roomId}:${visitCount(this.world, roomId)}`);
        const span = room.meta.maxMs - room.meta.minMs;
        this.meta = {
          roomId,
          remainingMs: room.meta.minMs + rng.next() * span,
          returnTo: { roomId: from, entryId: null },
        };
        setWorldFlag(this.world, "returnTo", from);
      }

      this.world.currentRoomId = roomId;
      placeAtEntry(this.player, room, entryId);
      this.showRoom(room);
      this.dwellMs.clear();

      this.leadAlong(roomId, from);
      const visits = noteVisit(this.world, roomId);
      this.escalateRevisit(room, visits);
      if (style !== "cut") this.shiver.trigger(style === "rift" ? 0.6 : 0.3);
      this.callbacks.onEnterRoom(room, visits);
      this.runScripts("enter");
    } finally {
      this.transitioning = false;
    }
  }

  /** Put the walker back at the spawn without any of the arrival theatre. */
  restart(): void {
    const room = currentRoom(this.world);
    this.meta = null;
    this.dwellMs.clear();
    placeAtEntry(this.player, room, this.world.artifact.spawn.entryId);
    this.showRoom(room);
    noteVisit(this.world, room.id);
  }

  /**
   * Re-show the current room without any arrival theatre.
   *
   * Used when something outside the session invalidated the scene — the population being
   * installed, a window resize, the dream being entered from the lobby.
   */
  enterRoomImmediate(): void {
    this.showRoom(currentRoom(this.world));
  }

  private showRoom(room: RoomState, cutCamera = true): void {
    if (isStreetWorld(this.world.rooms)) {
      this.scene.showStreet(
        streetRoomsToShow(this.world.rooms, room.id) as RoomState[],
        room,
      );
    } else {
      this.scene.show(room);
    }
    if (cutCamera) this.frameFor(room);
  }

  /**
   * Stepped across a punched opening into the next room. No cut, no placeAtEntry —
   * the walker is already standing on that floor.
   */
  private crossStreet(): void {
    if (!isStreetWorld(this.world.rooms)) return;
    const next = roomContainingPlayer(
      this.world.rooms,
      this.player.x,
      this.player.y,
      this.world.currentRoomId,
    );
    if (!next || next.id === this.world.currentRoomId) return;
    const room = this.world.roomById.get(next.id);
    if (!room) return;
    const from = this.world.currentRoomId;
    this.world.currentRoomId = room.id;
    this.showRoom(room, false);
    this.dwellMs.clear();
    this.leadAlong(room.id, from);
    const visits = noteVisit(this.world, room.id);
    this.escalateRevisit(room, visits);
    this.callbacks.onEnterRoom(room, visits);
    this.runScripts("enter");
  }

  /**
   * How this room is looked at.
   *
   * A street map is one country: the camera follows the walker across rooms. A
   * single-room dream still frames or follows the authored scene.
   */
  private frameFor(room: RoomState): void {
    if (isStreetWorld(this.world.rooms)) {
      const bounds = worldBounds(this.world.rooms);
      this.camera.setWorldSize(bounds.w, bounds.h);
      this.camera.fit(FOLLOW_VIEW_TILES.w, FOLLOW_VIEW_TILES.h);
      this.camera.cutTo(this.player.x, this.player.y);
      return;
    }
    this.camera.setWorldSize(room.width, room.height);
    if (room.camera === "follow") {
      this.camera.fit(FOLLOW_VIEW_TILES.w, FOLLOW_VIEW_TILES.h);
    } else {
      this.camera.fit(room.width, room.height);
    }
    this.camera.cutTo(this.player.x, this.player.y);
  }

  /**
   * Whoever is being led comes through the threshold too.
   *
   * Routes have no figure slots, so this does not go through `moveFigure` — that
   * patch seats someone, and a street is not a seat. They stand on the doorway
   * they just walked into.
   */
  private leadAlong(toRoomId: string, fromRoomId: string): void {
    const led = whoIsLed(this.world);
    if (!led) return;
    const dest = this.world.roomById.get(toRoomId);
    if (!dest) return;
    const door = dest.doors.find((entry) => entry.toRoomId === fromRoomId);
    const at = door
      ? { x: door.x + door.w / 2, y: door.y + door.h / 2 }
      : toLocalPixels(dest, this.player.x, this.player.y);
    escortFigure(this.world, led, toRoomId, at);
  }

  /**
   * §4.3 — the second visit is worse. The ditch is the canonical case: one
   * killer, then two, then four. The note already fires; this puts a thing
   * in the room so the count is visible, not only whispered.
   */
  private scriptsFor(roomId: string): DreamScript[] {
    return this.scripts.filter(
      (script) => script.roomId === undefined || script.roomId === roomId,
    );
  }

  private runScripts(
    hook: "enter" | "update" | "memory" | "cycle",
    dt = 0,
  ): void {
    const host = this.host();
    const list =
      hook === "memory" || hook === "cycle"
        ? this.scripts
        : this.scriptsFor(this.world.currentRoomId);
    for (const script of list) {
      if (hook === "enter") script.onEnter?.(host);
      if (hook === "update") script.onUpdate?.(host, dt);
      if (hook === "memory") script.onMemorySpent?.(host);
      if (hook === "cycle") script.onCycleReset?.(host);
    }
  }

  private host(): ScriptHost {
    const world = this.world;
    // The host object is a bag of getters; they cannot use the class `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const session = this;
    let reactionDepth = 0;
    const host: ScriptHost = {
      get currentRoomId() {
        return world.currentRoomId;
      },
      get exhaustion() {
        return world.exhaustion;
      },
      get cycleNumber() {
        return session.callbacks.cycleNumber?.() ?? 1;
      },
      get playerX() {
        return session.player.x;
      },
      get playerY() {
        return session.player.y;
      },
      get playerMoving() {
        return session.player.moving;
      },
      get tileSize() {
        return session.room.tileSize;
      },
      now: () => Date.now(),
      getFlag: (key) => worldFlag(world, key),
      setFlag: (key, value) => setWorldFlag(world, key, value),
      addExhaustion: (delta) => {
        addExhaustion(world, delta);
      },
      knownClueIds: () => session.callbacks.knownClueIds?.() ?? [],
      enterRoom: (roomId, entryId, style = "meta-exit") => {
        void session.enterRoom(roomId, entryId, style);
      },
      placePlayer: (entryId) => {
        placeAtEntry(session.player, session.room, entryId);
      },
      dispatch: (action) => {
        if (reactionDepth >= MAX_WORLD_ACTIONS_PER_TURN) {
          return {
            ok: false,
            refusal: "reaction cap",
            affectedRooms: [],
            affectedObjects: [],
            events: [],
          };
        }
        reactionDepth++;
        try {
          const tile = playerTile(session.player, session.room);
          const mutator = bindWorldMutator(world, {
            get: () => ({
              roomId: world.currentRoomId,
              x: tile.x,
              y: tile.y,
            }),
            set: () => undefined,
          });
          const result = executeWorldAction(mutator, {
            actor: { kind: "player" },
            source: "script",
            action,
          });
          const applied = result.ok
            ? result
            : session.applyStubPhysical(action);
          if (applied.ok && applied.events.length > 0) {
            runReactions(host, applied.events, session.scripts);
          }
          if (applied.ok && result.ok) {
            session.showRoom(session.room, false);
          }
          return applied;
        } finally {
          reactionDepth--;
        }
      },
      closeHotspot: (hotspotId) => {
        host.dispatch({ type: "close", targetId: hotspotId });
      },
      removeProp: (propId) => {
        host.dispatch({ type: "take", objectId: propId });
      },
      retargetRift: (doorId, toRoomId) => {
        applyPatch(world, {
          kind: "retargetDoor",
          doorId,
          toRoomId,
          reason: "pack script",
        });
        session.showRoom(session.room, false);
      },
      openDoor: (doorId) => {
        host.dispatch({ type: "open", targetId: doorId });
      },
      observeClue: (clueId) => {
        session.callbacks.observeClue?.(clueId);
      },
      hideFigure: (figureId) => {
        const figure = world.figures.find((entry) => entry.id === figureId);
        if (!figure) return;
        applyPatch(
          world,
          {
            kind: "markFigure",
            figureId,
            fate: "gone",
            quoted: null,
            reason: "pack script",
          },
          session.callbacks.cycleNumber?.() ?? 1,
        );
      },
      showFigure: (figureId, roomId) => {
        const room = world.roomById.get(roomId);
        if (!room || room.kind === "meta") return;
        const existing = world.figures.find((entry) => entry.id === figureId);
        if (existing) {
          applyPatch(world, {
            kind: "moveFigure",
            figureId,
            toRoomId: roomId,
            reason: "pack script",
          });
          return;
        }
        const base = world.baseFigures.find((entry) => entry.id === figureId);
        if (!base) return;
        world.fates.delete(figureId);
        world.figures.push(cloneFigureState({ ...base, roomId }));
      },
      figureInWorld: (figureId) =>
        world.figures.some((entry) => entry.id === figureId),
      whisper: (text) => session.callbacks.whisper?.(text),
    };
    return host;
  }

  /**
   * ENGINE_STUB: keep pack scripts working until the real executor mutates objects.
   * Physical changes still go through dispatch; this is not a second caller path.
   */
  private applyStubPhysical(action: WorldAction): WorldActionResult {
    if (action.type === "open") {
      applyPatch(this.world, {
        kind: "retypeDoor",
        doorId: action.targetId,
        to: "open",
        reason: "pack script",
      });
      this.showRoom(this.room, false);
      return {
        ok: true,
        refusal: null,
        affectedRooms: [this.room.id],
        affectedObjects: [],
        events: [
          {
            type: "door.opened",
            doorId: action.targetId,
            actor: { kind: "script", id: "pack" },
          },
        ],
      };
    }
    if (action.type === "close") {
      this.room.closedHotspotIds.add(action.targetId);
      return {
        ok: true,
        refusal: null,
        affectedRooms: [this.room.id],
        affectedObjects: [action.targetId],
        events: [
          {
            type: "object.closed",
            objectId: action.targetId,
            actor: { kind: "script", id: "pack" },
          },
        ],
      };
    }
    if (action.type === "take") {
      const room = this.room;
      const index = room.props.findIndex((prop) => prop.id === action.objectId);
      if (index >= 0) room.props.splice(index, 1);
      room.closedHotspotIds.add(action.objectId);
      this.scene.show(room);
      return {
        ok: true,
        refusal: null,
        affectedRooms: [room.id],
        affectedObjects: [action.objectId],
        events: [
          {
            type: "object.taken",
            objectId: action.objectId,
            actor: { kind: "player" },
            fromRoomId: room.id,
          },
        ],
      };
    }
    return {
      ok: false,
      refusal: "world-action-engine stub: engine agent implements this",
      affectedRooms: [],
      affectedObjects: [],
      events: [],
    };
  }

  private escalateRevisit(room: RoomState, visits: number): void {
    if (!room.revisit.escalates || visits < 2) return;
    const id = `revisit:${room.id}:${visits}`;
    const name =
      visits === 2
        ? "Вторая машина"
        : visits === 3
          ? "Четверо у гаражей"
          : "Их стало слишком много";
    applyPatch(this.world, {
      kind: "placeInterest",
      interest: {
        id,
        roomId: room.id,
        name,
        sensorySeed:
          visits === 2
            ? "Фар уже двое, хотя мотор слышен один."
            : "Людей больше, чем мест, куда можно спрятаться.",
        solid: false,
        holdsShardId: null,
        clueId: null,
      },
      reason: "second visit worse",
    });
  }
}
