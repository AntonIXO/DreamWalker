/** Author-time art and architecture. These choices never reroll during play. */
import type { DreamRoom } from "../../../src/shared/room";
import frames from "../content/assets/style/frames.json";
import { look } from "./box";

const objects = frames["objects-v2.png"];
const furniture = frames["furniture-v2.png"];
const floors = frames["floors-v2.png"];
const environment = frames["environment-v2.png"];
const details = frames["details-v2.png"];

export const SCENE_ART: Readonly<Record<string, string>> = {
  "unknown-object": furniture[14]!,
  hedge: environment[0]!,
  tree: environment[1]!,
  planter: environment[2]!,
  wall: environment[3]!,
  fence: environment[4]!,
  arch: environment[6]!,
  lantern: environment[7]!,
  paving: floors[0]!,
  corridor: floors[3]!,
};

const OBJECT_ART: Record<string, string> = {};
const ART_SIZES = new Map<string, [number, number]>([
  [objects[2]!, [0.35, 0.7]],
  [objects[5]!, [1.2, 0.8]],
  [objects[6]!, [0.45, 0.65]],
  [objects[10]!, [0.9, 1]],
  [objects[14]!, [0.9, 1.3]],
  [objects[15]!, [0.85, 0.55]],
  [furniture[0]!, [1.3, 0.7]],
  [furniture[1]!, [1, 1.3]],
  [furniture[2]!, [1.5, 0.6]],
  [furniture[3]!, [0.9, 0.6]],
  [furniture[11]!, [0.7, 0.7]],
]);
function art(sheet: string[], index: number, ...ids: string[]): void {
  for (const id of ids) OBJECT_ART[id] = sheet[index]!;
}
art(objects, 0, "oranzhevye-lavochki", "lavochka");
art(objects, 1, "urna-nabitaia-akkuratno");
art(
  objects,
  2,
  "butylka-riadom-s-turyshevym-ne-pervaia",
  "iaponskii-sidr",
  "riukzak-vodka",
);
art(
  objects,
  3,
  "podezdnaia-dver-s-domofonom",
  "dver",
  "zakrytaia-dver-v-konce-koridora",
  "dver-kotoraia-mozhet-byt-otkryta-ili-zak",
);
art(
  objects,
  4,
  "elt-s-morrowind",
  "monitor",
  "shirokii-monitor-s-chem-to-korporativnym",
);
art(objects, 5, "noutbuki-s-prodavlennymi-ekranami", "noutbuk");
art(
  objects,
  6,
  "telefon-na-sailfishos-kamera-otkryvaetsi",
  "telefon-s-odnim-kontaktom-lesha",
  "telefon-kamera-otkryvaetsia-sem-sekund",
  "telefon-s-kameroi-kotoraia-ne-uspevaet",
  "telefon-s-zagruzhaiuschimsia-tor-progres",
);
art(objects, 7, "kinder-siurpriz-s-lavochku");
art(objects, 8, "plita");
art(objects, 9, "goluboi-lipkii-slizen-na-lestnice-bit-mo");
art(
  objects,
  10,
  "riukzak",
  "riukzak-s-fruktami-i-vodkoi",
  "chuzhie-sumki-na-platforme",
);
art(objects, 11, "liuk-v-kanalizaciiu");
art(objects, 12, "party", "stol");
art(objects, 13, "grusha-za-steklom");
art(objects, 14, "vedro-i-shvabra-uborschika");
art(objects, 15, "tri-tysiachi-nomerkov");
art(
  objects,
  15,
  "beidzhi-na-shnurkah",
  "beidzh-konferencii-s-nechitaemym-nazvani",
);
art(furniture, 0, "chuzhie-shtany-na-polu", "veschi-tancevalnoi-gruppy");
art(furniture, 1, "kanat-do-svoda");
art(
  furniture,
  2,
  "tablichka-etazhi-1-3-etazhi-4-bez-poiasn",
  "nadpis-na-polke",
);
art(
  furniture,
  3,
  "listochki-na-kotoryh-tekst-meniaetsia-es",
  "zametki",
  "shemy",
  "raspisanie-ne-transporta-a-bezopasnyh-ch",
);
art(furniture, 4, "mat-v-uglu-s-rasstelennoi-posteliu", "krovat");
art(furniture, 5, "school-pear-case", "hackathon-glass-case");
art(furniture, 6, "polka-dlia-veschei", "piatimetrovyi-stellazh");
art(furniture, 7, "kapusta-frukty", "riukzak-fruit");
art(furniture, 8, "groby", "grob");
art(furniture, 9, "divanchik-na-kotorom-spit-lesha");
art(furniture, 10, "kreslo");
art(furniture, 11, "chainik-kotoryi-uzhe-kipel");
art(furniture, 12, "shkaf");
art(furniture, 13, "morozilka");
art(furniture, 14, "korobka", "korobka-s-golosom");
art(furniture, 15, "fonari-kotorye-gasiat-pri-zvuke");
art(environment, 11, "velosipedisty-proezzhaiuschie-skvoz-kori");
art(environment, 10, "stul-1", "stul-2", "stul-3");
art(environment, 15, "tablo-s-raspisaniem-gde-nomera-meniaiuts");

