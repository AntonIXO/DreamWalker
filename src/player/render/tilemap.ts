/**
 * Drawing the world.
 *
 * Two things decide the shape of this file, and they pull in opposite directions.
 *
 * **Chunks, not regions.** It used to be one container per room, which worked when a room
 * was fifteen tiles across and the camera showed exactly one. A region is now most of a
 * screen and routes are bigger still, so grouping by region gives containers of wildly
 * different sizes and makes culling useless. Fixed chunks are the standard answer: uniform,
 * cheap to index, and a patch redraws the handful it touched.
 *
 * **Frames come from neighbours.** A tile knows it is grass; which of the forty-seven
 * pieces of grass it is depends on what is next to it (`shared/autotile.ts`). That is what
 * turns a grid of stamps into a shoreline. The consequence is that changing one tile can
 * change the picture of the eight around it, so `refreshRect` always grows its rectangle by
 * one before redrawing — a patch that repainted only what it wrote would leave a seam.
 */

import { Container, Rectangle, Sprite, type Texture } from "pixi.js";

import {
  blobIndex,
  autotileOf,
  edgeIndex,
  frameName,
} from "../../shared/autotile";
import { TILE_ROLE, Tile } from "../../shared/tilecodes";
import type { Rect } from "../../shared/dream";
import { tileAt, type WorldState } from "../game/world";
import { variantFor, type AtlasTextures } from "./atlasTextures";

/** Tiles per chunk. 16 keeps a chunk near a screen quarter at the usual zoom. */
const CHUNK = 16;

export class TilemapView {
  readonly root = new Container({ label: "tilemap", isRenderGroup: true });
  private readonly chunks = new Map<string, Container>();
  private readonly chunksWide: number;
  private readonly chunksHigh: number;

  constructor(
    private readonly world: WorldState,
    private readonly atlas: AtlasTextures,
  ) {
    this.chunksWide = Math.ceil(world.width / CHUNK);
    this.chunksHigh = Math.ceil(world.height / CHUNK);
    this.refreshAll();
  }

  /**
   * The texture for one tile: role from the code, frame from the neighbours.
   *
   * Returns null for anything the atlas has no art for, which is not an error — it is the
   * seam the runtime foundry fills (`render/foundry.ts`) when the sleeper invents a terrain
   * the Lord never baked.
   */
  private textureFor(x: number, y: number, tile: number): Texture | null {
    const role = TILE_ROLE[tile];
    if (!role) return null;

    const frames = this.atlas.roles.get(role);
    if (!frames || frames.length === 0) return null;

    const kind = autotileOf(role);
    if (kind === "plain") return variantFor(frames, x, y);

    const sample = (dx: number, dy: number): number | null => {
      const nx = x + dx;
      const ny = y + dy;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= this.world.width ||
        ny >= this.world.height
      ) {
        return null;
      }
      return tileAt(this.world, nx, ny);
    };

    const index =
      kind === "blob" ? blobIndex(tile, sample) : edgeIndex(tile, sample);
    return (
      this.atlas.frames.get(frameName(role, index)) ??
      frames[index] ??
      frames[0] ??
      null
    );
  }

  private buildChunk(chunkX: number, chunkY: number): void {
    const key = `${chunkX},${chunkY}`;
    const existing = this.chunks.get(key);
    if (existing) {
      this.root.removeChild(existing);
      existing.destroy({ children: true });
    }

    const size = this.world.tileSize;
    const x0 = chunkX * CHUNK;
    const y0 = chunkY * CHUNK;
    const x1 = Math.min(this.world.width, x0 + CHUNK);
    const y1 = Math.min(this.world.height, y0 + CHUNK);

    const container = new Container({ label: `chunk:${key}` });

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = tileAt(this.world, x, y);
        if (tile === Tile.VOID) continue;
        const texture = this.textureFor(x, y, tile);
        if (!texture) continue;

        container.addChild(
          new Sprite({
            texture,
            x: x * size,
            y: y * size,
            roundPixels: true,
          }),
        );
      }
    }

    // Empty chunks are common — the interior band is mostly nothing — and an empty
    // container still costs a transform and a bounds check every frame.
    if (container.children.length === 0) {
      container.destroy();
      this.chunks.delete(key);
      return;
    }

    // A chunk only changes when it is patched, so let the renderer keep one texture for it
    // rather than re-batching a few hundred sprites every frame.
    container.cacheAsTexture(true);
    container.cullable = true;
    container.cullArea = new Rectangle(
      x0 * size,
      y0 * size,
      (x1 - x0) * size,
      (y1 - y0) * size,
    );

    this.chunks.set(key, container);
    this.root.addChild(container);
  }

  /**
   * Redraw everything overlapping a tile rectangle.
   *
   * Grown by one tile first: a tile's picture depends on its neighbours, so writing to the
   * edge of a rectangle changes how the tiles just outside it should be drawn.
   */
  refreshRect(rect: Rect): void {
    const x0 = Math.max(0, Math.floor((rect.x - 1) / CHUNK));
    const y0 = Math.max(0, Math.floor((rect.y - 1) / CHUNK));
    const x1 = Math.min(
      this.chunksWide - 1,
      Math.floor((rect.x + rect.w) / CHUNK),
    );
    const y1 = Math.min(
      this.chunksHigh - 1,
      Math.floor((rect.y + rect.h) / CHUNK),
    );

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) this.buildChunk(cx, cy);
    }
  }

  /** Called by the heartbeat after it has written to the tile grid. */
  refreshRooms(roomIds: Iterable<string>): void {
    for (const id of roomIds) {
      const room = this.world.roomById.get(id);
      if (room) this.refreshRect(room.rect);
    }
  }

  /** After a cycle reset, when the world is back to how the Lord left it. */
  refreshAll(): void {
    for (const container of this.chunks.values()) {
      this.root.removeChild(container);
      container.destroy({ children: true });
    }
    this.chunks.clear();

    for (let cy = 0; cy < this.chunksHigh; cy++) {
      for (let cx = 0; cx < this.chunksWide; cx++) this.buildChunk(cx, cy);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.chunks.clear();
  }
}
