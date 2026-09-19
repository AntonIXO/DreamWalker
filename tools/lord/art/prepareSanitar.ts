/** Repack the reviewed image canvas; its figures are not on an equal 4x4 grid. */
import { readFile, writeFile } from "node:fs/promises";
import { decodePng, type DecodedImage } from "./reference";
import { encodePngRgba } from "./sheet";

export function prepareSanitar(source: DecodedImage): DecodedImage {
  const xs = [110, 370, 625, 882, 1135];
  const ys = [0, 314, 632, 936, 1266];
  const size = 48;
  const width = size * 4;
  const data = new Uint8Array(width * width * 4);
  // One scale for every pose preserves body proportions. Register the upper body,
  // not the silhouette's centre: swinging arms and feet must not shift the torso.
  const scale = 0.135;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x0 = xs[col]!;
      const x1 = xs[col + 1]!;
      const y0 = ys[row]!;
      const y1 = ys[row + 1]!;
      let top = y1;
      let bottom = y0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (source.data[(y * source.width + x) * 4 + 3]! > 128) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      let sum = 0;
      let count = 0;
      for (let y = top; y < top + (bottom - top) * 0.4; y++) {
        for (let x = x0; x < x1; x++) {
          if (source.data[(y * source.width + x) * 4 + 3]! > 128) {
            sum += x;
            count++;
          }
        }
      }
      const centre = sum / count;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sx = Math.round(centre + (x - 23.5) / scale);
          const sy = Math.round(bottom + (y - 44) / scale);
          if (sx < x0 || sx >= x1 || sy < y0 || sy >= y1) continue;
          const from = (sy * source.width + sx) * 4;
          const to = ((row * size + y) * width + col * size + x) * 4;
          data.set(source.data.subarray(from, from + 4), to);
        }
      }
    }
  }
  return { width, height: width, data };
}

if (import.meta.main) {
  const source = decodePng(
    await readFile("assets/figures/sanitar/source-imagegen.png"),
  );
  await writeFile(
    "assets/figures/sanitar/sheet.png",
    encodePngRgba(prepareSanitar(source)),
  );
}