art(
  details,
  0,
  "polotence-radi-kotorogo-prishel-ne-nahod",
  "riukzak-folded-cloth",
);
art(details, 1, "bele-na-stenah");
art(details, 2, "panel-lifta-bez-knopki-vniz");
art(
  details,
  3,
  "beidzhi-na-shnurkah",
  "beidzh-konferencii-s-nechitaemym-nazvani",
);
art(details, 4, "odinakovye-naushniki");
art(details, 5, "rozovyi-gashish-v-vitrine");
art(details, 6, "piat-tysiach-nalichnymi-kotorye-uzhe-otd");
art(details, 7, "ventil");
art(details, 8, "kakao");
art(details, 9, "scena-mikrofon");
art(details, 10, "spasatelnye-krugi");
art(details, 11, "paket-fasoli");
art(details, 12, "vydrannyi-zub");
art(details, 13, "iaschik-s-kapibarami-i-kotom");
art(details, 14, "tribuny");
art(details, 15, "lift");
ART_SIZES.set(details[2]!, [0.6, 1]);
ART_SIZES.set(details[3]!, [0.55, 0.6]);
ART_SIZES.set(details[4]!, [0.7, 0.7]);
ART_SIZES.set(details[6]!, [0.8, 0.45]);
ART_SIZES.set(details[8]!, [0.6, 0.6]);
ART_SIZES.set(details[12]!, [0.3, 0.4]);

type Furnishing = [
  string,
  string,
  number,
  number,
  number,
  number,
  string,
  boolean?,
];
const FURNISHINGS: Record<string, Furnishing[]> = {
  "19-dvor-i-oranzhevye-lavochki": [
    ["yard-bench-2", "вторая оранжевая лавочка", 14, 7.5, 3, 1.5, objects[0]!],
    ["yard-planter", "бархатцы у лавочки", 3, 7.5, 3, 1.5, environment[2]!],
    [
      "yard-clock",
      "дворовые часы, которые спешат",
      16.5,
      2.5,
      1,
      2,
      environment[15]!,
    ],
  ],
  "01-otel-goticheskii-holl": [
    [
      "hotel-rack-1",
      "гардеробные номерки без пальто",
      3,
      2,
      4,
      1,
      environment[5]!,
    ],
    ["hotel-rack-2", "ещё один ряд гардероба", 11, 2, 4, 1, environment[5]!],
    [
      "hotel-rug",
      "ковёр, истёртый чужими шагами",
      8,
      4,
      5,
      2.5,
      environment[8]!,
      false,
    ],
  ],
  "02-shkola-kabinet-russkogo": [
    [
      "school-desk-2",
      "парта с незаполненным бланком",
      5,
      4.5,
      2,
      1.5,
      objects[12]!,
    ],
    [
      "school-desk-3",
      "парта, за которой никто не сидит",
      10,
      4.5,
      2,
      1.5,
      objects[12]!,
    ],
    [
      "school-board",
      "мел, который не стирается",
      12,
      2,
      4,
      1.5,
      environment[9]!,
    ],
    [
      "school-books",
      "учебники с одинаковой первой страницей",
      14,
      7,
      2,
      2,
      environment[14]!,
    ],
  ],
  "14-poliklinika-v-kaluge": [
    [
      "clinic-chair-1",
      "стул перед кабинетом",
      3,
      2.5,
      1,
      1.5,
      environment[10]!,
    ],
    [
      "clinic-chair-2",
      "такой же стул перед кабинетом",
      5,
      2.5,
      1,
      1.5,
      environment[10]!,
    ],
  ],
  "20-ofis-sbera": [
    ["office-chair", "стул перед экраном", 4.5, 4.5, 1, 1.5, environment[10]!],
    [
      "office-papers",
      "схемы, которые вчера работали",
      15,
      7,
      2,
      1,
      furniture[3]!,
      false,
    ],
  ],
};

