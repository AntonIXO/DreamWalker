/** Explicit authored semantics. Display names and sprite dimensions never grant verbs. */
import type { PhysicalProfile } from "../../src/shared/object-profile";
import {
  clonePhysicalProfile,
  compilePhysicalProfile,
} from "../../src/shared/object-profile";
import type { DreamRoom, RoomProp } from "../../src/shared/room";
import { look } from "./rooms/box";

const PROFILES = new Map<string, PhysicalProfile>();
function define(profile: PhysicalProfile, ...ids: string[]): void {
  for (const id of ids) PROFILES.set(id, profile);
}

define(
  { kind: "portable" },
  "tri-tysiachi-nomerkov",
  "telefon-na-sailfishos-kamera-otkryvaetsi",
  "vedro-i-shvabra-uborschika",
  "listochki-na-kotoryh-tekst-meniaetsia-es",
  "telefon-s-odnim-kontaktom-lesha",
  "polotence-radi-kotorogo-prishel-ne-nahod",
  "bumazhnaia-skulptura",
  "chuzhie-fotografii-v-tvoih-ramkah",
  "chainik-kotoryi-uzhe-kipel",
  "noutbuki-s-prodavlennymi-ekranami",
  "odinakovye-naushniki",
  "piat-tysiach-nalichnymi-kotorye-uzhe-otd",
  "tkan-s-kodami",
  "paketiki-fsb",
  "telefon-kamera-otkryvaetsia-sem-sekund",
  "raspisanie-ne-transporta-a-bezopasnyh-ch",
  "paket-fasoli",
  "iaponskii-sidr",
  "mazi-kotorymi-ty-predlagaesh-pomazatsia-",
  "vydrannyi-zub",
  "fotografiia-klassnogo-rukovoditelia-lica",
  "butylka-riadom-s-turyshevym-ne-pervaia",
  "elt-s-morrowind",
  "shirokii-monitor-s-chem-to-korporativnym",
  "spasatelnye-krugi",
  "kakao",
  "kusok-miasa-naznachennyi-bomboi",
  "telefon-s-kameroi-kotoraia-ne-uspevaet",
  "telefon-s-zagruzhaiuschimsia-tor-progres",
  "zametki",
  "shemy",
  "monitor",
  "noutbuk",
  "vypiska",
  "zapiska",
  "schet",
  "tablichka-etazhi-1-3-etazhi-4-bez-poiasn",
  "grusha-za-steklom",
  "vizitki-kotorye-ne-berutsia-v-ruku",
  "rozovyi-gashish-v-vitrine",
  "akcionnyi-cennik-na-kotorom-cena-meniaet",
  "kapusta-frukty",
  "listia-shurshaschie-ne-v-takt-shagam",
);
define(
  { kind: "garment", material: "cloth" },
  "chuzhie-shtany-na-polu",
  "bele-na-stenah",
  "veschi-tancevalnoi-gruppy",
);
define({ kind: "garment", wear: { slot: "head" } }, "vr-shlemy-na-stoikah");
define(
  { kind: "garment" },
  "beidzhi-na-shnurkah",
  "beidzh-konferencii-s-nechitaemym-nazvani",
);
define(
  { kind: "bag", material: "cloth" },
  "riukzak",
  "riukzak-s-fruktami-i-vodkoi",
  "chuzhie-sumki-na-platforme",
);
define(
  { kind: "portable", container: "open" },
  "korzina-s-chem-to-chto-ne-chitaetsia",
  "paket",
);
define({ kind: "portable", container: "closed" }, "korobka");
define(
  { kind: "furniture" },
  "party",
  "kamen-s-rovno-otpilennoi-graniu",
  "polka-dlia-veschei",
  "demo-stend-na-kotorom-rabotaet-chto-to-c",
  "kinder-siurpriz-s-lavochku",
  "nakrytye-stoly",
  "stol",
);
define(
  { kind: "furniture", container: "closed" },
  "iaschik-s-kapibarami-i-kotom",
  "morozilka",
  "iacheika",
);
define({ kind: "furniture", container: "open" }, "urna-nabitaia-akkuratno");
define(
  { kind: "furniture", occupancy: { pose: "sitting" } },
  "oranzhevye-lavochki",
  "lavochka",
  "stul",
  "stul-1",
  "stul-2",
  "stul-3",
  "kreslo",
);
define(
  { kind: "furniture", occupancy: { pose: "lying" } },
  "mat-v-uglu-s-rasstelennoi-posteliu",
  "divanchik-na-kotorom-spit-lesha",
  "krovat",
);
define(
  { kind: "furniture", container: "closed", occupancy: { pose: "hidden" } },
  "shkaf",
);
define(
  {
    kind: "furniture",
    material: "wood",
    container: "closed",
    occupancy: { pose: "lying", x: 1, y: 1.5 },
  },
  "groby",
  "grob",
);
define(
  { kind: "mechanism" },
  "plita",
  "liuk-v-kanalizaciiu",
  "panel-lifta-bez-knopki-vniz",
  "fonari-kotorye-gasiat-pri-zvuke",
  "stavni-na-vsem",
  "dver",
  "ventil",
  "podezdnaia-dver-s-domofonom",
  "lift",
  "zakrytaia-dver-v-konce-koridora",
  "dver-kotoraia-mozhet-byt-otkryta-ili-zak",
  "tablo-s-raspisaniem-gde-nomera-meniaiuts",
  "ekran",
);
define(
  { kind: "person" },
  "goluboi-lipkii-slizen-na-lestnice-bit-mo",
  "chuzhaia-zhenschina-svalivshaiasia-siuda",
  "tetia-sidiaschaia-spinoi",
  "velosipedisty-proezzhaiuschie-skvoz-kori",
  "otec-na-kraiu",
  "kirill-riadom-molchit",
  "zveri",
  "figura-na-beregu",
);
define(
  { kind: "structure" },
  "kanat-do-svoda",
  "centroid",
  "otodvinutyi-kusok-steny-s-chernym-proemo",
  "schel-pod-potolkom",
  "dyrka-v-zabore",
  "piatimetrovyi-stellazh",
  "tribuny",
  "piramida-tualet-s-sovetskim-kafelem-vnut",
  "pogreb-s-korniami",
  "karkas-kupola-bez-sten",
  "koliuchaia-provoloka",
  "okno-s-vidom",
  "kolonny",
  "otel-u-kotorogo-vnutrennii-obem-menshe-v",
);
define(
  { kind: "surface" },
  "nadpis-na-polke",
  "sledy-shin-kotoryh-utrom-ne-bylo",
  "voda-v-chashe-basseina-slishkom-nepodviz",
  "mercaiuschee-v-vozduhe-elektrichestvo-pr",
  "sneg-kotoryi-techet",
  "kafel-na-odnoi-plitke-kotorogo-chto-to-n",
  "snezhnoe-pole-do-gorizonta",
  "voda-za-bortom-slishkom-blizko-k-palube",
  "prud",
  "nomera",
  "nadpis",
);

