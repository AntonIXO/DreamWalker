/**
 * A Pokémon-style map: places stay places, and you walk a road to the next one.
 *
 * Authored rooms keep their walls and their painting. A two-tile doorway opens onto a
 * route — grass, a dirt path, a tree line — that actually occupies the gap between
 * buildings. Walking east out of the courtyard is walking a street until the hotel
 * door, not a cut and not two paintings glued on a seam.
 */

import type { Direction } from "../../../src/shared/roomGrid";
import { setCellMark } from "../../../src/shared/roomGrid";
import type {
  DreamRoom,
  RoomDoor,
  RoomEntry,
  RoomHotspot,
  RoomProp,
} from "../../../src/shared/room";
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
const DOOR_X = 9;
const DOOR_Y = 5;
const DOOR_SPAN = 2;

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

function isPuzzleDoor(door: RoomDoor): boolean {
  return /^m8-5854--day-\d+$/.test(door.id);
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
  if (dir === "n") return { x: DOOR_X, y: 0, w: DOOR_SPAN, h: 2 };
  if (dir === "s") {
    return { x: DOOR_X, y: room.height - 1, w: DOOR_SPAN, h: 1 };
  }
  if (dir === "w") return { x: 0, y: DOOR_Y, w: 1, h: DOOR_SPAN };
  return { x: room.width - 1, y: DOOR_Y, w: 1, h: DOOR_SPAN };
}

