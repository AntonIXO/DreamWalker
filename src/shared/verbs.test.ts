import { describe, expect, test } from "bun:test";

import {
  availableVerbs,
  canDo,
  fateAfter,
  mayPress,
  type VerbContext,
} from "./verbs";

function ctx(over: Partial<VerbContext> = {}): VerbContext {
  return {
    figureId: "mama",
    fate: "present",
    leverage: [],
    lethalMeans: false,
    leading: null,
    roomKind: "place",
    ...over,
  };
}

const refusalOf = (c: VerbContext, verb: string): string | null =>
  availableVerbs(c).find((option) => option.verb === verb)?.refusal ??
  "missing";

describe("availableVerbs", () => {
  test("always offers all four, so the ones you cannot do still explain themselves", () => {
    expect(availableVerbs(ctx()).map((option) => option.verb)).toEqual([
      "talk",
      "press",
      "lead",
      "kill",
    ]);
  });

  test("the Eye can only be talked to", () => {
    const eye = ctx({
      figureId: "glaz",
      leverage: ["glaz:secret"],
      lethalMeans: true,
    });
    expect(canDo("talk", eye)).toBe(true);
    for (const verb of ["press", "lead", "kill"] as const) {
      expect(canDo(verb, eye)).toBe(false);
      expect(refusalOf(eye, verb)).toBeTruthy();
    }
  });

  test("the gatekeeper is not killed and does not follow", () => {
    const turyshev = ctx({ figureId: "turyshev", lethalMeans: true });
    expect(canDo("kill", turyshev)).toBe(false);
    expect(canDo("lead", turyshev)).toBe(false);
    // He can still be pressed — his lie is «что всё нормально».
    expect(canDo("press", ctx({ figureId: "turyshev", leverage: ["x"] }))).toBe(
      true,
    );
  });

  test("nobody in a meta-space, so no verbs there", () => {
    expect(availableVerbs(ctx({ roomKind: "meta" }))).toEqual([]);
  });
});

describe("press", () => {
  test("needs something to hold", () => {
    expect(canDo("press", ctx())).toBe(false);
    expect(refusalOf(ctx(), "press")).toContain("нечем");
    expect(canDo("press", ctx({ leverage: ["mama:traty"] }))).toBe(true);
  });

  test("Кирилл refuses it even with leverage — recognition is his price", () => {
    const kirill = ctx({ figureId: "kirill", leverage: ["kirill:zasluga"] });
    expect(canDo("press", kirill)).toBe(false);
    expect(mayPress("kirill", ["kirill:zasluga"])).toBe(false);
    expect(mayPress("mama", ["mama:traty"])).toBe(true);
  });
});

describe("kill", () => {
  test("needs the room to offer something — never a weapon you carry", () => {
    expect(canDo("kill", ctx())).toBe(false);
    expect(refusalOf(ctx(), "kill")).toContain("нечем");
    expect(canDo("kill", ctx({ lethalMeans: true }))).toBe(true);
  });
});

describe("lead", () => {
  test("one at a time", () => {
    expect(canDo("lead", ctx())).toBe(true);
    expect(canDo("lead", ctx({ leading: "papa" }))).toBe(false);
    expect(canDo("lead", ctx({ fate: "led" }))).toBe(false);
  });
});

describe("a fate closes the conversation", () => {
  test("nothing at all is offered to somebody who is not there", () => {
    for (const fate of ["dead", "gone"] as const) {
      const away = ctx({ fate, lethalMeans: true, leverage: ["x"] });
      for (const option of availableVerbs(away)) {
        expect(option.refusal).toBeTruthy();
      }
    }
  });

  test("a broken figure can still be spoken at, and will not answer", () => {
    const broken = ctx({ fate: "broken", lethalMeans: true, leverage: ["x"] });
    expect(canDo("talk", broken)).toBe(true);
    expect(canDo("press", broken)).toBe(false);
    expect(canDo("kill", broken)).toBe(false);
  });
});

describe("fateAfter", () => {
  test("only the two world verbs decide a fate by themselves", () => {
    expect(fateAfter("kill")).toBe("dead");
    expect(fateAfter("lead")).toBe("led");
    // `press` resolves to leveraged or broken inside the conversation.
    expect(fateAfter("press")).toBeNull();
    expect(fateAfter("talk")).toBeNull();
  });
});

describe("what the live dream actually offers", () => {
  test("only the figures who lie can be pressed, and that is not a special case", async () => {
    // Straight from `## ВРЁТ ПРО`. «Ничего» means no key, so `press` is never offered on
    // the killer, the Eye, Лёша, Нилюфар or the тётя — the exception falls out of the
    // material rather than being written down.
    const fs = await import("node:fs");
    const artifact = JSON.parse(
      fs.readFileSync("dreams/son/dream.json", "utf8"),
    ) as {
      content: {
        characters: Array<{ id: string; leverageId?: string | null }>;
      };
    };
    const holds = (id: string): boolean =>
      Boolean(artifact.content.characters.find((c) => c.id === id)?.leverageId);

    expect(holds("mama")).toBe(true);
    expect(holds("kirill")).toBe(true);
    for (const honest of ["ubiitsa", "glaz", "liosha-gnedkov", "tetya"]) {
      expect(holds(honest)).toBe(false);
    }
  });
});