define(
  { kind: "mechanism", mobility: "carryable" },
  "teodolit-pokazyvaiuschii-odno-i-to-zhe-c",
  "korobka-s-golosom",
);
define(
  {
    kind: "portable",
    attachment: { toObjectId: "guard-belt-anchor", detachable: true },
  },
  "ballonchik-na-poiase-ohrannika",
);
define(
  {
    kind: "mechanism",
    mobility: "carryable",
    attachment: { toObjectId: "cruiser-microphone-stand", detachable: true },
  },
  "scena-mikrofon",
);

export function authorPhysicalProfiles(rooms: DreamRoom[]): DreamRoom[] {
  for (const room of rooms) {
    for (const prop of room.props) {
      const profile = prop.profile ?? PROFILES.get(prop.id);
      if (!profile)
        throw new Error(
          `Missing authored physical profile: ${room.id}:${prop.id}`,
        );
      compilePhysicalProfile(profile);
      prop.profile = clonePhysicalProfile(profile);
      if (prop.id === "grob" || prop.id === "groby")
        prop.openImage = "assets/objects/coffin-open.png";
    }
    for (const hotspot of room.hotspots) {
      if (hotspot.propId || hotspot.kind === "figure" || hotspot.kind === "ui")
        continue;
      const profile = hotspot.profile ?? PROFILES.get(hotspot.id);
      if (!profile)
        throw new Error(
          `Missing authored physical profile: ${room.id}:${hotspot.id}`,
        );
      compilePhysicalProfile(profile);
      hotspot.profile = clonePhysicalProfile(profile);
    }
  }
  return rooms;
}

