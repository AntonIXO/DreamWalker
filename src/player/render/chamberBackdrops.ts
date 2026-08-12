/** Optional full-room art supplied by the human author. */

import { Container, Sprite, type Texture } from "pixi.js";

import type { WorldState } from "../game/world";

/**
 * Physical walls and collision remain in the tile grid. A backdrop replaces only the
 * inside of an authored chamber, so doors, the treeline and runtime patches keep their
 * structural meaning while an artist can replace placeholder terrain with one PNG.
 */
export class ChamberBackdropLayer {
  readonly root = new Container({
    label: "chamber-backdrops",
    eventMode: "none",
    interactiveChildren: false,
  });
  private readonly sprites = new Map<string, Sprite>();

  constructor(
    private readonly world: WorldState,
    private readonly textures: ReadonlyMap<string, Texture>,
  ) {
    this.sync();
  }

  sync(): void {
    const seen = new Set<string>();
    for (const [roomId, chamber] of this.world.chamberByRoomId) {
      if (!chamber.graphics.backdropImage) continue;
      const room = this.world.roomById.get(roomId);
      const texture = this.textures.get(chamber.id);
      if (!room || !texture) continue;

      seen.add(roomId);
      let sprite = this.sprites.get(roomId);
      if (!sprite) {
        sprite = new Sprite({ texture, eventMode: "none", roundPixels: true });
        this.sprites.set(roomId, sprite);
        this.root.addChild(sprite);
      }
      sprite.texture = texture;
      const inset = room.region === "interior" ? 1 : 2;
      sprite.x = (room.rect.x + inset) * this.world.tileSize;
      sprite.y = (room.rect.y + inset) * this.world.tileSize;
      sprite.width = Math.max(1, room.rect.w - inset * 2) * this.world.tileSize;
      sprite.height =
        Math.max(1, room.rect.h - inset * 2) * this.world.tileSize;
    }

    for (const [roomId, sprite] of this.sprites) {
      if (seen.has(roomId)) continue;
      sprite.destroy();
      this.sprites.delete(roomId);
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.root.destroy({ children: true });
  }
}
