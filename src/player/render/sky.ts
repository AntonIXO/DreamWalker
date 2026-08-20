/**
 * The dream's sky. Screen-space paintings behind the map.
 *
 * Cover picks a still. Changing cover fades the still that is on screen into the
 * still that belongs to the new cover — night goes straight to «как вчера», it does
 * not flip through rain and noon as if they were slides. The under sprite stays
 * opaque, so the renderer's clear colour never shows through a fade.
 */

import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
  type Texture as PixiTexture,
} from "pixi.js";

import type { SkyBand } from "../game/forecast";

export interface SkyPainting {
  at: number;
  id: SkyBand;
  file: string;
}

export const SKY_PAINTINGS: readonly SkyPainting[] = [
  { at: 0, id: "night", file: "night.jpg" },
  { at: 0.1, id: "overcast", file: "overcast.jpg" },
  { at: 0.24, id: "drizzle", file: "drizzle.jpg" },
  { at: 0.38, id: "dry", file: "overcast.jpg" },
  { at: 0.52, id: "clearing", file: "clearing.jpg" },
  { at: 0.66, id: "clear", file: "clear.jpg" },
  { at: 0.8, id: "fine", file: "fine.jpg" },
  { at: 0.92, id: "yesterday", file: "yesterday.jpg" },
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** The still that belongs to this cover. No interpolation. */
export function paintingAt(cover: number): string {
  const t = clamp01(cover);
  let file = SKY_PAINTINGS[0]!.file;
  for (const stop of SKY_PAINTINGS) {
    if (stop.at <= t) file = stop.file;
  }
  return file;
}

export async function loadSkyPaintings(): Promise<
  ReadonlyMap<string, PixiTexture>
> {
  const files = [...new Set(SKY_PAINTINGS.map((stop) => stop.file))];
  const paintings = new Map<string, PixiTexture>();
  await Promise.all(
    files.map(async (file) => {
      try {
        const texture = await Assets.load<Texture>({
          src: `/sky/${file}`,
          alias: `sky:${file}`,
          data: { scaleMode: "linear" },
        });
        if (!texture?.source) return;
        texture.source.scaleMode = "linear";
        paintings.set(file, texture);
      } catch (error) {
        console.warn(`[dream] sky painting skipped: ${file}`, error);
      }
    }),
  );
  return paintings;
}

/** Length of one still-to-still fade. */
const FADE_SECONDS = 1.15;

export class Sky {
  readonly root = new Container({
    label: "sky",
    eventMode: "none",
    interactiveChildren: false,
  });
  private readonly fill = new Graphics({
    eventMode: "none",
    label: "sky-fill",
  });
  private readonly under = new Sprite({ eventMode: "none", label: "sky-a" });
  private readonly over = new Sprite({ eventMode: "none", label: "sky-b" });
  private enabled = false;
  private target = 0;
  private displayed: string;
  private incoming: string | null = null;
  private fade = 0;
  private width = 0;
  private height = 0;

  constructor(
    width: number,
    height: number,
    private readonly paintings: ReadonlyMap<string, PixiTexture>,
  ) {
    this.displayed = paintingAt(0);
    this.root.addChild(this.fill, this.under, this.over);
    this.root.visible = false;
    this.under.alpha = 1;
    this.over.alpha = 0;
    this.resize(width, height);
    this.show(this.displayed, this.displayed, 0);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled && this.paintings.size > 0;
  }

  setCover(cover: number): void {
    this.target = clamp01(cover);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.fill.clear().rect(0, 0, width, height).fill(0x0a0a0d);
    coverScreen(this.under, width, height);
    coverScreen(this.over, width, height);
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) return;
    const wanted = paintingAt(this.target);
    if (this.incoming === null && wanted !== this.displayed) {
      this.incoming = wanted;
      this.fade = 0;
    }
    if (this.incoming !== null) {
      this.fade = Math.min(1, this.fade + deltaSeconds / FADE_SECONDS);
      this.show(this.displayed, this.incoming, this.fade);
      if (this.fade >= 1) {
        this.displayed = this.incoming;
        this.incoming = null;
        this.fade = 0;
        this.show(this.displayed, this.displayed, 0);
      }
    }
  }

  attach(stage: Container): void {
    stage.addChildAt(this.root, 0);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private show(fromFile: string, toFile: string, t: number): void {
    const from = this.paintings.get(fromFile) ?? Texture.WHITE;
    const to = this.paintings.get(toFile) ?? from;
    if (this.under.texture !== from) this.under.texture = from;
    if (this.over.texture !== to) this.over.texture = to;
    this.under.alpha = 1;
    this.over.alpha = t;
    coverScreen(this.under, this.width, this.height);
    coverScreen(this.over, this.width, this.height);
  }
}

function coverScreen(sprite: Sprite, width: number, height: number): void {
  const texture = sprite.texture;
  if (!texture || texture.width <= 0 || texture.height <= 0) return;
  const scale = Math.max(width / texture.width, height / texture.height);
  sprite.width = texture.width * scale;
  sprite.height = texture.height * scale;
  sprite.x = (width - sprite.width) / 2;
  sprite.y = (height - sprite.height) / 2;
}