function addItem(room: DreamRoom, item: RoomProp, prompt: string): void {
  room.props.push(item);
  room.hotspots.push(
    look({
      id: item.id,
      propId: item.id,
      prompt,
      x: item.x + item.w / 2,
      y: item.y + item.h + 0.1,
    }),
  );
}

/** Garments and real backpack contents are authored objects, never model inventions. */
export function addLivingObjects(rooms: DreamRoom[]): void {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  // A physical case may obstruct a portable object; its old prose must not ban taking it.
  for (const [roomId, itemId, caseId, label] of [
    [
      "02-shkola-kabinet-russkogo",
      "grusha-za-steklom",
      "school-pear-case",
      "стеклянный футляр с грушей",
    ],
    [
      "09-hakaton-tretii-po-schetu",
      "rozovyi-gashish-v-vitrine",
      "hackathon-glass-case",
      "стеклянная витрина",
    ],
  ]) {
    const room = roomById.get(roomId!)!;
    const item = room.props.find((prop) => prop.id === itemId)!;
    addItem(
      room,
      {
        id: caseId!,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        solid: true,
        role: "prop",
        image: null,
        profile: {
          kind: "furniture",
          mobility: "fixed",
          material: "glass",
          container: "closed",
        },
      },
      label!,
    );
    room.props[room.props.indexOf(item)] = {
      ...item,
      inside: caseId!,
      w: 1,
      h: 1,
      solid: false,
    };
    const hotspot = room.hotspots.find((entry) => entry.propId === item.id);
    if (hotspot) hotspot.refusal = null;
  }
  for (const [roomId, itemId, mountId, label] of [
    [
      "05-shesterochka",
      "ballonchik-na-poiase-ohrannika",
      "guard-belt-anchor",
      "пояс с креплением для баллончика",
    ],
    [
      "22-kreiser",
      "scena-mikrofon",
      "cruiser-microphone-stand",
      "микрофонная стойка на сцене",
    ],
  ]) {
    const room = roomById.get(roomId!)!;
    const item = room.props.find((prop) => prop.id === itemId)!;
    addItem(
      room,
      {
        id: mountId!,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        solid: false,
        role: "prop",
        image: null,
        profile: { kind: "structure" },
      },
      label!,
    );
  }
  const cards = roomById
    .get("03-gory-startapery-i-uchenye")!
    .hotspots.find(
      (hotspot) => hotspot.id === "vizitki-kotorye-ne-berutsia-v-ruku",
    );
  if (cards) {
    cards.refusal = null;
    cards.prompt = "визитки, выскальзывающие из ладони";
  }
  const bagContents = [
    {
      room: "06-kanava-garazhi-podvorotni",
      bag: "riukzak",
      id: "riukzak-folded-cloth",
      name: "свёрнутая ткань из рюкзака",
      image: "assets/objects/10-komnata-s-grobami--tkan-s-kodami.png",
    },
    {
      room: "13-podzemnye-zaly-cu",
      bag: "riukzak-s-fruktami-i-vodkoi",
      id: "riukzak-fruit",
      name: "фрукты из рюкзака",
      image: "assets/objects/12-tiurma-na-ovoschah--kapusta-frukty.png",
    },
    {
      room: "13-podzemnye-zaly-cu",
      bag: "riukzak-s-fruktami-i-vodkoi",
      id: "riukzak-vodka",
      name: "бутылка водки из рюкзака",
      image: "assets/objects/13-podzemnye-zaly-cu--iaponskii-sidr.png",
    },
  ];
  for (const content of bagContents) {
    const room = roomById.get(content.room)!;
    const bag = room.props.find((prop) => prop.id === content.bag)!;
    addItem(
      room,
      {
        id: content.id,
        x: bag.x,
        y: bag.y,
        w: 1,
        h: 1,
        solid: false,
        role: null,
        image: content.image,
        inside: bag.id,
        profile: { kind: "portable" },
      },
      content.name,
    );
  }
  const wardrobe = roomById.get("m3-sklad-ostavlennogo")!;
  const clothes = [
    [
      "hudozhnik",
      "пиджак художника",
      "assets/objects/01-otel-goticheskii-holl--chuzhie-shtany-na-polu.png",
    ],
    [
      "lysyi",
      "одежда Лысого с тяжёлыми часами",
      "assets/objects/20-ofis-sbera--beidzhi-na-shnurkah.png",
    ],
    [
      "ded-slava",
      "рабочая куртка деда Славы",
      "assets/objects/07-bassein-i-odnostoronnii-lift--bele-na-stenah.png",
    ],
  ];
  clothes.forEach(([id, prompt, image], index) =>
    addItem(
      wardrobe,
      {
        id: `outfit-${id}`,
        x: 4 + index * 4,
        y: 3,
        w: 1,
        h: 1,
        solid: false,
        role: null,
        image: image!,
        profile: {
          kind: "garment",
          material: "cloth",
          wear: { slot: "body", appearanceFigureId: id! },
        },
      },
      prompt!,
    ),
  );
}

