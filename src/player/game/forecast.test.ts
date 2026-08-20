import { describe, expect, test } from "bun:test";

import {
  bandAt,
  coverForPortrait,
  forecastFor,
  skyCover,
  weatherFor,
} from "./forecast";
import type { PortraitState } from "../../shared/content";

const figure = (id: string, roomId: string, portraitState: PortraitState) => ({
  id,
  roomId,
  portraitState,
});

describe("forecast", () => {
  test("the nicer the day, the worse the face", () => {
    expect(weatherFor("neutral")).toBeNull();
    expect(weatherFor("interested")).toBe("морось");
    expect(weatherFor("wary")).toBe("ясно");
    expect(weatherFor("knows")).toBe("как вчера");
  });

  test("cover has more stops than four portrait rungs", () => {
    expect(bandAt(0).id).toBe("night");
    expect(bandAt(0.15).weather).toBe("пасмурно");
    expect(bandAt(0.3).weather).toBe("морось");
    expect(bandAt(0.45).weather).toBe("без осадков");
    expect(bandAt(0.58).weather).toBe("проясняется");
    expect(bandAt(0.7).weather).toBe("ясно");
    expect(bandAt(0.85).weather).toBe("хорошая погода");
    expect(bandAt(1).weather).toBe("как вчера");
  });

  test("a portrait sits on a cover rung, not a binary", () => {
    expect(coverForPortrait("neutral")).toBe(0);
    expect(coverForPortrait("interested")).toBeCloseTo(1 / 3);
    expect(coverForPortrait("knows")).toBe(1);
  });

  test("the sky is whoever is worst in this room, not the dream average", () => {
    const figures = [
      figure("kirill", "yard", "neutral"),
      figure("papa", "kitchen", "knows"),
      figure("mama", "yard", "interested"),
    ];
    const here = forecastFor(figures, "yard");
    expect(here.sky).toBe("interested");
    const there = forecastFor(figures, "kitchen");
    expect(there.sky).toBe("knows");
  });

  test("an empty street still shows weather if somebody elsewhere knows", () => {
    const figures = [figure("papa", "kitchen", "knows")];
    const street = forecastFor(figures, "street");
    expect(street.sky).toBe("neutral");
    expect(street.cover).toBeGreaterThan(0.4);
    expect(street.weather).not.toBeNull();
  });

  test("more people looking up lifts the sky even at the same worst face", () => {
    const one = [
      figure("mama", "yard", "interested"),
      figure("kirill", "yard", "neutral"),
    ];
    const many = [
      figure("mama", "yard", "interested"),
      figure("papa", "kitchen", "interested"),
      figure("raisa", "school", "interested"),
      figure("turyshev", "yard", "interested"),
    ];
    expect(skyCover(many, "yard")).toBeGreaterThan(skyCover(one, "yard"));
  });

  test("passers-by are everyone who has looked up, including other rooms", () => {
    const figures = [
      figure("kirill", "yard", "neutral"),
      figure("mama", "yard", "interested"),
      figure("papa", "kitchen", "knows"),
    ];
    const crowd = forecastFor(figures, "yard").crowd;
    expect(crowd.map((mark) => mark.id)).toEqual(["papa", "mama"]);
    expect(crowd[0]?.state).toBe("knows");
  });

  test("a puppy that never suspects does not stand in the crowd", () => {
    const figures = [figure("shchenok", "yard", "neutral")];
    expect(forecastFor(figures, "yard").crowd).toEqual([]);
    expect(forecastFor(figures, "yard").cover).toBe(0);
  });

  test("the crowd caps so the frame does not fill with people", () => {
    const figures = Array.from({ length: 12 }, (_, i) =>
      figure(`n${i}`, "yard", i % 2 === 0 ? "interested" : "wary"),
    );
    expect(forecastFor(figures, "yard").crowd).toHaveLength(8);
  });
});
