/**
 * A very small raster canvas that works in palette indices rather than colours.
 *
 * Every drawing operation names a *role* — "wall", "accent" — and the palette resolves
 * it. That is the mechanical form of §7.1's rule: an asset cannot pick a colour, only a
 * job, so a dream stays one place even when its parts are made separately.
 *
 * This lives in `src/shared/` rather than under `tools/` because both sides draw with it.
 * The Lord bakes tiles into the atlas at author time; the player mints one at runtime when
 * the sleeper turns the world into something the atlas never had (`render/foundry.ts`).
 * Sharing the canvas is what makes those two indistinguishable — a tile invented mid-play
 * is drawn by the same code, from the same palette, as one baked a week ago. So: no DOM
 * and no node APIs in here, ever.
 */

import type { Palette, PaletteRole } from "../dream";
import type { Rng } from "../rng";

/** Marks a pixel as "not drawn". Chosen so it cannot collide with a real palette index. */
export const TRANSPARENT = 255;

export interface IndexedImage {
  width: number;
  height: number;
  /** One dream-palette index per pixel, or `TRANSPARENT`. */
  pixels: Uint8Array;
}

export class Raster implements IndexedImage {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly palette: Palette,
  ) {
    this.pixels = new Uint8Array(width * height).fill(TRANSPARENT);
  }

  index(role: PaletteRole): number {
    return this.palette.roles[role] ?? 0;
  }

  set(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = value;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height)
      return TRANSPARENT;
    return this.pixels[y * this.width + x]!;
  }

  put(x: number, y: number, role: PaletteRole): void {
    this.set(x, y, this.index(role));
  }

  fill(role: PaletteRole): void {
    this.pixels.fill(this.index(role));
  }

  rect(x0: number, y0: number, w: number, h: number, role: PaletteRole): void {
    const value = this.index(role);
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) this.set(x, y, value);
  }

  outline(
    x0: number,
    y0: number,
    w: number,
    h: number,
    role: PaletteRole,
  ): void {
    const value = this.index(role);
    for (let x = x0; x < x0 + w; x++) {
      this.set(x, y0, value);
      this.set(x, y0 + h - 1, value);
    }
    for (let y = y0; y < y0 + h; y++) {
      this.set(x0, y, value);
      this.set(x0 + w - 1, y, value);
    }
  }

  hLine(x0: number, x1: number, y: number, role: PaletteRole): void {
    const value = this.index(role);
    for (let x = x0; x <= x1; x++) this.set(x, y, value);
  }

  vLine(x: number, y0: number, y1: number, role: PaletteRole): void {
    const value = this.index(role);
    for (let y = y0; y <= y1; y++) this.set(x, y, value);
  }

  /** Scatter single pixels. The bread and butter of making a flat tile look worn. */
  speckle(role: PaletteRole, density: number, rng: Rng): void {
    const value = this.index(role);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (rng.chance(density)) this.set(x, y, value);
      }
    }
  }

  /** Speckle confined to a box, for dressing the middle of a tile and not its seams. */
  speckleIn(
    x0: number,
    y0: number,
    w: number,
    h: number,
    role: PaletteRole,
    density: number,
    rng: Rng,
  ): void {
    const value = this.index(role);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (rng.chance(density)) this.set(x, y, value);
      }
    }
  }

  /** Mirrors the left half onto the right. Cheap symmetry for doors and figures. */
  mirrorHorizontally(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < Math.floor(this.width / 2); x++) {
        this.set(this.width - 1 - x, y, this.get(x, y));
      }
    }
  }

  blit(source: Raster, dx: number, dy: number): void {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const value = source.get(x, y);
        if (value !== TRANSPARENT) this.set(dx + x, dy + y, value);
      }
    }
  }

  clone(): Raster {
    const copy = new Raster(this.width, this.height, this.palette);
    copy.pixels.set(this.pixels);
    return copy;
  }

  /** Shift the whole image, used to make the second frame of a two-frame walk. */
  shifted(dx: number, dy: number): Raster {
    const copy = new Raster(this.width, this.height, this.palette);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        copy.set(x + dx, y + dy, this.get(x, y));
      }
    }
    return copy;
  }
}

/** For the terminal preview: palette indices become real colours. */
export function toRgba(raster: Raster): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const data = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let i = 0; i < raster.pixels.length; i++) {
    const value = raster.pixels[i]!;
    if (value === TRANSPARENT) continue;
    const hex = raster.palette.colors[value] ?? "#000000";
    data[i * 4] = parseInt(hex.slice(1, 3), 16);
    data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    data[i * 4 + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}
