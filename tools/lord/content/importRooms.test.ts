import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BIBLE_DIR } from "../project";
import {
  linkMatchesObject,
  normaliseMinus,
  parseRoomsDocument,
  resolveTarget,
  slugify,
  toRoomCards,
} from "./importRooms";

const roomsPath = join(BIBLE_DIR, "rooms.md");

const markdown = readFileSync(roomsPath, "utf8");
const parsed = parseRoomsDocument(markdown);

describe("the bible path", () => {
  test("lord import reads dream-walker-anton, not a missing dream-walker-new", () => {
    expect(BIBLE_DIR.endsWith("dream-walker-anton")).toBe(true);
    expect(existsSync(join(BIBLE_DIR, "rooms.md"))).toBe(true);
    expect(existsSync(join(BIBLE_DIR, "rooms-meta.md"))).toBe(true);
  });
});

describe("parseRoomsDocument", () => {
  test("finds all 25 places and 4 meta-spaces", () => {
    expect(parsed).toHaveLength(29);
    expect(parsed.filter((room) => room.kind === "meta")).toHaveLength(4);
  });

  test("ids are stable and readable", () => {
    expect(parsed[0]!.id).toBe("01-otel-goticheskii-holl");
    expect(parsed.at(-1)!.id).toBe("m4-razvilka-gde-ty-ostalsia");
  });
});

describe("the bible's mood line", () => {
  // The Upper/Downer chart is gone from the engine (`game/pressure.ts`), but the line is
  // still authored writing and still the only place the corpus says how bad a room is.
  // The importer reads it to decide which rooms escalate on a revisit, and to fill
  // `atmosphere`, and then throws the numbers away.
  test("reads U+2212 MINUS SIGN, which is what the document actually uses", () => {
    // `Number("−3")` is NaN. Getting this wrong turns every downer room into an upper one.
    expect(normaliseMinus("(−3, −2)")).toBe("(-3, -2)");
    expect(Number(normaliseMinus("−8"))).toBe(-8);
  });

  test("reads a leading plus", () => {
    // The first version of the regex was /-?\d+/, so `(+2, +1)` silently became 0 and
    // only rooms negative on both axes survived. Twenty of twenty-nine were quietly
    // flattened, and nothing failed.
    const hackathon = parsed.find((room) => room.id.startsWith("09"))!;
    expect(hackathon.moodDowner).toBe(3);
  });

  test("reads a mixed pair, and keeps the prose after it", () => {
    // §16, the deepest room in the game: «(−8, +6). Максимальный размах.»
    const norway = parsed.find((room) => room.id.startsWith("16"))!;
    expect(norway.moodDowner).toBe(-8);
    expect(norway.moodNote).toContain("размах");
    // §06, the ditch: the room the escalation rule was written for.
    const ditch = parsed.find((room) => room.id.startsWith("06"))!;
    expect(ditch.moodDowner).toBe(-6);
  });

  test("only the deep rooms escalate on a revisit", () => {
    const escalating = parsed.filter((room) => room.moodDowner <= -4);
    expect(escalating.some((room) => room.id.startsWith("06"))).toBe(true);
    expect(escalating.length).toBeGreaterThan(0);
    expect(escalating.length).toBeLessThan(parsed.length);
  });
});

describe("links", () => {
  test("resolves a prose target to a room id", () => {
    expect(resolveTarget("Бассейн (третий этаж)", parsed)).toBe(
      "07-bassein-i-odnostoronnii-lift",
    );
    expect(resolveTarget("Мета-пространство «КОРНИ»", parsed)).toBe("m1-korni");
  });

  test("returns null rather than guessing", () => {
    expect(resolveTarget("Мета-пространство «ЛЕСТНИЦА»", parsed)).toBeNull();
  });

  test("aliases bible names that are not room titles", () => {
    expect(resolveTarget("Квартира", parsed)).toBe(
      "08-kvartira-v-kotoroi-zhivut-drugie",
    );
    expect(resolveTarget("Раздевалка", parsed)).toBe(
      "07-bassein-i-odnostoronnii-lift",
    );
    expect(resolveTarget("комната Нилюфар", parsed)).toBe(
      "21-komnata-niliufar",
    );
  });

  test("binds an object that contains the link's left side", () => {
    expect(linkMatchesObject("домофон", "подъездная дверь с домофоном")).toBe(
      true,
    );
    expect(linkMatchesObject("Штаны", "чужие штаны на полу")).toBe(true);
    expect(
      linkMatchesObject("мат с постелью", "мат в углу с расстеленной постелью"),
    ).toBe(true);
    expect(linkMatchesObject("домофон", "оранжевые лавочки")).toBe(false);
  });

  test("the courtyard intercom is reported as a way into the apartment", () => {
    // Reported, not built. A rift is a doorway and a doorway goes in a wall somebody
    // drew, so the importer says what connects and `lord floors` says where.
    const { rifts, rooms } = toRoomCards(parsed);
    const intercom = rifts.find(
      (rift) => rift.room.startsWith("19") && rift.label.includes("домофон"),
    );
    expect(intercom?.toRoomId).toBe("08-kvartira-v-kotoroi-zhivut-drugie");

    const yard = rooms.find((room) => room.id.startsWith("19"))!;
    const hotspot = yard.hotspots.find((h) => h.prompt.includes("домофон"))!;
    expect(hotspot.kind).toBe("look");
  });

  test("«там, где Лёша» is reported against a person, not a place", () => {
    const { rifts } = toRoomCards(parsed);
    const couch = rifts.find((rift) => rift.toFigureId !== null);
    expect(couch?.toFigureId).toBe("liosha-gnedkov");
    expect(couch?.toRoomId).toBeNull();
  });
});

describe("toRoomCards", () => {
  const { rooms, unresolved } = toRoomCards(parsed);

  test("meta-spaces bleed to the screen and hold nobody", () => {
    for (const room of rooms.filter((r) => r.kind === "meta")) {
      expect(room.graphics.backdropFit).toBe("screen");
      expect(room.figureSlots).toHaveLength(0);
      expect(room.doors).toHaveLength(0);
      expect(room.meta).not.toBeNull();
    }
  });

  test("a meta-space is a timer, and nothing else", () => {
    const korni = rooms.find((room) => room.id === "m1-korni")!;
    expect(korni.meta).toEqual({ minMs: 8000, maxMs: 40000 });
    expect(korni.doors).toEqual([]);
  });

  test("an unmatched target is reported and becomes an authored refusal", () => {
    expect(unresolved.length).toBeGreaterThan(0);
    const refusals = rooms.flatMap((room) =>
      room.hotspots.filter((hotspot) => hotspot.refusal !== null),
    );
    expect(refusals.length).toBe(unresolved.length);
    for (const hotspot of refusals) expect(hotspot.refusal).toBeTruthy();
  });

  test("no object leads anywhere by itself any more", () => {
    for (const room of rooms) {
      for (const hotspot of room.hotspots) {
        expect("link" in hotspot).toBe(false);
      }
    }
  });

  test("every room is a walkable box until somebody draws it", () => {
    for (const room of rooms) {
      expect(room.cells).toHaveLength(room.height);
      expect(room.cells[0]!.length).toBe(room.width);
      expect(room.entries.length).toBeGreaterThan(0);
    }
  });
});

describe("slugify", () => {
  test("transliterates rather than dropping Cyrillic", () => {
    expect(slugify("ШЕСТЁРОЧКА")).toBe("shesterochka");
    expect(slugify("КАНАВА, ГАРАЖИ, ПОДВОРОТНИ")).toBe(
      "kanava-garazhi-podvorotni",
    );
  });
});
