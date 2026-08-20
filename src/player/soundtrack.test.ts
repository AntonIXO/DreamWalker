import { describe, expect, test } from "bun:test";

import {
  MUSIC_PREF_KEY,
  masterGain,
  musicEnabled,
  saveMusicEnabled,
} from "./soundtrack";

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    data,
  };
};

describe("soundtrack prefs", () => {
  test("music is on until the player stores a zero", () => {
    expect(musicEnabled(store())).toBe(true);
    expect(musicEnabled(store({ [MUSIC_PREF_KEY]: "1" }))).toBe(true);
    expect(musicEnabled(store({ [MUSIC_PREF_KEY]: "0" }))).toBe(false);
  });

  test("a missing store still plays", () => {
    expect(musicEnabled(null)).toBe(true);
    expect(musicEnabled(undefined)).toBe(true);
  });

  test("the toggle writes 1 or 0", () => {
    const memory = store();
    saveMusicEnabled(memory, false);
    expect(memory.data[MUSIC_PREF_KEY]).toBe("0");
    saveMusicEnabled(memory, true);
    expect(memory.data[MUSIC_PREF_KEY]).toBe("1");
  });
});

describe("masterGain", () => {
  test("mute wins over duck", () => {
    expect(masterGain(false, false)).toBe(0);
    expect(masterGain(false, true)).toBe(0);
  });

  test("dialogue ducks instead of cutting", () => {
    expect(masterGain(true, false)).toBe(1);
    expect(masterGain(true, true)).toBeGreaterThan(0);
    expect(masterGain(true, true)).toBeLessThan(1);
  });
});