function furnish(room: DreamRoom): void {
  for (const [key, prompt, x, y, w, h, image, solid = true] of FURNISHINGS[
    room.id
  ] ?? []) {
    const id = `style-${key}`;
    if (room.props.some((prop) => prop.id === id)) continue;
    room.props.push({
      id,
      x,
      y,
      w,
      h,
      image,
      solid,
      role: solid ? null : "floorDecor",
      profile: solid ? { kind: "furniture" } : { kind: "surface" },
    });
    room.hotspots.push(
      look({ id, propId: id, prompt, x: x + w / 2, y: y + h + 0.1 }),
    );
  }
}

type Shape = "apse" | "chamfer" | "diagonal" | "bow";
/** Material and silhouette belong to the place, not to a random hash. */
const ARCHITECTURE: Record<string, [Shape, number]> = {
  "01-otel-goticheskii-holl": ["apse", 1],
  "02-shkola-kabinet-russkogo": ["diagonal", 2],
  "04-dacha-gnedkovyh": ["chamfer", 2],
  "05-shesterochka": ["chamfer", 3],
  "07-bassein-i-odnostoronnii-lift": ["apse", 3],
  "09-hakaton-tretii-po-schetu": ["diagonal", 2],
  "10-komnata-s-grobami": ["apse", 1],
  "13-podzemnye-zaly-cu": ["apse", 1],
  "14-poliklinika-v-kaluge": ["bow", 3],
  "19-dvor-i-oranzhevye-lavochki": ["chamfer", 0],
  "20-ofis-sbera": ["diagonal", 2],
  "22-kreiser": ["bow", 2],
  "25-metro-i-poezd-kotoryi-ne-tot": ["bow", 3],
  "m7-rm-rf": ["diagonal", 3],
  "m9-shkaf": ["chamfer", 2],
  "m10-zamorozhennaia-morkovka": ["chamfer", 3],
};

function inset(
  shape: Shape,
  y: number,
  height: number,
  right: boolean,
): number {
  const edge = Math.min(y, height - 1 - y);
  if (shape === "chamfer") return Math.max(0, 3 - edge);
  if (shape === "apse") return y < 3 ? [5, 2, 1][y]! : 0;
  if (shape === "bow") return Math.max(0, 4 - edge * 2);
  // Parallel slanted ends read as a turned floor plan while keeping world axes
  // and controls honest. Rotating only the painting would detach every hitbox.
  return Math.max(0, 4 - Math.floor((right ? height - 1 - y : y) * 0.7));
}

