/**
 * Reading `dream-walker-new/rooms.md` into room cards.
 *
 * The importer parses *structure* and refuses to invent *geometry*. It can read which
 * rooms exist, what is in them, where their links point and what they do to the chart,
 * because the bible states all of that in a regular shape. It cannot read a floor plan
 * out of gonzo prose, and a parser that pretended otherwise would produce twenty-nine
 * rooms that all looked finished and were all wrong. So every room comes out as a blank
 * 20×11 box with its objects listed, and a human draws the ASCII.
 *
 * Two traps live in the source text:
 *
 *   - **`rooms.md` uses U+2212 MINUS SIGN**, not an ASCII hyphen, in every tonus like
 *     `(−3, −2)`. `Number("−3")` is `NaN`, so the sign has to be normalised or every
 *     downer room silently becomes an upper one.
 *   - **Link targets are prose**, not ids — «канат → Бассейн (третий этаж)». They are
 *     matched against room names by a normalised prefix, and anything that does not
 *     match is *reported*, never guessed.
 */

import type {
  DreamRoom,
  RoomHotspot,
  RoomLink,
} from "../../../src/shared/room";
import type { TonusDelta } from "../../../src/shared/tonus";

export interface ParsedRoom {
  id: string;
  /** The heading number, e.g. "01" or "М1". */
  ordinal: string;
  name: string;
  kind: "place" | "meta";
  description: string;
  objects: string[];
  animations: string;
  sound: string;
  /** Raw «left → right» pairs, unresolved. */
  links: Array<{ from: string; to: string }>;
  tonus: TonusDelta;
  tonusNote: string;
}

/** ASCII hyphen for U+2212 MINUS SIGN and U+2013 EN DASH, so `Number` can read them. */
export function normaliseMinus(text: string): string {
  return text.replace(/[−–]/g, "-");
}

/** «01. ОТЕЛЬ. ГОТИЧЕСКИЙ ХОЛЛ» → `01-otel-goticheskii-holl`. */
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "iu",
  я: "ia",
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function section(body: string, label: string): string {
  const match = body.match(
    new RegExp(`^\\s*-\\s*\\*\\*${label}:?\\*\\*\\s*(.+)$`, "m"),
  );
  return match?.[1]?.trim() ?? "";
}

function parseTonus(body: string): { tonus: TonusDelta; note: string } {
  const raw = section(body, "Тонус");
  const match = normaliseMinus(raw).match(
    /\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\)/,
  );
  const note = raw
    .replace(/^\(?\s*[+-]?\d+\s*,\s*[+-]?\d+\s*\)?\.?\s*/, "")
    .trim();
  return {
    tonus: { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) },
    note,
  };
}

/** «канат → Бассейн (третий этаж). Штаны → Раздевалка» */
function parseLinks(body: string): Array<{ from: string; to: string }> {
  const raw = section(body, "Линк");
  if (!raw) return [];
  return raw
    .split(/(?<=[а-яa-z0-9»)])\.\s+(?=[А-ЯA-ZЁ])/u)
    .flatMap((clause) => {
      const [from, to] = clause.split("→").map((part) => part.trim());
      if (!from || !to) return [];
      return [{ from: from.replace(/\.$/, ""), to: to.replace(/\.$/, "") }];
    });
}

