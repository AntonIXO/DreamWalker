import { describe, expect, test } from "bun:test";

import { paintingAt, SKY_PAINTINGS } from "./sky";
import { routeOpensOntoSky } from "./roomScene";

describe("paintingAt", () => {
  test("cover picks one still, it does not blend neighbouring files", () => {
    expect(paintingAt(0)).toBe("night.jpg");
    expect(paintingAt(0.17)).toBe("overcast.jpg");
    expect(paintingAt(1)).toBe("yesterday.jpg");
  });

  test("a jump from night to knows names yesterday, not a tour of the weather", () => {
    expect(paintingAt(0)).toBe("night.jpg");
    expect(paintingAt(0.95)).toBe("yesterday.jpg");
  });

  test("every band has a painting", () => {
    expect(SKY_PAINTINGS.map((stop) => stop.id)).toEqual([
      "night",
      "overcast",
      "drizzle",
      "dry",
      "clearing",
      "clear",
      "fine",
      "yesterday",
    ]);
  });
});

describe("routeOpensOntoSky", () => {
  test("a street paints its path, so you do not walk on the sky", () => {
    expect(routeOpensOntoSky(["route"], "path")).toBe(false);
    expect(routeOpensOntoSky(["route"], "grass")).toBe(false);
  });

  test("a place keeps its floor", () => {
    expect(routeOpensOntoSky([], "path")).toBe(false);
    expect(routeOpensOntoSky(["meta"], "floor")).toBe(false);
  });

  test("only the tree mass beside the road opens onto sky", () => {
    const room = {
      width: 5,
      height: 3,
      cells: ["ttttt", "tpppt", "ttttt"],
    };
    expect(routeOpensOntoSky(["route"], "tree", room, 0, 0)).toBe(true);
    expect(routeOpensOntoSky(["route"], "tree", room, 2, 0)).toBe(false);
    expect(routeOpensOntoSky(["route"], "tree", room, 0, 1)).toBe(false);
  });
});
