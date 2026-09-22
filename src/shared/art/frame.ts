/** Optional atlas region in an asset URL. The PNG stays shared by every sprite. */
export function imageFrame(path: string): {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sheetW: number;
  sheetH: number;
} | null {
  const match = /^(.*)#frame=(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)$/.exec(path);
  if (!match) return null;
  const [x, y, w, h, sheetW, sheetH] = match.slice(2).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (w < 1 || h < 1 || x + w > sheetW || y + h > sheetH) return null;
  return { path: match[1]!, x, y, w, h, sheetW, sheetH };
}

/** Keep an object's proportions; its lower edge stays on its collision footprint. */
export function objectArtSize(
  width: number,
  height: number,
  boxW: number,
  boxH: number,
): { width: number; height: number } {
  const scale = Math.min(boxW / Math.max(1, width), boxH / Math.max(1, height));
  return { width: width * scale, height: height * scale };
}
