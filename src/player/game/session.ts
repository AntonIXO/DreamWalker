/**
 * Walking the dream: which room we are in, and what happens when we leave it.
 *
 * This is the piece format 3 kept inline in `main.ts` as a nine-line warp block. It grew
 * because rooms are discrete now and there are three different ways out of one — a
 * threshold, a timer, and the sleeper moving something while you were not looking.
 *
 * Touching a thing used to be a fourth: LSD: Dream Emulator's linking, which Osamu Sato
 * built out of being bad at racing games — he kept hitting walls and wondered what would
 * happen if hitting something *was* the point. It is gone. What it bought, the map
 * connecting without logic, is bought instead by the `rift` threshold, and §4.1 is the
 * reason: «Никаких телепортов на ровном месте — всегда есть створ, через который прошли.»
 * Poking the world is a safe channel again, and being thrown somewhere costs you the walk
 * into the doorway that threw you.
 */

import type { RoomHotspot } from "../../shared/room";
import { makeRng } from "../../shared/rng";
import { FOLLOW_VIEW_TILES, type Camera } from "../render/camera";
import type { RoomScene } from "../render/roomScene";
import type { Shiver } from "../render/shiver";
import { findTarget, type InteractTarget } from "./interact";
import { whoIsLed } from "./fates";
import { applyPatch } from "./patch";
import {
  createPlayer,
  placeAtEntry,
  updatePlayer,
  type PlayerState,
} from "./player";
import {
  currentRoom,
  doorDestination,
  noteVisit,
  visitCount,
  type RoomState,
  type WorldState,
} from "./world";

/** How the arrival should feel. A door is continuous; a rift is not. */
export type ArrivalStyle = "door" | "rift" | "meta-exit" | "cut";

export interface SessionCallbacks {
  onEnterRoom(room: RoomState, visits: number): void;
  onRefused(doorId: string, text: string): void;
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
  ) {
    const room = currentRoom(world);
    this.player = createPlayer(room, world.artifact.spawn.entryId);
    this.showRoom(room);
    noteVisit(world, room.id);
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

    this.tickDwell(room, deltaSeconds);
    this.tickMeta(deltaSeconds);
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
      const near =
        !moving &&
        Math.hypot(
          hotspot.x * room.tileSize - this.player.x,
          hotspot.y * room.tileSize - this.player.y,
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

  /** The player pressed E on something. */
  use(hotspot: RoomHotspot): void {
    this.fire(hotspot);
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
      // A meta-space remembers where it took you from, since you do not leave it by
      // walking — «выход не ищется, он случается».
      if (room.kind === "meta" && room.meta) {
        const rng = makeRng(`meta:${roomId}:${visitCount(this.world, roomId)}`);
        const span = room.meta.maxMs - room.meta.minMs;
        this.meta = {
          roomId,
          remainingMs: room.meta.minMs + rng.next() * span,
          returnTo: { roomId: from, entryId: null },
        };
      }

      this.world.currentRoomId = roomId;
      placeAtEntry(this.player, room, entryId);
      this.scene.show(room);
      this.frameFor(room);
      this.dwellMs.clear();

      this.leadAlong(roomId);
      const visits = noteVisit(this.world, roomId);
      this.escalateRevisit(room, visits);
      if (style !== "cut") this.shiver.trigger(style === "rift" ? 0.6 : 0.3);
      this.callbacks.onEnterRoom(room, visits);
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

  private showRoom(room: RoomState): void {
    this.scene.show(room);
    this.frameFor(room);
  }

  /**
   * How this room is looked at.
   *
   * `frame` holds the whole room on screen at an integer zoom, which is what a 20×11
   * scene is for. `follow` keeps a fixed window and tracks the walker, which is what a
   * floor bigger than the screen needs. Arriving is always a cut — panning to a room you
   * have just been thrown into would announce the geometry rather than the arrival.
   */
  private frameFor(room: RoomState): void {
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
   * `moveFigure` is safe on this path: the "not the room the player is in" refusal lives
   * in `scheduleFigure` and in `Heartbeat.apply`, and neither is on it. It already
   * refuses meta-spaces, so nobody can be dragged into М1 — «разговаривать не с кем».
   */
  private leadAlong(roomId: string): void {
    const led = whoIsLed(this.world);
    if (!led) return;
    applyPatch(this.world, {
      kind: "moveFigure",
      figureId: led,
      toRoomId: roomId,
      reason: "led by the sanitar",
    });
  }

  /**
   * §4.3 — the second visit is worse. The ditch is the canonical case: one
   * killer, then two, then four. The note already fires; this puts a thing
   * in the room so the count is visible, not only whispered.
   */
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
