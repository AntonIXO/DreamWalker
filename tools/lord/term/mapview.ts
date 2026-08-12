/**
 * Showing the Lord a map before they commit to it.
 *
 * Two views, because they answer different questions. The colour preview draws one
 * pixel per tile and answers "does this read as a place?". The glyph map draws one
 * character per cell and answers "where are the gates, and is the shape of the mission
 * any good?". Rerolling without both is guesswork.
 */

import {
  NodeType,
  decodeTiles,
  type DreamMap,
  type MissionGraph,
  type Palette,
  type PaletteRole,
} from "../../../src/shared/dream";
import { TILE_PALETTE_ROLE } from "../../../src/shared/tilecodes";
import { color } from "./prompt";
import {
  createImage,
  hexToRgb,
  renderImage,
  setPixel,
  type PixelImage,
} from "./pixels";

/** One pixel per tile, coloured from the dream's own palette. */
export function tilePreview(map: DreamMap, palette: Palette): PixelImage {
  const tiles = decodeTiles(map.tiles, map.width * map.height);
  const image = createImage(map.width, map.height);

  const colorOf = (role: string): [number, number, number] => {
    const index = palette.roles[role as PaletteRole] ?? 0;
    return hexToRgb(palette.colors[index] ?? "#000000");
  };

  const cache = new Map<number, [number, number, number]>();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = tiles[y * map.width + x]!;
      let rgb = cache.get(tile);
      if (!rgb) {
        rgb = colorOf(TILE_PALETTE_ROLE[tile] ?? "background");
        cache.set(tile, rgb);
      }
      setPixel(image, x, y, rgb[0], rgb[1], rgb[2]);
    }
  }

  const [hr, hg, hb] = colorOf("highlight");
  setPixel(image, map.spawn.x, map.spawn.y, hr, hg, hb);

  return image;
}

const NODE_GLYPH: Record<string, string> = {
  [NodeType.START]: "S",
  [NodeType.END]: "E",
  [NodeType.KEY]: "k",
  [NodeType.LOCK]: "L",
  [NodeType.PUZZLE]: "P",
  [NodeType.LEVER]: "v",
  [NodeType.NORMAL]: "o",
};

const NODE_COLOR: Record<string, (s: string) => string> = {
  [NodeType.START]: color.green,
  [NodeType.END]: color.magenta,
  [NodeType.KEY]: color.yellow,
  [NodeType.LOCK]: color.red,
  [NodeType.PUZZLE]: color.cyan,
  [NodeType.LEVER]: color.blue,
  [NodeType.NORMAL]: (s: string) => s,
};

/** One character per layout cell: rooms by type, corridors as faint dots. */
export function cellMap(map: DreamMap): string {
  const maxX = Math.max(...map.rooms.map((r) => r.cell.cx));
  const maxY = Math.max(...map.rooms.map((r) => r.cell.cy));
  const grid: string[][] = Array.from({ length: maxY + 1 }, () =>
    Array.from({ length: maxX + 1 }, () => " "),
  );

  for (const room of map.rooms) {
    if (room.kind === "connector") {
      grid[room.cell.cy]![room.cell.cx] = color.grey("·");
      continue;
    }
    const type = room.nodeType ?? NodeType.NORMAL;
    const glyph = NODE_GLYPH[type] ?? "o";
    grid[room.cell.cy]![room.cell.cx] = (
      NODE_COLOR[type] ?? ((s: string) => s)
    )(glyph);
  }

  return grid.map((row) => row.join(" ")).join("\n");
}

export function legend(): string {
  return [
    `${color.green("S")} start`,
    `${color.magenta("E")} end`,
    `${color.yellow("k")} leverage`,
    `${color.red("L")} refused`,
    `${color.cyan("P")} world-gated`,
    `${color.blue("v")} backdoor`,
    "o room",
    color.grey("· passage"),
  ].join("   ");
}

/** The mission behind the map: how deep it goes and what gates it. */
export function describeGraph(graph: MissionGraph): string {
  const counts = new Map<string, number>();
  for (const node of graph.nodes)
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);

  const depth = Math.max(...graph.nodes.map((n) => n.accessLevel));
  const gated = graph.edges.filter(
    (e) => e.door === "keyLock" || e.door === "puzzleLock",
  ).length;
  const loops = graph.edges.length - graph.nodes.length + 1;

  const parts = [...counts.entries()]
    .filter(([type]) => type !== NodeType.START && type !== NodeType.END)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");

  return [
    `  ${color.bold(String(graph.nodes.length))} rooms · ${parts}`,
    `  depth ${color.bold(String(depth))} · ${gated} gates · ${Math.max(0, loops)} loops`,
  ].join("\n");
}

/** Everything the Lord needs to judge a reroll, in one screen. */
export function previewMap(
  map: DreamMap,
  palette: Palette,
  seedLabel: string,
): void {
  console.log();
  console.log(
    renderImage(
      tilePreview(map, palette),
      palette.colors[palette.roles.background],
    ).join("\n"),
  );
  console.log();
  console.log(cellMap(map));
  console.log();
  console.log(legend());
  console.log();
  console.log(describeGraph(map.graph));
  console.log(
    `  ${color.grey(`${map.width}x${map.height} tiles · ${map.doors.length} doors · seed ${seedLabel}`)}`,
  );
}
