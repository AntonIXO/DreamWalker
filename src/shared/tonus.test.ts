import { describe, expect, test } from "bun:test";

import {
  advanceTonus,
  clampInt8,
  normaliseTonus,
  overflows,
  quadrantOf,
  scaleTonus,
  TONUS_MAX,
  TONUS_MIN,
  wrapInt8,
} from "./tonus";

describe("wrapInt8", () => {
  test("leaves a value inside the byte alone", () => {
    expect(wrapInt8(0)).toBe(0);
    expect(wrapInt8(-128)).toBe(-128);
    expect(wrapInt8(127)).toBe(127);
  });

  test("wraps one past the floor to the top — the LSD conversion", () => {
    expect(wrapInt8(-129)).toBe(127);
    expect(wrapInt8(128)).toBe(-128);
  });

  test("wraps the Gray Man case", () => {
    // −128 was the floor; one more (−10, −10) room and the marker is bright again.
    expect(wrapInt8(-138)).toBe(118);
  });

  test("survives a delta far outside the byte", () => {
    expect(wrapInt8(-1000)).toBe(24);
    expect(wrapInt8(5000)).toBe(-120);
  });
});

describe("clampInt8", () => {
  test("pins rather than wrapping", () => {
    expect(clampInt8(-129)).toBe(TONUS_MIN);
    expect(clampInt8(-100000)).toBe(TONUS_MIN);
    expect(clampInt8(128)).toBe(TONUS_MAX);
  });
});

describe("advanceTonus", () => {
  test("accumulates ordinarily", () => {
    const { position, overflowed } = advanceTonus(
      { x: -6, y: 4 },
      { x: -3, y: -2 },
      false,
    );
    expect(position).toEqual({ x: -9, y: 2 });
    expect(overflowed).toBe(false);
  });

  test("clamps and never reports overflow outside a meta-space", () => {
    const { position, overflowed } = advanceTonus(
      { x: -125, y: 0 },
      { x: -10, y: 0 },
      false,
    );
    // The pressure is stored, not spent: pinned at the floor, waiting for a meta room.
    expect(position.x).toBe(TONUS_MIN);
    expect(overflowed).toBe(false);
  });

  test("wraps and reports overflow inside a meta-space", () => {
    const { position, overflowed } = advanceTonus(
      { x: -125, y: 0 },
      { x: -10, y: 0 },
      true,
    );
    expect(position.x).toBe(121);
    expect(overflowed).toBe(true);
  });

  test("a meta-space that does not cross the edge is not an overflow", () => {
    const { overflowed } = advanceTonus({ x: 0, y: 0 }, { x: -4, y: 4 }, true);
    expect(overflowed).toBe(false);
  });

  test("either axis crossing counts", () => {
    const { position, overflowed } = advanceTonus(
      { x: 0, y: -126 },
      { x: 1, y: -6 },
      true,
    );
    expect(overflowed).toBe(true);
    expect(position.y).toBe(124);
    expect(position.x).toBe(1);
  });
});

describe("overflows", () => {
  test("marks exactly the values outside the byte", () => {
    expect(overflows(TONUS_MIN)).toBe(false);
    expect(overflows(TONUS_MAX)).toBe(false);
    expect(overflows(TONUS_MIN - 1)).toBe(true);
    expect(overflows(TONUS_MAX + 1)).toBe(true);
  });
});

describe("quadrantOf", () => {
  test("reads the axes the way rooms.md labels them", () => {
    // «09. ХАКАТОН — (+3, +3). Единственная честно Upper Dynamic комната»
    expect(quadrantOf({ x: 3, y: 3 })).toBe("upper-dynamic");
    // «02. ШКОЛА — (−3, −2). Классический Downer Static»
    expect(quadrantOf({ x: -3, y: -2 })).toBe("downer-static");
    // «19. ДВОР — (+1, −4). Upper Static»
    expect(quadrantOf({ x: 1, y: -4 })).toBe("upper-static");
    // «06. КАНАВА — (−6, +4). Самая тёмная динамика в игре»
    expect(quadrantOf({ x: -6, y: 4 })).toBe("downer-dynamic");
  });

  test("zero sits in the bright half", () => {
    expect(quadrantOf({ x: 0, y: 0 })).toBe("upper-dynamic");
  });
});

describe("normaliseTonus", () => {
  test("maps the byte onto -1..1", () => {
    expect(normaliseTonus({ x: TONUS_MAX, y: 0 }).x).toBe(1);
    expect(normaliseTonus({ x: TONUS_MIN, y: 0 }).x).toBe(-1);
    expect(normaliseTonus({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("scaleTonus", () => {
  test("multiplies both axes — «второй визит хуже первого»", () => {
    expect(scaleTonus({ x: -6, y: 4 }, 2)).toEqual({ x: -12, y: 8 });
  });
});