function shapeRoom(room: DreamRoom, shape: Shape): void {
  const bounds = Array.from({ length: room.height }, (_, y) => ({
    left: inset(shape, y, room.height, false),
    right: room.width - 1 - inset(shape, y, room.height, true),
  }));
  // Retain authored furniture, witnesses, entry feet, and every threshold approach.
  // The outline wraps around those constraints; it never moves a narrative object.
  const keep = (
    x: number,
    y: number,
    w: number,
    h: number,
    margin: number,
  ): void => {
    for (
      let row = Math.max(0, Math.floor(y - margin));
      row < Math.min(room.height, Math.ceil(y + h + margin));
      row++
    ) {
      bounds[row]!.left = Math.min(
        bounds[row]!.left,
        Math.max(0, Math.floor(x - margin)),
      );
      bounds[row]!.right = Math.max(
        bounds[row]!.right,
        Math.min(room.width - 1, Math.ceil(x + w + margin) - 1),
      );
    }
  };
  for (const prop of room.props) keep(prop.x, prop.y, prop.w, prop.h, 1);
  for (const point of [...room.entries, ...room.figureSlots, ...room.hotspots])
    keep(point.x, point.y, 0.5, 0.5, 1);
  for (const door of room.doors) keep(door.x, door.y, door.w, door.h, 1);
  const shapeCells = (cells: string[]): string[] =>
    cells.map((row, y) =>
      [...row]
        .map((mark, x) => {
          const { left, right } = bounds[y]!;
          if (x < left || x > right) return " ";
          const north = bounds[y - 1];
          const south = bounds[y + 1];
          const boundary =
            x === left ||
            x === right ||
            !north ||
            !south ||
            x < north.left ||
            x > north.right ||
            x < south.left ||
            x > south.right;
          if (boundary && mark !== "_") return "#";
          return mark;
        })
        .join(""),
    );
  room.cells = shapeCells(room.cells);
  for (const [key, cells] of Object.entries(room.cellVariants))
    room.cellVariants[key] = shapeCells(cells);
}

const RELOCATIONS: Record<string, [number, number]> = {
  party: [3, 4],
  "listochki-na-kotoryh-tekst-meniaetsia-es": [4, 5],
  "zakrytaia-dver-v-konce-koridora": [2, 7],
  "scena-mikrofon": [12, 2],
  "cruiser-microphone-stand": [12, 2],
  "tablo-s-raspisaniem-gde-nomera-meniaiuts": [12, 2],
};

export function applyArtDirection(rooms: DreamRoom[]): void {
  for (const room of rooms) {
    furnish(room);
    for (const [index, original] of room.props.entries()) {
      const prop = { ...original };
      room.props[index] = prop;
      const position = RELOCATIONS[prop.id];
      if (position) {
        const dx = position[0] - prop.x,
          dy = position[1] - prop.y;
        prop.x = position[0];
        prop.y = position[1];
        for (const spot of room.hotspots.filter(
          (spot) => spot.propId === prop.id,
        )) {
          spot.x += dx;
          spot.y += dy;
        }
      }
      const image = OBJECT_ART[prop.id];
      if (image) {
        prop.image = image;
        // An old open-state placeholder must not replace the authored object atlas.
        if (prop.openImage) prop.openImage = image;
        const size = ART_SIZES.get(image);
        if (size) {
          // Preserve the original ground contact and approach hotspot while giving
          // a phone a phone-sized body instead of the old two-tile placeholder.
          prop.x += (prop.w - size[0]) / 2;
          prop.y += prop.h - size[1];
          [prop.w, prop.h] = size;
        }
      }
      if (prop.id === "goluboi-lipkii-slizen-na-lestnice-bit-mo")
        prop.role = "breathing";
      if (
        [
          "elt-s-morrowind",
          "monitor",
          "noutbuk",
          "noutbuki-s-prodavlennymi-ekranami",
        ].includes(prop.id)
      )
        prop.role = "screen";
    }
    const design = ARCHITECTURE[room.id];
    if (!design) continue;
    const [shape, material] = design;
    for (const entry of room.entries) {
      if (room.id === "01-otel-goticheskii-holl" && entry.id === "from-lift") {
        entry.x = 8;
        entry.y = 3.5;
      }
      if (room.id === "07-bassein-i-odnostoronnii-lift") {
        if (entry.id === "from-lift") {
          entry.x = 3;
          entry.y = 4.5;
        } else if (entry.id === "default") entry.y = 9.5;
      }
    }
    shapeRoom(room, shape);
    room.tags.push(`architecture:${shape}`, `material:${material}`);
    room.graphics.backdropImage = floors[material]!;
    room.graphics.backdropFit = "cells";
    for (const prop of room.props) {
      if (prop.id === "voda-v-chashe-basseina-slishkom-nepodviz") {
        prop.image = null;
        prop.role = "water";
      }
    }
  }
}