/** Applied after street authoring, so the ordinary street network remains unchanged. */
export function addPreparedPassages(rooms: DreamRoom[]): void {
  const bindings = [
    [
      "10-komnata-s-grobami",
      "tkan-s-kodami",
      "15-osennii-les-s-grobom",
      "под тканью — створ в осенний лес",
    ],
    [
      "05-shesterochka",
      "polka-dlia-veschei",
      "m3-sklad-ostavlennogo",
      "за полкой — проход на склад оставленного",
    ],
    [
      "15-osennii-les-s-grobom",
      "grob",
      "10-komnata-s-grobami",
      "под гробом — лестничный створ к другим гробам",
    ],
    ["m9-shkaf", "shkaf", "m6-krugi-vokrug-pruda", "за шкафом — створ к пруду"],
  ];
  for (const [roomId, propId, target, prompt] of bindings) {
    const room = rooms.find((candidate) => candidate.id === roomId)!;
    const prop = room.props.find((candidate) => candidate.id === propId)!;
    room.doors.push({
      id: `${roomId}--secret-${propId}`,
      x: prop.x,
      y: prop.y + prop.h - 1,
      w: 1,
      h: 1,
      toRoomId: target!,
      toEntryId: "default",
      type: "open",
      threshold: "rift",
      levelDelta: 0,
      facing: null,
      toFigureId: null,
      keyId: null,
      prompt: prompt!,
      hidden: true,
      revealBy: { objectId: propId!, when: "moved" },
    });
  }
  // Generated roads contain authored terrain furniture, never inventory objects.
  for (const room of rooms)
    for (const prop of room.props) {
      if (prop.profile) continue;
      if (!room.tags.includes("route"))
        throw new Error(`Unprofiled prop: ${room.id}:${prop.id}`);
      prop.profile = { kind: "structure" };
    }
}
