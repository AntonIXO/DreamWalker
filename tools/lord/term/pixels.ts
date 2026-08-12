/**
 * Pixel art in the terminal.
 *
 * §7.4 of the concept makes the Lord the selector: four candidates per tile, a human
 * picks the best one, and that curation is the answer to slop. For that to work, the
 * Lord has to *see* the candidates — so they get drawn right in the terminal.
 *
 * Each character cell holds two stacked pixels via the upper half-block: the top pixel
 * as foreground, the bottom as background. Because a terminal cell is about twice as
 * tall as it is wide, that lands pixels almost exactly square with no scaling.
 */

export interface PixelImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

const UPPER_HALF = "▀";
const RESET = "\x1b[0m";

export function createImage(width: number, height: number): PixelImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function setPixel(
  image: PixelImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  image.data[i] = r;
  image.data[i + 1] = g;
  image.data[i + 2] = b;
  image.data[i + 3] = a;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function pixelAt(
  image: PixelImage,
  x: number,
  y: number,
): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height)
    return [0, 0, 0, 0];
  const i = (y * image.width + x) * 4;
  return [
    image.data[i]!,
    image.data[i + 1]!,
    image.data[i + 2]!,
    image.data[i + 3]!,
  ];
}

/**
 * Renders one image to terminal lines. Transparent pixels fall back to `background`
 * so a sprite reads against the same ground it will sit on in game.
 */
export function renderImage(
  image: PixelImage,
  background = "#101014",
): string[] {
  const [br, bg, bb] = hexToRgb(background);
  const lines: string[] = [];

  for (let y = 0; y < image.height; y += 2) {
    let line = "";
    let lastTop = "";
    let lastBottom = "";

    for (let x = 0; x < image.width; x++) {
      const [tr, tg, tb, ta] = pixelAt(image, x, y);
      const [dr, dg, db, da] = pixelAt(image, x, y + 1);
      const top = ta > 0 ? `${tr};${tg};${tb}` : `${br};${bg};${bb}`;
      const bottom = da > 0 ? `${dr};${dg};${db}` : `${br};${bg};${bb}`;

      if (top !== lastTop) {
        line += `\x1b[38;2;${top}m`;
        lastTop = top;
      }
      if (bottom !== lastBottom) {
        line += `\x1b[48;2;${bottom}m`;
        lastBottom = bottom;
      }
      line += UPPER_HALF;
    }

    lines.push(line + RESET);
  }

  return lines;
}

/** Lays several images out in a row so the Lord compares them at a glance. */
export function renderRow(
  images: readonly PixelImage[],
  labels: readonly string[],
  background = "#101014",
  gap = 3,
): string {
  if (images.length === 0) return "";
  const blocks = images.map((image) => renderImage(image, background));
  const rows = Math.max(...blocks.map((b) => b.length));
  const spacer = " ".repeat(gap);
  const out: string[] = [];

  for (let row = 0; row < rows; row++) {
    out.push(
      blocks
        .map((block, i) => block[row] ?? " ".repeat(images[i]!.width))
        .join(spacer),
    );
  }

  const captions = images
    .map((image, i) => {
      const label = labels[i] ?? String(i + 1);
      const pad = Math.max(0, image.width - label.length);
      return label + " ".repeat(pad);
    })
    .join(spacer);

  return `${out.join("\n")}\n${captions}`;
}

/** A strip of colour swatches, for reviewing a palette before committing to it. */
export function renderSwatches(
  colors: readonly string[],
  cellWidth = 4,
): string {
  let top = "";
  for (const hex of colors) {
    const [r, g, b] = hexToRgb(hex);
    top += `\x1b[48;2;${r};${g};${b}m${" ".repeat(cellWidth)}`;
  }
  let labels = "";
  for (let i = 0; i < colors.length; i++) {
    labels += String(i).padEnd(cellWidth);
  }
  return `${top}${RESET}\n\x1b[90m${labels}${RESET}`;
}
