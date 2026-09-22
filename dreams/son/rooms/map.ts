/**
 * A Pokémon-style map: places stay places, and you walk a road to the next one.
 *
 * Authored rooms keep their walls and their painting. A two-tile doorway opens onto a
 * route — grass, a dirt path, a tree line — that actually occupies the gap between
 * buildings. Walking east out of the courtyard is walking a street until the hotel
 * door, not a cut and not two paintings glued on a seam.
 */

import type { Direction } from "../../../src/shared/roomGrid";
import {
  cellAt,
  isWalkableCell,
  rectBlocks,
  setCellMark,
} from "../../../src/shared/roomGrid";
import { rectsOverlap } from "../../../src/shared/rect";
import type { DreamRoom, RoomDoor, RoomEntry } from "../../../src/shared/room";
import { cloneRoom } from "./box";

export type StreetDir = Direction;

interface Cell {
  x: number;
  y: number;
}

const OPPOSITE: Record<StreetDir, StreetDir> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
};

const STEP: Record<StreetDir, Cell> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

const APPROACH: Record<StreetDir, StreetDir> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
};

/** Authored rooms are 20×11. Routes occupy the leftover strip between them. */
export const PLACE_W = 20;
export const PLACE_H = 11;
export const ROAD_W = 14;
export const ROAD_H = 10;
export const STRIDE_X = PLACE_W + ROAD_W;
export const STRIDE_Y = PLACE_H + ROAD_H;
// Deliberately uneven blocks: a short courtyard passage, a long avenue, a narrow
// service lane. These are authored distances, stable for saves and every cycle.
const EAST_GAPS = [8, 23, 11, 29, 7, 18, 12];
const SOUTH_GAPS = [7, 16, 9, 23, 12, 8];
const gapX = (column: number): number => EAST_GAPS[column] ?? ROAD_W;
const gapY = (row: number): number => SOUTH_GAPS[row] ?? ROAD_H;
const DOOR_X = 9;
const DOOR_Y = 5;
const DOOR_SPAN = 2;

const ROOM_DOORWAYS: Record<
  string,
  Partial<Record<StreetDir, { x: number; y: number; w: number; h: number }>>
