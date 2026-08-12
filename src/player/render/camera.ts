/**
 * A camera that follows the walker.
 *
 * It used to snap room to room, and that was a structural choice rather than a stylistic
 * one: §6 has the sleeper rearranging the world while the player is inside it, and a
 * camera that only ever framed one room meant every mutation happened off-screen by
 * construction. A world of towns and open routes has no rooms to snap to, so that guarantee
 * has moved rather than been dropped — `visibleTiles()` below is what the heartbeat now
 * asks before it changes anything, which is a better rule anyway: what matters is whether
 * the player can *see* it, and "the room they are in" was only ever a proxy for that.
 *
 * The world is scaled by a whole number and the camera lands on whole pixels, because
 * anything else turns 16px tiles into mush.
 */

import type { Container } from "pixi.js";

import type { Rect, Room } from "../../shared/dream";

export interface CameraOptions {
  /** Whole-number zoom. Overridden at runtime by `fitZoom` so a room is never cropped. */
  zoom: number;
  /** Seconds for a hard cut to settle — used by warps, not by walking. */
  transitionSeconds: number;
  /**
   * How quickly the camera catches up, as a fraction of the remaining distance per second.
   * High enough to feel attached to the walker, low enough that a change of direction is
   * not a snap.
   */
  followRate: number;
  /** Tiles of slack around the world's edge before the camera stops. */
  edgeMargin: number;
}

export const DEFAULT_CAMERA: CameraOptions = {
  zoom: 1,
  transitionSeconds: 0.22,
  followRate: 8,
  edgeMargin: 0,
};

/**
 * How much country the follow camera aims to show.
 *
 * Chosen so a laptop sees a route and a junction, not a close-up of one tile. Interiors
 * and the lobby ignore this and fit their own rectangle instead.
 */
export const OUTDOOR_VIEW_TILES = { w: 22, h: 13 } as const;

/**
 * Largest whole-number zoom that still keeps `tilesW × tilesH` on screen.
 *
 * Floor, never round: a rounded 1.7 becomes 2 and crops the room the player is standing
 * in. Zoom is at least 1 so a tiny window still shows something, even if it must scroll.
 */
export function fitZoom(
  viewW: number,
  viewH: number,
  tilesW: number,
  tilesH: number,
  tileSize: number,
): number {
  if (viewW <= 0 || viewH <= 0 || tilesW <= 0 || tilesH <= 0 || tileSize <= 0) {
    return 1;
  }
  return Math.max(
    1,
    Math.floor(
      Math.min(viewW / (tilesW * tileSize), viewH / (tilesH * tileSize)),
    ),
  );
}

/**
 * How far south the follow camera may go.
 *
 * Interiors share the same tile grid, packed into a band under the country. The follow
 * camera must stop at that band — otherwise the south treeline shows kitchens. Framing
 * (`frame`) still centres an interior without this clamp.
 */
export function outdoorHeight(
  rooms: readonly Room[],
  worldHeight: number,
): number {
  let height = worldHeight;
  for (const room of rooms) {
    if (room.region === "interior") height = Math.min(height, room.rect.y);
  }
  return height;
}

