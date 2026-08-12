/**
 * Walking the dream: which room we are in, and what happens when we leave it.
 *
 * This is the piece format 3 kept inline in `main.ts` as a nine-line warp block. It grew
 * because rooms are discrete now and there are four different ways out of one — a door,
 * a link, a timer, and the sleeper moving something while you were not looking.
 *
 * **Linking** is the mechanic from LSD: Dream Emulator. Osamu Sato built it out of being
 * bad at racing games: he kept hitting walls, and wondered what would happen if hitting
 * something *was* the point and it threw you somewhere else. Here it means poking the
 * world — the safe channel, the thing that never gives the sanitar away — stops being
 * free. It cannot cost you your cover, so instead it costs you your position.
 */

import type { RoomHotspot } from "../../shared/room";
import { makeRng } from "../../shared/rng";
import type { Camera } from "../render/camera";
import type { RoomScene } from "../render/roomScene";
import type { Shiver } from "../render/shiver";
import { findTarget, type InteractTarget } from "./interact";
import {
  createPlayer,
  placeAtEntry,
  updatePlayer,
  type PlayerState,
} from "./player";
import { Tonus } from "./tonus";
import {
  currentRoom,
  noteVisit,
  resolveLink,
  visitCount,
  type RoomState,
  type WorldState,
} from "./world";

/** How the arrival should feel. A door is continuous; a link is not. */
export type ArrivalStyle = "door" | "link" | "meta-exit" | "cut";

export interface SessionCallbacks {
  onEnterRoom(room: RoomState, visits: number): void;
  onRefused(doorId: string, text: string): void;
  onOverflow(): void;
  /** A `refuse` link fired — «достать её нельзя, это проверено». */
  onRefusedLink(note: string): void;
}

interface MetaVisit {
  roomId: string;
  remainingMs: number;
  returnTo: { roomId: string; entryId: string | null };
}

/** How much of a room's tonus a repeat visit is worth. Capped so it cannot run away. */
const MAX_VISIT_SCALE = 3;

export class DreamSession {
  readonly tonus = new Tonus();
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
        void this.enterRoom(door.toRoomId, door.toEntryId, "door");
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

  private fire(hotspot: RoomHotspot): void {
    const room = this.room;
    if (hotspot.tonus) {
      const step = this.tonus.apply(hotspot.tonus, this.canOverflow(room));
      if (step.overflowed) this.callbacks.onOverflow();
    }
    if (hotspot.once) room.closedHotspotIds.add(hotspot.id);
    if (!hotspot.link) return;

    if (hotspot.link.to === "refuse") {
      this.callbacks.onRefusedLink(hotspot.link.note);
      return;
    }
    const destination = resolveLink(this.world, hotspot.link);
    if (!destination) return;
    void this.enterRoom(destination.roomId, destination.entryId, "link");
  }

  /**
   * Arrive somewhere.
   *
   * Doors are continuous, so they get no wipe: you walked through, and the room changing
   * under you is the whole of it. A link is a cut, and gets the transition and a harder
   * shiver, because being thrown is supposed to read as being thrown.
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
      if (style === "link" || style === "meta-exit") {
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
      this.camera.setWorldSize(room.width, room.height);
      this.camera.fit(room.width, room.height);
      this.camera.cutTo(this.player.x, this.player.y);
      this.dwellMs.clear();

      const visits = noteVisit(this.world, roomId);
      this.applyArrivalTonus(room, visits);
      if (style !== "cut") this.shiver.trigger(style === "link" ? 0.6 : 0.3);
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
    this.camera.setWorldSize(room.width, room.height);
    this.camera.fit(room.width, room.height);
    this.camera.cutTo(this.player.x, this.player.y);
  }

  private applyArrivalTonus(room: RoomState, visits: number): void {
    const overflow = this.canOverflow(room);
    // М1 КОРНИ carries nothing of its own and doubles whatever you walked in with.
    const step = room.meta?.doublesPrevious
      ? this.tonus.applyDoubled(overflow)
      : this.tonus.applyScaled(
          room.tonus,
          Math.min(visits, MAX_VISIT_SCALE),
          overflow,
        );
    if (step.overflowed) this.callbacks.onOverflow();
  }

  /**
   * Only a meta-space lets the counter wrap.
   *
   * Part II — «мета-пространство — единственное место, где график может переполниться».
   * Everywhere else it clamps, so the pressure accumulates against the floor and goes
   * off later, somewhere nobody remembers.
   */
  private canOverflow(room: RoomState): boolean {
    return room.kind === "meta" && room.meta?.overflow === true;
  }
}