function entryFor(room: DreamRoom, dir: StreetDir): RoomEntry {
  const midX = DOOR_X + 1;
  const midY = DOOR_Y + 1;
  if (dir === "n") return { id: "from-n", x: midX, y: 2.3, facing: "s" };
  if (dir === "s") {
    return { id: "from-s", x: midX, y: room.height - 2.3, facing: "n" };
  }
  if (dir === "w") return { id: "from-w", x: 1.5, y: midY, facing: "e" };
  return { id: "from-e", x: room.width - 1.5, y: midY, facing: "w" };
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
  return { x: cell.x * STRIDE_X, y: cell.y * STRIDE_Y };
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
    entries: [
      { id: "from-w", x: 1.5, y: DOOR_Y + 1, facing: "e" },
      { id: "from-e", x: width - 1.5, y: DOOR_Y + 1, facing: "w" },
      { id: "from-n", x: DOOR_X + 1, y: 1.5, facing: "s" },
      { id: "from-s", x: DOOR_X + 1, y: height - 1.5, facing: "n" },
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

const LOOT: Array<{ image: string; prompt: string }> = [
  {
    image:
      "assets/objects/19-dvor-i-oranzhevye-lavochki--butylka-riadom-s-turyshevym-ne-pervaia.png",
    prompt: "бутылка, уже не первая",
  },
  {
    image:
      "assets/objects/19-dvor-i-oranzhevye-lavochki--urna-nabitaia-akkuratno.png",
    prompt: "урна не на своём месте",
  },
  {
    image: "assets/objects/06-kanava-garazhi-podvorotni--riukzak.png",
    prompt: "рюкзак, который тяжелее, чем выглядит",
  },
  {
    image:
      "assets/objects/06-kanava-garazhi-podvorotni--sledy-shin-kotoryh-utrom-ne-bylo.png",
    prompt: "следы шин поперёк тропы",
  },
  {
    image:
      "assets/objects/05-shesterochka--korzina-s-chem-to-chto-ne-chitaetsia.png",
    prompt: "корзина с тем, что не читается",
  },
  {
    image:
      "assets/objects/09-hakaton-tretii-po-schetu--odinakovye-naushniki.png",
    prompt: "наушники, оба левых",
  },
  {
    image:
      "assets/objects/01-otel-goticheskii-holl--chuzhie-shtany-na-polu.png",
    prompt: "чужие штаны на гравии",
  },
  {
    image:
      "assets/objects/25-metro-i-poezd-kotoryi-ne-tot--chuzhie-sumki-na-platforme.png",
    prompt: "сумка, которую уже искали",
  },
  {
    image: "assets/objects/11-evreiskii-gorod--kinder-siurpriz-s-lavochku.png",
    prompt: "киндер с лавочки",
  },
  {
    image:
      "assets/objects/15-osennii-les-s-grobom--listia-shurshaschie-ne-v-takt-shagam.png",
    prompt: "листья, которые шуршат не в такт",
  },
  {
    image: "assets/objects/20-ofis-sbera--beidzhi-na-shnurkah.png",
    prompt: "бейдж на ветке",
  },
  {
    image:
      "assets/objects/04-dacha-gnedkovyh--telefon-s-odnim-kontaktom-lesha.png",
    prompt: "телефон с одним контактом",
  },
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

function eastWestCells(id: string, width: number, height: number): string[] {
  const rnd = rngOf(id);
  const cells = grid(width, height, "t");
  const yA = DOOR_Y;
  const yB = DOOR_Y + 1;
  for (let x = 0; x < width; x++) {
    paint(cells, x, yA, "p");
    paint(cells, x, yB, "p");
  }
  const variant = Math.floor(rnd() * 5);
  if (variant === 0) {
    for (let x = 3; x < width - 3; x++) {
      for (let y = yA - 2; y <= yB + 2; y++) {
        paint(cells, x, y, rnd() < 0.25 ? "h" : "p");
      }
    }
  } else if (variant === 1) {
    const ax = 3 + Math.floor(rnd() * Math.max(1, width - 8));
    vstrip(cells, ax, 2, yA, "p");
    vstrip(cells, ax + 1, 2, yA, "p");
    paint(cells, ax, 2, "g");
    paint(cells, ax + 1, 2, "g");
  } else if (variant === 2) {
    const ax = 3 + Math.floor(rnd() * Math.max(1, width - 8));
    vstrip(cells, ax, yB, height - 3, "p");
    vstrip(cells, ax + 1, yB, height - 3, "p");
    paint(cells, ax, height - 3, "g");
    paint(cells, ax + 1, height - 3, "g");
  } else if (variant === 3) {
    const cx = Math.floor(width / 2);
    paint(cells, cx, yA, "t");
    paint(cells, cx, yB, "t");
    paint(cells, cx, yA - 1, "p");
    paint(cells, cx, yB + 1, "p");
    paint(cells, cx - 1, yA - 1, "p");
    paint(cells, cx + 1, yB + 1, "p");
  } else {
    for (let x = 1; x < width - 1; x++) {
      paint(cells, x, yA - 1, rnd() < 0.35 ? "h" : "g");
      paint(cells, x, yB + 1, rnd() < 0.35 ? "h" : "g");
    }
  }
  stamp(cells, rnd, width, height);
  return freeze(cells);
}

function northSouthCells(id: string, width: number, height: number): string[] {
  const rnd = rngOf(id);
  const cells = grid(width, height, "t");
  const xA = DOOR_X;
  const xB = DOOR_X + 1;
  for (let y = 0; y < height; y++) {
    paint(cells, xA, y, "p");
    paint(cells, xB, y, "p");
  }
  const variant = Math.floor(rnd() * 5);
  if (variant === 0) {
    for (let y = 2; y < height - 2; y++) {
      for (let x = xA - 2; x <= xB + 2; x++) {
        paint(cells, x, y, rnd() < 0.25 ? "h" : "p");
      }
    }
  } else if (variant === 1) {
    const ay = 2 + Math.floor(rnd() * Math.max(1, height - 6));
    hstrip(cells, 2, xA, ay, "p");
    hstrip(cells, 2, xA, ay + 1, "p");
    paint(cells, 2, ay, "g");
    paint(cells, 2, ay + 1, "g");
  } else if (variant === 2) {
    const ay = 2 + Math.floor(rnd() * Math.max(1, height - 6));
    hstrip(cells, xB, width - 3, ay, "p");
    hstrip(cells, xB, width - 3, ay + 1, "p");
    paint(cells, width - 3, ay, "g");
    paint(cells, width - 3, ay + 1, "g");
  } else if (variant === 3) {
    const cy = Math.floor(height / 2);
    paint(cells, xA, cy, "t");
    paint(cells, xB, cy, "t");
    paint(cells, xA - 1, cy, "p");
    paint(cells, xB + 1, cy, "p");
  } else {
    for (let y = 1; y < height - 1; y++) {
      paint(cells, xA - 1, y, rnd() < 0.35 ? "h" : "g");
      paint(cells, xB + 1, y, rnd() < 0.35 ? "h" : "g");
    }
  }
  stamp(cells, rnd, width, height);
  return freeze(cells);
}

function groveCells(id: string, width: number, height: number): string[] {
  const rnd = rngOf(id);
  const cells = grid(width, height, "t");
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const variant = Math.floor(rnd() * 4);
  if (variant === 0) {
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        paint(cells, x, y, rnd() < 0.45 ? "g" : rnd() < 0.5 ? "h" : "p");
      }
    }
  } else if (variant === 1) {
    hstrip(cells, 2, width - 3, cy, "p");
    vstrip(cells, cx, 2, height - 3, "p");
    for (let i = 0; i < 8; i++) {
      paint(
        cells,
        2 + Math.floor(rnd() * Math.max(1, width - 4)),
        2 + Math.floor(rnd() * Math.max(1, height - 4)),
        "g",
      );
    }
  } else if (variant === 2) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const ring =
          Math.abs(x - cx) + Math.abs(y - cy) < 3
            ? "p"
            : rnd() < 0.3
              ? "g"
              : "t";
        paint(cells, x, y, ring);
      }
    }
  } else {
    for (let y = 2; y < height - 2; y++) {
      hstrip(cells, 2, width - 3, y, y % 2 === 0 ? "p" : "g");
      if (rnd() < 0.4)
        paint(cells, 2 + Math.floor(rnd() * (width - 4)), y, "t");
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
  let key = freeze(cells);
  let n = 0;
  while (used.has(key) && n < 40) {
    stamp(cells, rnd, cells[0]?.length ?? 1, cells.length);
    key = freeze(cells);
    n++;
  }
  used.add(key);
  return freeze(cells);
}

function dressRoute(room: DreamRoom, usedLoot: Set<string>): void {
  const rnd = rngOf(`${room.id}:loot`);
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
  const unused = LOOT.filter((item) => !usedLoot.has(item.image));
  const pool = unused.length > 0 ? unused : LOOT;
  const loot = pool[Math.floor(rnd() * pool.length)];
  if (!loot) return;
  usedLoot.add(loot.image);
  const spot = spots[Math.floor(rnd() * spots.length)]!;
  const propId = `${room.id}--find`;
  const prop: RoomProp = {
    id: propId,
    x: spot.x,
    y: spot.y,
    w: 1,
    h: 1,
    solid: false,
    role: null,
    image: loot.image,
  };
  const hotspot: RoomHotspot = {
    id: propId,
    kind: "look",
    x: spot.x + 0.5,
    y: spot.y + 1.15,
    reach: 1.3,
    prompt: loot.prompt,
    refusal: null,
    clueId: null,
    propId,
    action: null,
    once: false,
    dwellMs: null,
  };
  room.props.push(prop);
  room.hotspots.push(hotspot);
  if (rnd() < 0.35) {
    room.figureSlots.push({
      id: "a",
      x: Math.min(room.width - 3, Math.max(2, spot.x + 2)),
      y: Math.min(room.height - 3, Math.max(2, spot.y)),
    });
  }
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

  for (const room of next) {
    const kept = room.doors
      .filter((door) => isPuzzleDoor(door))
      .map((door) => ({
        ...door,
        threshold: "door" as const,
        toEntryId: door.toEntryId ?? "default",
      }));
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
    for (const door of kept) addDoor(room, door);
  }

  const generated: DreamRoom[] = [];
  const usedTitles = new Set<string>();
  const usedLoot = new Set<string>();
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
      const path =
        dir === "e"
          ? emptyRoute(
              pathId,
              name,
              ROAD_W,
              PLACE_H,
              origin.x + PLACE_W,
              origin.y,
              uniqueCells(
                pathId,
                eastWestCells(pathId, ROAD_W, PLACE_H),
                usedLayouts,
              ),
            )
          : emptyRoute(
              pathId,
              name,
              PLACE_W,
              ROAD_H,
              origin.x,
              origin.y + PLACE_H,
              uniqueCells(
                pathId,
                northSouthCells(pathId, PLACE_W, ROAD_H),
                usedLayouts,
              ),
            );
      dressRoute(path, usedLoot);
      const fromDir = dir;
      const toDir = OPPOSITE[dir];
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
            rect: { x: 0, y: DOOR_Y, w: 1, h: DOOR_SPAN },
          }),
        );
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: neighbour.id,
            dir: "e",
            toEntry: "from-w",
            rect: { x: ROAD_W - 1, y: DOOR_Y, w: 1, h: DOOR_SPAN },
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
            rect: { x: DOOR_X, y: 0, w: DOOR_SPAN, h: 1 },
          }),
        );
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: neighbour.id,
            dir: "s",
            toEntry: "from-n",
            rect: { x: DOOR_X, y: ROAD_H - 1, w: DOOR_SPAN, h: 1 },
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
        const hasPlace = at.has(`${x},${y}`);
        const hasEast = at.has(`${x + 1},${y}`);
        const hasSouth = at.has(`${x},${y + 1}`);
        const origin = originOf({ x, y });
        if (!hasPlace) {
          const woods = emptyRoute(
            `woods-${x}-${y}`,
            titleFor("grove", `woods-${x}-${y}`, usedTitles),
            STRIDE_X,
            STRIDE_Y,
            origin.x,
            origin.y,
            uniqueCells(
              `woods-${x}-${y}`,
              groveCells(`woods-${x}-${y}`, STRIDE_X, STRIDE_Y),
              usedLayouts,
            ),
          );
          dressRoute(woods, usedLoot);
          generated.push(woods);
          continue;
        }
        if (!hasEast) {
          const gap = emptyRoute(
            `gap-${x}-${y}-e`,
            titleFor("grove", `gap-${x}-${y}-e`, usedTitles),
            ROAD_W,
            PLACE_H,
            origin.x + PLACE_W,
            origin.y,
            uniqueCells(
              `gap-${x}-${y}-e`,
              groveCells(`gap-${x}-${y}-e`, ROAD_W, PLACE_H),
              usedLayouts,
            ),
          );
          dressRoute(gap, usedLoot);
          generated.push(gap);
        }
        if (!hasSouth) {
          const gap = emptyRoute(
            `gap-${x}-${y}-s`,
            titleFor("grove", `gap-${x}-${y}-s`, usedTitles),
            PLACE_W,
            ROAD_H,
            origin.x,
            origin.y + PLACE_H,
            uniqueCells(
              `gap-${x}-${y}-s`,
              groveCells(`gap-${x}-${y}-s`, PLACE_W, ROAD_H),
              usedLayouts,
            ),
          );
          dressRoute(gap, usedLoot);
          generated.push(gap);
        }
        const corner = emptyRoute(
          `gap-${x}-${y}-se`,
          titleFor("grove", `gap-${x}-${y}-se`, usedTitles),
          ROAD_W,
          ROAD_H,
          origin.x + PLACE_W,
          origin.y + PLACE_H,
          uniqueCells(
            `gap-${x}-${y}-se`,
            groveCells(`gap-${x}-${y}-se`, ROAD_W, ROAD_H),
            usedLayouts,
          ),
        );
        dressRoute(corner, usedLoot);
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

  const all = [...next, ...generated];
  for (const room of all) {
    for (const door of room.doors) {
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