/** Smoothstep. Eases both ends, so the slide neither jerks nor drifts. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

export class Camera {
  private currentX = 0;
  private currentY = 0;
  private fromX = 0;
  private fromY = 0;
  private targetX = 0;
  private targetY = 0;
  private elapsed = 0;
  private duration = 0;
  private framedRoomId: string | null = null;

  /** World size in tiles, so the view can be clamped to it. */
  private worldTilesWide = 0;
  private worldTilesHigh = 0;

  private readonly options: CameraOptions;

  constructor(
    private readonly stage: Container,
    private readonly tileSize: number,
    private viewWidth: number,
    private viewHeight: number,
    options: CameraOptions = DEFAULT_CAMERA,
  ) {
    // Copy so mutating zoom cannot rewrite the shared DEFAULT_CAMERA.
    this.options = { ...options };
    this.stage.scale.set(this.options.zoom);
  }

  setWorldSize(tilesWide: number, tilesHigh: number): void {
    this.worldTilesWide = tilesWide;
    this.worldTilesHigh = tilesHigh;
  }

  /**
   * Change the integer world scale and keep the current centre on screen.
   *
   * Framed interiors skip the world-edge clamp: they sit in a reserved band and a clamp
   * would shove the house into a corner. Followed views re-clamp so the treeline stays
   * honest.
   */
  setZoom(zoom: number): void {
    const next = Math.max(1, Math.floor(zoom));
    if (next === this.options.zoom) return;
    const prev = this.options.zoom;
    const centreX = (this.viewWidth / 2 - this.currentX) / prev;
    const centreY = (this.viewHeight / 2 - this.currentY) / prev;
    this.options.zoom = next;
    this.stage.scale.set(next);
    if (this.framedRoomId) {
      const target = this.centre(centreX, centreY);
      this.currentX = this.targetX = this.fromX = target.x;
      this.currentY = this.targetY = this.fromY = target.y;
      this.elapsed = this.duration = 0;
      this.apply();
      return;
    }
    this.cutTo(centreX, centreY);
  }

  /** Fit `tilesW × tilesH` on screen and return the zoom that did it. */
  fit(tilesW: number, tilesH: number): number {
    const zoom = fitZoom(
      this.viewWidth,
      this.viewHeight,
      tilesW,
      tilesH,
      this.tileSize,
    );
    this.setZoom(zoom);
    return zoom;
  }

  /**
   * Follow a point given in world pixels.
   *
   * Clamped to the world's bounds so the player never sees the void past the treeline —
   * unless the world is smaller than the screen on that axis, in which case it is centred
   * instead, because a clamp would jam it against one edge.
   */
  follow(x: number, y: number, deltaSeconds: number): void {
    // A hard cut is in progress; let it finish rather than fighting it.
    if (this.elapsed < this.duration) return;
    // Leaving a framed room hands control back to the walker.
    this.framedRoomId = null;

    const target = this.clamp(x, y);
    // Exponential ease. Frame-rate independent, unlike a plain lerp by a fixed fraction.
    const t = 1 - Math.exp(-this.options.followRate * deltaSeconds);
    this.currentX += (target.x - this.currentX) * t;
    this.currentY += (target.y - this.currentY) * t;
    this.apply();
  }

  /** Where the stage must sit for a world-pixel point to be centred, within bounds. */
  private clamp(x: number, y: number): { x: number; y: number } {
    const zoom = this.options.zoom;
    const margin = this.options.edgeMargin * this.tileSize * zoom;
    const worldW = this.worldTilesWide * this.tileSize * zoom;
    const worldH = this.worldTilesHigh * this.tileSize * zoom;

    let sx = this.viewWidth / 2 - x * zoom;
    let sy = this.viewHeight / 2 - y * zoom;

    if (worldW + margin * 2 <= this.viewWidth) {
      sx = (this.viewWidth - worldW) / 2;
    } else {
      sx = Math.min(margin, Math.max(this.viewWidth - worldW - margin, sx));
    }
    if (worldH + margin * 2 <= this.viewHeight) {
      sy = (this.viewHeight - worldH) / 2;
    } else {
      sy = Math.min(margin, Math.max(this.viewHeight - worldH - margin, sy));
    }

    return { x: sx, y: sy };
  }

  /** Put the view on a point at once, with no slide. Used on spawn and through warps. */
  cutTo(x: number, y: number): void {
    const target = this.clamp(x, y);
    this.currentX = this.targetX = this.fromX = target.x;
    this.currentY = this.targetY = this.fromY = target.y;
    this.elapsed = this.duration = 0;
    this.apply();
  }

  /**
   * The tile rectangle currently on screen, padded.
   *
   * This is the §6 guarantee, moved from the camera's framing into an explicit question:
   * the heartbeat asks it before every patch, and anything inside it is off limits. Ground
   * that moves in front of you reads as a bug; ground that moved while you were away reads
   * as a threat, and the difference is entirely whether it was on this rectangle.
   */
  visibleTiles(pad = 2): Rect {
    const zoom = this.options.zoom;
    const size = this.tileSize * zoom;
    const x = Math.floor(-this.currentX / size) - pad;
    const y = Math.floor(-this.currentY / size) - pad;
    const w = Math.ceil(this.viewWidth / size) + pad * 2 + 1;
    const h = Math.ceil(this.viewHeight / size) + pad * 2 + 1;
    return { x, y, w, h };
  }

  get zoom(): number {
    return this.options.zoom;
  }

  get roomId(): string | null {
    return this.framedRoomId;
  }

  get isMoving(): boolean {
    return this.elapsed < this.duration;
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    // Re-clamp against the new viewport, or a window that just got wider leaves the world
    // pinned to one side.
    const zoom = this.options.zoom;
    const centreX = (this.viewWidth / 2 - this.currentX) / zoom;
    const centreY = (this.viewHeight / 2 - this.currentY) / zoom;
    this.cutTo(centreX, centreY);
  }

  /**
   * Frame a whole region. Kept for warps, where a hard cut is right — stepping through a
   * door in a Game Boy game does not pan, it changes scene.
   */
  frame(room: Room, immediate = false): void {
    // Called every frame while indoors, so re-framing the room already framed has to be a
    // no-op — otherwise the transition restarts each tick and the camera never arrives.
    const nextZoom = fitZoom(
      this.viewWidth,
      this.viewHeight,
      room.rect.w,
      room.rect.h,
      this.tileSize,
    );
    if (
      this.framedRoomId === room.id &&
      !immediate &&
      this.options.zoom === nextZoom
    ) {
      return;
    }
    // Mark framed *before* setZoom so the new scale centres without the world clamp.
    this.framedRoomId = room.id;
    this.setZoom(nextZoom);
    const centreX = (room.rect.x + room.rect.w / 2) * this.tileSize;
    const centreY = (room.rect.y + room.rect.h / 2) * this.tileSize;

    if (immediate) {
      const target = this.centre(centreX, centreY);
      this.currentX = this.targetX = this.fromX = target.x;
      this.currentY = this.targetY = this.fromY = target.y;
      this.elapsed = this.duration = 0;
      this.apply();
      return;
    }

    const target = this.centre(centreX, centreY);
    this.fromX = this.currentX;
    this.fromY = this.currentY;
    this.targetX = target.x;
    this.targetY = target.y;
    this.elapsed = 0;
    this.duration = this.options.transitionSeconds;
  }

  /**
   * Centre a point with no clamping at all.
   *
   * Framing is used for interiors, which sit in a reserved band at the edge of the grid and
   * are masked to their own walls. Clamping them to the world's bounds would shove the room
   * against whichever edge it happens to be near — so the house appeared in the corner of
   * the screen — and there is nothing outside it to protect the player from seeing, because
   * the mask has already removed it.
   */
  private centre(x: number, y: number): { x: number; y: number } {
    const zoom = this.options.zoom;
    return {
      x: this.viewWidth / 2 - x * zoom,
      y: this.viewHeight / 2 - y * zoom,
    };
  }

  update(deltaSeconds: number): void {
    if (this.elapsed >= this.duration) return;

    this.elapsed = Math.min(this.duration, this.elapsed + deltaSeconds);
    const t = this.duration === 0 ? 1 : ease(this.elapsed / this.duration);
    this.currentX = this.fromX + (this.targetX - this.fromX) * t;
    this.currentY = this.fromY + (this.targetY - this.fromY) * t;
    this.apply();
  }

  /** Nudge the whole view. Used by the shiver when the sleeper stirs. */
  private offsetX = 0;
  private offsetY = 0;

  setShake(dx: number, dy: number): void {
    this.offsetX = dx;
    this.offsetY = dy;
    this.apply();
  }

  private apply(): void {
    // Whole pixels only. A camera on a half pixel makes every tile edge shimmer.
    this.stage.x = Math.round(this.currentX + this.offsetX);
    this.stage.y = Math.round(this.currentY + this.offsetY);
  }
}