/** Objects are one `;`-separated phrase each, with any parenthetical kept as the prompt. */
function parseObjects(body: string): string[] {
  const raw = section(body, "Предметы");
  if (!raw) return [];
  return raw
    .split(";")
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

export function parseRoomsDocument(markdown: string): ParsedRoom[] {
  const rooms: ParsedRoom[] = [];
  // Headings look like `## 01. NAME` or `## М1. NAME`. Anything else is commentary.
  const pattern = /^##\s+(\d{2}|М\d)\.\s+(.+?)\s*$/gm;
  const marks = [...markdown.matchAll(pattern)];

  marks.forEach((mark, index) => {
    const start = mark.index! + mark[0].length;
    const end = marks[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const ordinal = mark[1]!;
    const name = mark[2]!;

    // The gonzo paragraphs above the bullet list are the room's own voice.
    const prose = body
      .split(/^\s*-\s*\*\*/m)[0]!
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("*") && !line.startsWith("#"))
      .join(" ")
      .trim();

    const { tonus, note } = parseTonus(body);
    rooms.push({
      id: `${ordinal.toLowerCase().replace("м", "m")}-${slugify(name)}`,
      ordinal,
      name,
      kind: ordinal.startsWith("М") ? "meta" : "place",
      description: prose,
      objects: parseObjects(body),
      animations: section(body, "Анимации"),
      sound: section(body, "Звук"),
      links: parseLinks(body),
      tonus,
      tonusNote: note,
    });
  });

  return rooms;
}

/**
 * Match a prose link target against the rooms that exist.
 *
 * «Бассейн (третий этаж)» has to find `07-bassein-i-odnostoronnii-lift`, and
 * «Мета-пространство "КОРНИ"» has to find `m1-korni`. First significant word, then
 * a small alias table for bible names that are not room titles («квартира», «двор»).
 */
const TARGET_ALIASES: Array<{ stem: string; id: string }> = [
  { stem: "bassein", id: "07-bassein-i-odnostoronnii-lift" },
  { stem: "razdeval", id: "07-bassein-i-odnostoronnii-lift" },
  { stem: "sportzal", id: "07-bassein-i-odnostoronnii-lift" },
  { stem: "korni", id: "m1-korni" },
  { stem: "miasn", id: "m2-miasnaia-geometriia" },
  { stem: "sklad", id: "m3-sklad-ostavlennogo" },
  { stem: "ostavlen", id: "m3-sklad-ostavlennogo" },
  { stem: "razvilk", id: "m4-razvilka-gde-ty-ostalsia" },
  { stem: "kvartir", id: "08-kvartira-v-kotoroi-zhivut-drugie" },
  { stem: "dvor", id: "19-dvor-i-oranzhevye-lavochki" },
  { stem: "lavoch", id: "19-dvor-i-oranzhevye-lavochki" },
  { stem: "pogreb", id: "16-norvezhskaia-derevnia-i-pogreb" },
  { stem: "norvezh", id: "16-norvezhskaia-derevnia-i-pogreb" },
  { stem: "derevn", id: "16-norvezhskaia-derevnia-i-pogreb" },
  { stem: "niliufar", id: "21-komnata-niliufar" },
  { stem: "nilufar", id: "21-komnata-niliufar" },
  { stem: "kanav", id: "06-kanava-garazhi-podvorotni" },
  { stem: "garazh", id: "06-kanava-garazhi-podvorotni" },
  { stem: "grobami", id: "10-komnata-s-grobami" },
  { stem: "podzemn", id: "13-podzemnye-zaly-cu" },
  { stem: "zaly", id: "13-podzemnye-zaly-cu" },
  { stem: "otel", id: "01-otel-goticheskii-holl" },
  { stem: "holl", id: "01-otel-goticheskii-holl" },
];

export function resolveTarget(
  target: string,
  rooms: readonly ParsedRoom[],
): string | null {
  const cleaned = target
    .replace(/мета-?пространство/iu, "")
    .replace(/[«»"'()]/g, " ")
    .trim();
  const slugged = slugify(cleaned);
  const alias = TARGET_ALIASES.find((entry) => slugged.includes(entry.stem));
  if (alias && rooms.some((room) => room.id === alias.id)) return alias.id;

  const head = slugify(cleaned.split(/[\s,(]/)[0] ?? "");
  if (!head) return null;
  const hit = rooms.find((room) => {
    const roomHead = slugify(room.name.split(/[\s.,]/)[0] ?? "");
    return roomHead === head || room.id.includes(head);
  });
  return hit?.id ?? null;
}

/**
 * Bind a bible «from → to» to an object phrase.
 *
 * `label.startsWith(from.slice(0, 5))` dropped the courtyard intercom
 * («подъездная дверь с домофоном» vs «домофон») and most of the atlas with it.
 * A link matches when the object contains the left-hand side, or they share a
 * significant token.
 */
export function linkMatchesObject(from: string, label: string): boolean {
  const left = from
    .toLowerCase()
    .replace(/[«»"'()]/g, " ")
    .trim();
  const right = label
    .toLowerCase()
    .replace(/[«»"'()]/g, " ")
    .trim();
  if (!left || !right) return false;
  if (right.includes(left) || left.includes(right)) return true;
  const leftTokens = slugify(left)
    .split("-")
    .filter((token) => token.length >= 3);
  const rightSlug = slugify(right);
  return leftTokens.some(
    (token) => rightSlug.includes(token) || right.includes(token),
  );
}

/** Lift / floor-up is a direction, not a room name. */
export function isUpTarget(target: string): boolean {
  return /этаж\s+выше|только\s+вверх|всегда\s+на\s+этаж/iu.test(target);
}

/**
 * Russian first names in the bible to the character-folder ids they belong to.
 *
 * Only needed for `там, где <кто-то>` links, and deliberately explicit: guessing a
 * character id from a declined Russian name is exactly the kind of cleverness that fails
 * silently on the one name it gets wrong.
 */
const CHARACTER_BY_NAME: Record<string, string> = {
  лёша: "liosha-gnedkov",
  леша: "liosha-gnedkov",
  лёши: "liosha-gnedkov",
  кирилл: "kirill",
  кирилла: "kirill",
  нилюфар: "nilufar",
  турышев: "turyshev",
  антон: "anton",
};

function characterIdFor(name: string): string {
  const key = name.toLowerCase().replace(/[^а-яё]/g, "");
  return CHARACTER_BY_NAME[key] ?? key;
}

/** 20×11 at 16px is 320×176 — a room the camera can hold whole at an integer zoom. */
const W = 20;
const H = 11;

function blankCells(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    if (y === 0 || y === H - 1) rows.push("#".repeat(W));
    else if (y === 1) rows.push(`#${"=".repeat(W - 2)}#`);
    else rows.push(`#${".".repeat(W - 2)}#`);
  }
  return rows;
}

export interface ConversionReport {
  rooms: DreamRoom[];
  unresolved: Array<{ room: string; target: string }>;
}

function resolveObjectLink(
  linked: { from: string; to: string } | undefined,
  parsed: readonly ParsedRoom[],
): { link: RoomLink | null; unresolvedTarget: string | null } {
  if (!linked) return { link: null, unresolvedTarget: null };
  // «диванчик → там, где Лёша» is a link to a *person*, who moves.
  const follows = linked.to.match(/там,?\s+где\s+(\S+)/iu);
  if (follows) {
    return {
      link: { to: "figure", characterId: characterIdFor(follows[1]!) },
      unresolvedTarget: null,
    };
  }
  if (isUpTarget(linked.to)) {
    return { link: { to: "up" }, unresolvedTarget: null };
  }
  const toId = resolveTarget(linked.to, parsed);
  if (toId) {
    return {
      link: { to: "room", roomId: toId, entryId: null },
      unresolvedTarget: null,
    };
  }
  // «достать её нельзя, это проверено» — an unmatched target is more likely an
  // authored refusal than a typo, so it becomes one and is reported either way.
  return {
    link: { to: "refuse", note: linked.to },
    unresolvedTarget: linked.to,
  };
}

/**
 * Re-attach bible links to rooms that were imported under the old prefix matcher.
 *
 * Positions, images, doors and the ASCII stay. Only `kind` / `link` change, so a
 * drawn courtyard does not lose its backdrop when the intercom starts working.
 */
export function rebindRoomLinks(
  rooms: DreamRoom[],
  parsed: readonly ParsedRoom[],
): { rooms: DreamRoom[]; rebound: number } {
  const byId = new Map(parsed.map((room) => [room.id, room]));
  let rebound = 0;
  for (const room of rooms) {
    const source = byId.get(room.id);
    if (!source) continue;
    for (const hotspot of room.hotspots) {
      const linked = source.links.find((entry) =>
        linkMatchesObject(entry.from, hotspot.prompt),
      );
      const { link } = resolveObjectLink(linked, parsed);
      const before = JSON.stringify(hotspot.link);
      const after = JSON.stringify(link);
      if (before === after) continue;
      hotspot.link = link;
      if (link && link.to !== "refuse") hotspot.kind = "link";
      rebound++;
    }
  }
  return { rooms, rebound };
}

/**
 * Parsed rooms into room cards.
 *
 * Objects become `look` hotspots laid out along the middle of the room. Anything the
 * bible gives a link becomes a `link` hotspot instead. The positions are placeholders —
 * the author moves them when they draw the walls — but the *ids and prompts* are real,
 * so the writing survives the redraw.
 */
export function toRoomCards(parsed: readonly ParsedRoom[]): ConversionReport {
  const unresolved: ConversionReport["unresolved"] = [];

  const rooms = parsed.map((room) => {
    const hotspots: RoomHotspot[] = room.objects.map((phrase, index) => {
      const label = phrase.split("(")[0]!.trim();
      const linked = room.links.find((entry) =>
        linkMatchesObject(entry.from, label),
      );
      const { link, unresolvedTarget } = resolveObjectLink(linked, parsed);
      if (unresolvedTarget) {
        unresolved.push({ room: room.id, target: unresolvedTarget });
      }
      return {
        id: slugify(label) || `object-${index + 1}`,
        kind: link ? "link" : "look",
        x: 3 + (index % 6) * 2.5,
        y: 4 + Math.floor(index / 6) * 2,
        reach: 1.4,
        prompt: label,
        link,
        tonus: null,
        clueId: null,
        action: null,
        once: false,
        dwellMs: null,
      } satisfies RoomHotspot;
    });

    const isMeta = room.kind === "meta";
    return {
      id: room.id,
      name: room.name,
      kind: room.kind,
      tileSize: 16,
      width: W,
      height: H,
      cells: blankCells(),
      cellVariants: {},
      props: [],
      hotspots,
      entries: [{ id: "default", x: W / 2, y: H - 2, facing: "n" as const }],
      doors: [],
      figureSlots: isMeta
        ? []
        : [
            { id: "a", x: 5, y: 6 },
            { id: "b", x: W - 6, y: 6 },
          ],
      graphics: {
        floorRole: "floor",
        wallRole: "wall",
        propRole: "prop",
        backdropImage: null,
        backdropFit: isMeta ? ("screen" as const) : ("cells" as const),
        glitchPreset: isMeta ? ("wrong-palette" as const) : ("none" as const),
      },
      camera: "frame" as const,
      tonus: room.tonus,
      revisit: {
        // §06's ditch is the canonical case, and it says so in its own tonus note.
        escalates: room.tonus.x <= -4,
        note: room.tonusNote || null,
      },
      meta: isMeta
        ? {
            minMs: 8000,
            maxMs: 40000,
            doublesPrevious: room.id.startsWith("m1"),
            overflow: true,
          }
        : null,
      description: room.description.slice(0, 900),
      atmosphere: room.tonusNote || room.sound.slice(0, 200),
      personality: room.animations.slice(0, 300),
      tags: isMeta ? ["meta"] : [],
      copy: {
        animations: room.animations,
        sound: room.sound,
      },
    } satisfies DreamRoom;
  });

  return { rooms, unresolved };
}
