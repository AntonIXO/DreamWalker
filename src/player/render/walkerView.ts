/**
 * Sprites for anyone who walks: the sanitar and the figures of the dream.
 *
 * Frames come out of the atlas by name, in the spelling `tools/lord/art/silhouettes.ts`
 * writes them. Sprites are anchored at the feet so that sorting by Y puts whoever is
 * lower in the room in front, which is the whole of depth in a top-down view.
 */

import { Container, Sprite, type Texture } from "pixi.js";

import type { AtlasTextures } from "./atlasTextures";
import type { FigureState } from "../game/world";

export type Direction = "n" | "e" | "s" | "w";

function frameName(prefix: string, dir: Direction, frame: number): string {
  return `${prefix}_${dir}_${frame % 2}`;
}

export class WalkerSprite {
  readonly sprite: Sprite;
  private currentName = "";

  constructor(
    private readonly atlas: AtlasTextures,
    private readonly prefix: string,
  ) {
    const first = this.textureFor("s", 0);
    this.sprite = new Sprite({
      texture: first,
      // Feet at the position, not the middle of the body.
      anchor: { x: 0.5, y: 0.9 },
      roundPixels: true,
    });
  }

  private textureFor(dir: Direction, frame: number): Texture {
    const name = frameName(this.prefix, dir, frame);
    const texture = this.atlas.frames.get(name);
    if (!texture) throw new Error(`atlas has no frame "${name}"`);
    return texture;
  }

  update(x: number, y: number, dir: Direction, frame: number): void {
    this.sprite.x = Math.round(x);
    this.sprite.y = Math.round(y);
    // Sorting key: whoever stands lower draws in front.
    this.sprite.zIndex = Math.round(y);

    const name = frameName(this.prefix, dir, frame);
    if (name !== this.currentName) {
      this.currentName = name;
      this.sprite.texture = this.textureFor(dir, frame);
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

/**
 * Everyone who can be occluded by everyone else lives in one container with
 * `sortableChildren`, so the ordering is decided by position rather than by the order
 * things happened to be created in.
 */
export class ActorLayer {
  readonly root = new Container({ label: "actors", sortableChildren: true });
  private readonly figures = new Map<string, WalkerSprite>();

  constructor(private readonly atlas: AtlasTextures) {}

  add(walker: WalkerSprite): void {
    this.root.addChild(walker.sprite);
  }

  /** Figures are keyed by id so the heartbeat can move them without rebuilding anything. */
  syncFigures(figures: readonly FigureState[], tileSize: number): void {
    const seen = new Set<string>();

    for (const figure of figures) {
      seen.add(figure.id);
      let walker = this.figures.get(figure.id);
      if (!walker) {
        walker = new WalkerSprite(this.atlas, `figure_${figure.archetypeId}`);
        this.figures.set(figure.id, walker);
        this.root.addChild(walker.sprite);
      }
      walker.update(
        figure.x * tileSize + tileSize / 2,
        figure.y * tileSize + tileSize,
        figure.facing,
        0,
      );
    }

    for (const [id, walker] of this.figures) {
      if (seen.has(id)) continue;
      walker.destroy();
      this.figures.delete(id);
    }
  }

  destroy(): void {
    for (const walker of this.figures.values()) walker.destroy();
    this.figures.clear();
    this.root.destroy({ children: true });
  }
}