> = {
  "01-otel-goticheskii-holl": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "02-shkola-kabinet-russkogo": {
    n: { x: 2, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "04-dacha-gnedkovyh": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 4, w: 1, h: 2 },
  },
  "05-shesterochka": {
    n: { x: 8, y: 0, w: 4, h: 2 },
    s: { x: 7, y: 10, w: 5, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "06-kanava-garazhi-podvorotni": {
    n: { x: 8, y: 0, w: 4, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "08-kvartira-v-kotoroi-zhivut-drugie": {
    n: { x: 11, y: 0, w: 2, h: 2 },
    s: { x: 5, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "09-hakaton-tretii-po-schetu": {
    n: { x: 3, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "10-komnata-s-grobami": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "12-tiurma-na-ovoschah": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "13-podzemnye-zaly-cu": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 3, h: 1 },
    w: { x: 0, y: 4, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "14-poliklinika-v-kaluge": {
    n: { x: 8, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "16-norvezhskaia-derevnia-i-pogreb": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "17-dush-iz-kotorogo-nelzia-vyiti": {
    n: { x: 6, y: 0, w: 2, h: 2 },
    s: { x: 8, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "19-dvor-i-oranzhevye-lavochki": {
    n: { x: 7, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "20-ofis-sbera": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "21-komnata-niliufar": {
    n: { x: 12, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "22-kreiser": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 8, y: 10, w: 3, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "23-nigeriia-konferenciia": {
    n: { x: 8, y: 0, w: 3, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "24-dom-gde-tebe-obiasniaiut-chto-ty-dolzhen": {
    n: { x: 8, y: 0, w: 3, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
  "25-metro-i-poezd-kotoryi-ne-tot": {
    n: { x: 9, y: 0, w: 2, h: 2 },
    s: { x: 9, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 4, w: 1, h: 2 },
  },
  "m3-sklad-ostavlennogo": {
    n: { x: 7, y: 0, w: 2, h: 2 },
    s: { x: 7, y: 10, w: 2, h: 1 },
    w: { x: 0, y: 5, w: 1, h: 2 },
    e: { x: 19, y: 5, w: 1, h: 2 },
  },
};

/**
 * Grid: +x is east, +y is south. The courtyard is the block you spawn on.
 *
 * Extra catalogue rooms (m5–m12, the 5854 den) occupy cells that become holes in the
 * published 29-room artifact; those holes grow into woods so the camera never pans
 * onto void.
 */
export const STREET_CELLS: Readonly<Record<string, Cell>> = {
  "m3-sklad-ostavlennogo": { x: 0, y: 0 },
  "15-osennii-les-s-grobom": { x: 1, y: 0 },
  "03-gory-startapery-i-uchenye": { x: 2, y: 0 },
  "16-norvezhskaia-derevnia-i-pogreb": { x: 3, y: 0 },
  "18-kupol-bez-sten": { x: 4, y: 0 },
  "m2-miasnaia-geometriia": { x: 5, y: 0 },
  "m11-zamok-po-vremeni": { x: 6, y: 0 },

  "14-poliklinika-v-kaluge": { x: 0, y: 1 },
  "02-shkola-kabinet-russkogo": { x: 1, y: 1 },
  "09-hakaton-tretii-po-schetu": { x: 2, y: 1 },
  "20-ofis-sbera": { x: 3, y: 1 },
  "13-podzemnye-zaly-cu": { x: 4, y: 1 },
  "12-tiurma-na-ovoschah": { x: 5, y: 1 },
  "10-komnata-s-grobami": { x: 6, y: 1 },

  "05-shesterochka": { x: 0, y: 2 },
  "19-dvor-i-oranzhevye-lavochki": { x: 1, y: 2 },
  "01-otel-goticheskii-holl": { x: 2, y: 2 },
  "11-evreiskii-gorod": { x: 3, y: 2 },
  "25-metro-i-poezd-kotoryi-ne-tot": { x: 4, y: 2 },
  "22-kreiser": { x: 5, y: 2 },
  "23-nigeriia-konferenciia": { x: 6, y: 2 },

  "06-kanava-garazhi-podvorotni": { x: 0, y: 3 },
  "08-kvartira-v-kotoroi-zhivut-drugie": { x: 1, y: 3 },
  "17-dush-iz-kotorogo-nelzia-vyiti": { x: 2, y: 3 },
  "21-komnata-niliufar": { x: 3, y: 3 },
  "24-dom-gde-tebe-obiasniaiut-chto-ty-dolzhen": { x: 4, y: 3 },
  "m10-zamorozhennaia-morkovka": { x: 5, y: 3 },
  "m12-nedoliudi": { x: 6, y: 3 },

  "m1-korni": { x: 0, y: 4 },
  "04-dacha-gnedkovyh": { x: 1, y: 4 },
  "m4-razvilka-gde-ty-ostalsia": { x: 2, y: 4 },
  "m5-odinochestvo": { x: 3, y: 4 },
  "m6-krugi-vokrug-pruda": { x: 4, y: 4 },
  "m7-rm-rf": { x: 5, y: 4 },
  "m8-5854": { x: 6, y: 4 },

  "m9-shkaf": { x: 2, y: 5 },
  "m8-den": { x: 6, y: 5 },
};

const HOTEL = "01-otel-goticheskii-holl";
const POOL = "07-bassein-i-odnostoronnii-lift";

const WILD = /^(03-|06-|10-|15-|16-|18-|m1-|m2-|m4-|m5-|m6-|m9-|m10-|m11-)/;

export function isGeneratedRoom(id: string): boolean {
  return /^(path|gap|woods)-/.test(id);
}

function restoreRing(room: DreamRoom): void {
  const cells = room.cells.map((row) => row.split(""));
  for (let y = 0; y < room.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < room.width; x++) {
      const onRing =
        y === 0 || y === room.height - 1 || x === 0 || x === room.width - 1;
      const wallFace = y === 1 && x > 0 && x < room.width - 1;
      if (onRing) row[x] = "#";
      else if (wallFace) row[x] = "=";
      else if (row[x] === "_") row[x] = ".";
    }
    cells[y] = row;
  }
  room.cells = cells.map((row) => row.join(""));
}

function doorway(
  room: DreamRoom,
  dir: StreetDir,
): { x: number; y: number; w: number; h: number } {
  const custom = ROOM_DOORWAYS[room.id]?.[dir];
  if (custom) return custom;
  if (dir === "n") return { x: DOOR_X, y: 0, w: DOOR_SPAN, h: 2 };
  if (dir === "s") {
    return { x: DOOR_X, y: room.height - 1, w: DOOR_SPAN, h: 1 };
  }
  if (dir === "w") return { x: 0, y: DOOR_Y, w: 1, h: DOOR_SPAN };
  return { x: room.width - 1, y: DOOR_Y, w: 1, h: DOOR_SPAN };
}

function entryFor(room: DreamRoom, dir: StreetDir): RoomEntry {
  const door = doorway(room, dir);
  const midX = door.x + door.w / 2;
  const midY = door.y + door.h / 2;
  if (dir === "n")
    return { id: "from-n", x: midX, y: door.h + 0.3, facing: "s" };
  if (dir === "s") {
    return { id: "from-s", x: midX, y: door.y - 0.3, facing: "n" };
  }
  if (dir === "w")
    return { id: "from-w", x: door.w + 0.5, y: midY, facing: "e" };
  return { id: "from-e", x: door.x - 0.5, y: midY, facing: "w" };
}

function ensureEntry(room: DreamRoom, entry: RoomEntry): void {
  if (room.entries.some((existing) => existing.id === entry.id)) return;
  room.entries.push(entry);
}

function makeDoor(input: {
  from: DreamRoom;
  toId: string;
  dir: StreetDir;
  toEntry: string;
  threshold?: RoomDoor["threshold"];
  levelDelta?: number;
  prompt?: string | null;
  id?: string;
  rect?: { x: number; y: number; w: number; h: number };
}): RoomDoor {
  const rect = input.rect ?? doorway(input.from, input.dir);
  return {
    id: input.id ?? `${input.from.id}--${input.dir}-${input.toId}`,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    toRoomId: input.toId,
    toEntryId: input.toEntry,
    type: "open",
    threshold: input.threshold ?? "door",
    levelDelta: input.levelDelta ?? 0,
    facing: APPROACH[input.dir],
    toFigureId: null,
    keyId: null,
    prompt: input.prompt ?? null,
  };
}

function addDoor(room: DreamRoom, door: RoomDoor): void {
  room.doors.push(door);
}

/**
 * Where an authored rift can actually stand once the streets are in.
 *
 * A rift lives on the wall-face row by default, which is why it reads as a doorway you
 * press into rather than a hole you walk through. It may not sit on a street doorway, on
 * a solid prop, or outside the ring. Authored coordinates win when they fit; otherwise
 * the rift slides along the wall to the first free span, and a rift with nowhere to go is
 * dropped loudly rather than shipped pointing at nothing.
 */
function placeRift(
  room: DreamRoom,
  door: RoomDoor,
  byId: ReadonlyMap<string, DreamRoom>,
): RoomDoor | null {
  if (!byId.has(door.toRoomId)) {
    console.warn(
      `[map] rift ${door.id} dropped: ${door.toRoomId} is not a room here`,
    );
    return null;
  }
  const fits = (x: number, y: number): boolean => {
    if (x < 1 || y < 1) return false;
    if (x + door.w > room.width - 1 || y + door.h > room.height - 1)
      return false;
    const rect = { x, y, w: door.w, h: door.h };
    if (room.doors.some((other) => rectsOverlap(rect, other))) return false;
    for (let ty = y; ty < y + door.h; ty++) {
      for (let tx = x; tx < x + door.w; tx++) {
        if (rectBlocks(room.props, tx, ty)) return false;
        // Off the wall face the rift is stood on rather than pressed into, so its
        // cells have to be floor the walker can actually reach.
        if (ty !== 1 && !isWalkableCell(cellAt(room, tx, ty))) return false;
      }
    }
    return true;
  };
  if (fits(door.x, door.y)) return door;
  for (let x = 1; x + door.w <= room.width - 1; x++) {
    if (fits(x, door.y)) return { ...door, x };
  }
  console.warn(`[map] rift ${door.id} dropped: no free wall in ${room.id}`);
  return null;
}

function punch(room: DreamRoom, door: RoomDoor): void {
  let cells = room.cells;
  for (let y = door.y; y < door.y + door.h; y++) {
    for (let x = door.x; x < door.x + door.w; x++) {
      cells = setCellMark(cells, x, y, "_");
    }
  }
  room.cells = cells;
}

function originOf(cell: Cell): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < cell.x; i++) x += PLACE_W + gapX(i);
  for (let i = 0; i < cell.y; i++) y += PLACE_H + gapY(i);
  return { x, y };
}

function titleFor(
  kind: "street" | "trail" | "grove",
  id: string,
  used: Set<string>,
): string {
  if (kind === "trail") {
    return pickUnique(TRAIL_ADJ, TRAIL_NOUN, rngOf(id), used, "тропа");
  }
  if (kind === "grove") {
    return pickUnique(GROVE_ADJ, GROVE_NOUN, rngOf(id), used, "роща");
  }
  return pickUnique(STREET_ADJ, STREET_NOUN, rngOf(id), used, "переулок");
}

function emptyRoute(
  id: string,
  name: string,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cells: string[],
  entries?: RoomEntry[],
): DreamRoom {
  return {
    id,
    name,
    kind: "place",
    tileSize: 16,
    width,
    height,
    originX,
    originY,
    cells,
    cellVariants: {},
    props: [],
    hotspots: [],
    entries: entries ?? [
      {
        id: "from-w",
        x: 1.5,
        y: Math.min(height - 1.5, DOOR_Y + 1),
        facing: "e",
      },
      {
        id: "from-e",
        x: width - 1.5,
        y: Math.min(height - 1.5, DOOR_Y + 1),
        facing: "w",
      },
      {
        id: "from-n",
        x: Math.min(width - 1.5, DOOR_X + 1),
        y: 1.5,
        facing: "s",
      },
      {
        id: "from-s",
        x: Math.min(width - 1.5, DOOR_X + 1),
        y: height - 1.5,
        facing: "n",
      },
    ],
    doors: [],
    figureSlots: [],
    graphics: {
      floorRole: "path",
      wallRole: "tree",
      propRole: "prop",
      backdropImage: null,
      backdropFit: "cells",
      glitchPreset: "none",
    },
    camera: "follow",
    revisit: { escalates: false, note: null },
    meta: null,
    description: "Дорога между местами. Идёшь, пока не упрёшься в дверь.",
    atmosphere: "",
    personality: "ветер в траве, шаг слышно отдельно от города",
    tags: ["route"],
    copy: {},
    buildingId: null,
    level: 0,
  };
}

function rngOf(seed: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    s = Math.imul(s ^ seed.charCodeAt(i), 16777619);
  }
  s = s >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function grid(width: number, height: number, fill: string): string[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => fill),
  );
}

function paint(cells: string[][], x: number, y: number, mark: string): void {
  const row = cells[y];
  if (!row || x < 0 || x >= row.length) return;
  row[x] = mark;
}

function hstrip(
  cells: string[][],
  x0: number,
  x1: number,
  y: number,
  mark: string,
): void {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x++) paint(cells, x, y, mark);
}

function vstrip(
  cells: string[][],
  x: number,
  y0: number,
  y1: number,
  mark: string,
): void {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let y = lo; y <= hi; y++) paint(cells, x, y, mark);
}

function freeze(cells: string[][]): string[] {
  return cells.map((row) => row.join(""));
}

const STREET_ADJ = [
  "тихий",
  "чужой",
  "мокрый",
  "второй",
  "задний",
  "пустой",
  "ночной",
  "крашеный",
  "узкий",
  "широкий",
  "глухой",
  "знакомый",
];
const STREET_NOUN = [
  "переулок",
  "двор",
  "тротуар",
  "проход",
  "тупик",
  "съезд",
  "коридор",
  "карман",
];
const TRAIL_ADJ = [
  "кривая",
  "сырая",
  "чужая",
  "короткая",
  "нижняя",
  "верхняя",
  "забытая",
  "вытоптанная",
  "корявая",
  "тихая",
];
const TRAIL_NOUN = [
  "тропа",
  "просека",
  "низина",
  "обход",
  "щель",
  "гряда",
  "лощина",
  "кромка",
];
const GROVE_ADJ = [
  "редкая",
  "густая",
  "чужая",
  "малая",
  "внутренняя",
  "мокрая",
  "сухая",
  "кривая",
  "дальняя",
  "ближняя",
];
const GROVE_NOUN = [
  "роща",
  "поляна",
  "чаща",
  "посадка",
  "пустошь",
  "куртина",
  "опушка",
  "заросль",
];

function pickUnique(
  adjs: string[],
  nouns: string[],
  rnd: () => number,
  used: Set<string>,
  fallback: string,
): string {
  for (let i = 0; i < 80; i++) {
    const title = `${adjs[Math.floor(rnd() * adjs.length)]!} ${nouns[Math.floor(rnd() * nouns.length)]!}`;
    if (!used.has(title)) {
      used.add(title);
      return title.toUpperCase();
    }
  }
  const forced = `${fallback} ${used.size + 1}`;
  used.add(forced);
  return forced.toUpperCase();
}

function routeCells(
  id: string,
  width: number,
  height: number,
  start: number,
  end: number,
  horizontal: boolean,
): string[] {
  const cells = grid(width, height, "t");
  const rnd = rngOf(id);
  const length = horizontal ? width : height;
  const breadth = horizontal ? height : width;
  const bend = (rnd() < 0.5 ? -1 : 1) * (2 + Math.floor(rnd() * 3));
  const set = (along: number, across: number, mark: string): void => {
    paint(
      cells,
      horizontal ? along : across,
      horizontal ? across : along,
      mark,
    );
  };
  let previous = start;
  for (let i = 0; i < length; i++) {
    const t = i / Math.max(1, length - 1);
    // Flat mouths prevent a diagonal bottleneck at a doorway. The bend only starts
    // after the walker has crossed the shared room edge.
    const envelope = i < 2 || i >= length - 2 ? 0 : Math.sin(Math.PI * t) ** 2;
    const center =
      i === 0
        ? start
        : i === length - 1
          ? end
          : Math.max(
              1,
              Math.min(
                breadth - 3,
                Math.round(start * (1 - t) + end * t + bend * envelope),
              ),
            );
    const lo = Math.min(previous, center);
    const hi = Math.max(previous, center) + 1;
    for (let j = lo - 1; j <= hi + 1; j++) {
      if (j >= 0 && j < breadth) set(i, j, j >= lo && j <= hi ? "p" : "g");
    }
    previous = center;
  }
  return freeze(cells);
}

function eastWestCells(
  id: string,
  width: number,
  height: number,
  yWest = DOOR_Y,
  yEast = DOOR_Y,
): string[] {
  return routeCells(id, width, height, yWest, yEast, true);
}

function northSouthCells(
  id: string,
  width: number,
  height: number,
  xNorth = DOOR_X,
  xSouth = DOOR_X,
): string[] {
  return routeCells(id, width, height, xNorth, xSouth, false);
}

function groveCells(id: string, width: number, height: number): string[] {
  const rnd = rngOf(id);
  const cells = grid(width, height, "g");
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  // Cross pathways connecting all 4 edges
  hstrip(cells, 0, width - 1, cy, "p");
  hstrip(cells, 0, width - 1, cy + 1, "p");
  vstrip(cells, cx, 0, height - 1, "p");
  vstrip(cells, cx + 1, 0, height - 1, "p");

  // Scatter some trees and tall grass on the corners, leaving paths fully open
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (Math.abs(x - cx) <= 1 || Math.abs(y - cy) <= 1) continue;
      const r = rnd();
      if (r < 0.25) paint(cells, x, y, "t");
      else if (r < 0.55) paint(cells, x, y, "h");
      else if (r < 0.7) paint(cells, x, y, "g");
    }
  }
  stamp(cells, rnd, width, height);
  return freeze(cells);
}

function stamp(
  cells: string[][],
  rnd: () => number,
  width: number,
  height: number,
): void {
  const ux = 2 + Math.floor(rnd() * Math.max(1, width - 5));
  const uy = 2 + Math.floor(rnd() * Math.max(1, height - 5));
  paint(cells, ux, uy, "p");
  paint(cells, ux + 1, uy, "g");
  paint(cells, ux, uy + 1, "h");
}

function uniqueCells(id: string, rows: string[], used: Set<string>): string[] {
  const cells = rows.map((row) => row.split(""));
  const rnd = rngOf(`${id}:unique`);
  let key = freeze(cells).join("\n");
  let n = 0;
  while (used.has(key) && n < 40) {
    stamp(cells, rnd, cells[0]?.length ?? 1, cells.length);
    key = freeze(cells).join("\n");
    n++;
  }
  used.add(key);
  return freeze(cells);
}

function dressRoute(room: DreamRoom): void {
  const rnd = rngOf(`${room.id}:loot`);
  if (rnd() >= 0.35) return;
  const spots: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      const mark = room.cells[y]?.[x];
      if (mark !== "p" && mark !== "g" && mark !== "h") continue;
      const onMouth =
        x <= 1 || x >= room.width - 2 || y <= 1 || y >= room.height - 2;
      if (onMouth) continue;
      spots.push({ x, y });
    }
  }
  if (spots.length === 0) return;
  const spot = spots[Math.floor(rnd() * spots.length)]!;
  room.figureSlots.push({
    id: "a",
    x: Math.min(room.width - 3, Math.max(2, spot.x + 2)),
    y: Math.min(room.height - 3, Math.max(2, spot.y)),
  });
}

/**
 * Strip generated connectors, hang a two-tile doorway on every neighbour, and fill
 * the gap with a route you actually walk.
 */
export function applyStreetMap(rooms: readonly DreamRoom[]): DreamRoom[] {
  const next = rooms.filter((room) => !isGeneratedRoom(room.id)).map(cloneRoom);
  const byId = new Map(next.map((room) => [room.id, room]));
  const at = new Map<string, string>();
  for (const [id, cell] of Object.entries(STREET_CELLS)) {
    if (byId.has(id)) at.set(`${cell.x},${cell.y}`, id);
  }

  // Authored rifts are put back after the streets are drawn, so `riftFits` can see the
  // generated doorways it must not sit on. §4.1: the streets are the spine and a rift is
  // an extra створ — never the only way anywhere, or the map stops being crossable.
  const riftsByRoom = new Map<string, RoomDoor[]>();

  for (const room of next) {
    riftsByRoom.set(
      room.id,
      room.doors
        .filter((door) => door.threshold === "rift")
        .map((door) => ({ ...door, toEntryId: "default" })),
    );
    restoreRing(room);
    const cell = STREET_CELLS[room.id];
    if (cell) {
      const origin = originOf(cell);
      room.originX = origin.x;
      room.originY = origin.y;
      room.camera = "follow";
      if (room.kind === "meta") room.graphics.backdropFit = "cells";
    }
    room.doors = [];
    const defaultEntry =
      room.entries.find((entry) => entry.id === "default") ?? room.entries[0];
    room.entries = defaultEntry ? [{ ...defaultEntry, id: "default" }] : [];
    if (room.entries.length === 0) {
      room.entries.push({
        id: "default",
        x: room.width / 2,
        y: room.height - 2,
        facing: "n",
      });
    }
  }

  const generated: DreamRoom[] = [];
  const usedTitles = new Set<string>();
  const usedLayouts = new Set<string>();
  const dirs: StreetDir[] = ["e", "s"];
  for (const room of next) {
    const cell = STREET_CELLS[room.id];
    if (!cell) continue;
    for (const dir of dirs) {
      const step = STEP[dir];
      const neighbourId = at.get(`${cell.x + step.x},${cell.y + step.y}`);
      if (!neighbourId) continue;
      const neighbour = byId.get(neighbourId);
      if (!neighbour) continue;
      const pathId = `path-${cell.x}-${cell.y}-${dir}`;
      const wild = WILD.test(room.id) || WILD.test(neighbourId);
      const name = titleFor(wild ? "trail" : "street", pathId, usedTitles);
      const origin = originOf(cell);
      const fromDir = dir;
      const toDir = OPPOSITE[dir];
      const doorFrom = doorway(room, fromDir);
      const doorTo = doorway(neighbour, toDir);

      const roadWidth = gapX(cell.x);
      const roadHeight = gapY(cell.y);
      const path =
        dir === "e"
          ? emptyRoute(
              pathId,
              name,
              roadWidth,
              PLACE_H,
              origin.x + PLACE_W,
              origin.y,
              uniqueCells(
                pathId,
                eastWestCells(
                  pathId,
                  roadWidth,
                  PLACE_H,
                  Math.floor(doorFrom.y + (doorFrom.h - 2) / 2),
                  Math.floor(doorTo.y + (doorTo.h - 2) / 2),
                ),
                usedLayouts,
              ),
              [
                {
                  id: "from-w",
                  x: 1.5,
                  y: doorFrom.y + doorFrom.h / 2,
                  facing: "e",
                },
                {
                  id: "from-e",
                  x: roadWidth - 1.5,
                  y: doorTo.y + doorTo.h / 2,
                  facing: "w",
                },
              ],
            )
          : emptyRoute(
              pathId,
              name,
              PLACE_W,
              roadHeight,
              origin.x,
              origin.y + PLACE_H,
              uniqueCells(
                pathId,
                northSouthCells(
                  pathId,
                  PLACE_W,
                  roadHeight,
                  Math.floor(doorFrom.x + (doorFrom.w - 2) / 2),
                  Math.floor(doorTo.x + (doorTo.w - 2) / 2),
                ),
                usedLayouts,
              ),
              [
                {
                  id: "from-n",
                  x: doorFrom.x + doorFrom.w / 2,
                  y: 1.5,
                  facing: "s",
                },
                {
                  id: "from-s",
                  x: doorTo.x + doorTo.w / 2,
                  y: roadHeight - 1.5,
                  facing: "n",
                },
              ],
            );
      if (!wild) path.tags.push("passage:arcade");
      dressRoute(path);
      addDoor(
        room,
        makeDoor({
          from: room,
          toId: pathId,
          dir: fromDir,
          toEntry: `from-${toDir}`,
          prompt: wild ? "на тропу" : "на улицу",
        }),
      );
      ensureEntry(room, entryFor(room, fromDir));
      addDoor(
        neighbour,
        makeDoor({
          from: neighbour,
          toId: pathId,
          dir: toDir,
          toEntry: `from-${fromDir}`,
          prompt: wild ? "на тропу" : "на улицу",
        }),
      );
      ensureEntry(neighbour, entryFor(neighbour, toDir));
      if (dir === "e") {
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: room.id,
            dir: "w",
            toEntry: "from-e",
            rect: { x: 0, y: doorFrom.y, w: 1, h: doorFrom.h },
          }),
        );
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: neighbour.id,
            dir: "e",
            toEntry: "from-w",
            rect: { x: roadWidth - 1, y: doorTo.y, w: 1, h: doorTo.h },
          }),
        );
      } else {
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: room.id,
            dir: "n",
            toEntry: "from-s",
            rect: { x: doorFrom.x, y: 0, w: doorFrom.w, h: 1 },
          }),
        );
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: neighbour.id,
            dir: "s",
            toEntry: "from-n",
            rect: { x: doorTo.x, y: roadHeight - 1, w: doorTo.w, h: 1 },
          }),
        );
      }
      generated.push(path);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of at.keys()) {
    const [x, y] = id.split(",").map(Number);
    minX = Math.min(minX, x!);
    minY = Math.min(minY, y!);
    maxX = Math.max(maxX, x!);
    maxY = Math.max(maxY, y!);
  }
  if (Number.isFinite(minX)) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const roadWidth = gapX(x);
        const roadHeight = gapY(y);
        const hasPlace = at.has(`${x},${y}`);
        const hasEast = at.has(`${x + 1},${y}`);
        const hasSouth = at.has(`${x},${y + 1}`);
        const origin = originOf({ x, y });
        if (!hasPlace) {
          const woods = emptyRoute(
            `woods-${x}-${y}`,
            titleFor("grove", `woods-${x}-${y}`, usedTitles),
            PLACE_W + roadWidth,
            PLACE_H + roadHeight,
            origin.x,
            origin.y,
            uniqueCells(
              `woods-${x}-${y}`,
              groveCells(
                `woods-${x}-${y}`,
                PLACE_W + roadWidth,
                PLACE_H + roadHeight,
              ),
              usedLayouts,
            ),
          );
          dressRoute(woods);
          generated.push(woods);
          continue;
        }
        if (!hasEast) {
          const gap = emptyRoute(
            `gap-${x}-${y}-e`,
            titleFor("grove", `gap-${x}-${y}-e`, usedTitles),
            roadWidth,
            PLACE_H,
            origin.x + PLACE_W,
            origin.y,
            uniqueCells(
              `gap-${x}-${y}-e`,
              groveCells(`gap-${x}-${y}-e`, roadWidth, PLACE_H),
              usedLayouts,
            ),
          );
          dressRoute(gap);
          generated.push(gap);
        }
        if (!hasSouth) {
          const gap = emptyRoute(
            `gap-${x}-${y}-s`,
            titleFor("grove", `gap-${x}-${y}-s`, usedTitles),
            PLACE_W,
            roadHeight,
            origin.x,
            origin.y + PLACE_H,
            uniqueCells(
              `gap-${x}-${y}-s`,
              groveCells(`gap-${x}-${y}-s`, PLACE_W, roadHeight),
              usedLayouts,
            ),
          );
          dressRoute(gap);
          generated.push(gap);
        }
        const corner = emptyRoute(
          `gap-${x}-${y}-se`,
          titleFor("grove", `gap-${x}-${y}-se`, usedTitles),
          roadWidth,
          roadHeight,
          origin.x + PLACE_W,
          origin.y + PLACE_H,
          uniqueCells(
            `gap-${x}-${y}-se`,
            groveCells(`gap-${x}-${y}-se`, roadWidth, roadHeight),
            usedLayouts,
          ),
        );
        dressRoute(corner);
        generated.push(corner);
      }
    }
  }

  const hotel = byId.get(HOTEL);
  const pool = byId.get(POOL);
  if (hotel && pool) {
    pool.originX = hotel.originX;
    pool.originY = hotel.originY;
    pool.camera = "follow";
    ensureEntry(hotel, {
      id: "from-lift",
      x: 5,
      y: 2.2,
      facing: "s",
    });
    ensureEntry(pool, {
      id: "from-lift",
      x: 5,
      y: 2.2,
      facing: "s",
    });
    addDoor(hotel, {
      id: `${HOTEL}--lift-${POOL}`,
      x: 3,
      y: 8,
      w: 2,
      h: 1,
      toRoomId: POOL,
      toEntryId: "from-lift",
      type: "open",
      threshold: "lift",
      levelDelta: 2,
      facing: "s",
      toFigureId: null,
      keyId: null,
      prompt: "лифт на третий этаж",
    });
    addDoor(pool, {
      id: `${POOL}--lift-${HOTEL}`,
      x: 3,
      y: 8,
      w: 2,
      h: 1,
      toRoomId: HOTEL,
      toEntryId: "from-lift",
      type: "open",
      threshold: "lift",
      levelDelta: 1,
      facing: "s",
      toFigureId: null,
      keyId: null,
      prompt: "лифт — только вверх",
    });
  }

  for (const room of next) {
    for (const door of riftsByRoom.get(room.id) ?? []) {
      const placed = placeRift(room, door, byId);
      if (placed) addDoor(room, placed);
    }
  }

  const all = [...next, ...generated];
  for (const room of all) {
    for (const door of room.doors) {
      // A rift is not punched: it stays set into the wall, and the walker fires it by
      // pressing into the solid cell ahead (`player.ts` doorAhead). Punching it would
      // turn the wall row into a hole and let the player walk out of the room.
      if (door.threshold !== "door" && door.threshold !== "lift") continue;
      punch(room, door);
    }
  }
  return all;
}

export function neighbourOf(
  roomId: string,
  dir: StreetDir,
): string | undefined {
  const cell = STREET_CELLS[roomId];
  if (!cell) return undefined;
  const step = STEP[dir];
  for (const [id, other] of Object.entries(STREET_CELLS)) {
    if (other.x === cell.x + step.x && other.y === cell.y + step.y) return id;
  }
  return undefined;
}
