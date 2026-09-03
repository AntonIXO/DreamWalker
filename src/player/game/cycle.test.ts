import { describe, expect, test } from "bun:test";

import type { DreamArtifact } from "../../shared/dream";
import { Cycle, formatClock } from "./cycle";

const artifact = { cycle: { durationMs: 60_000 } } as DreamArtifact;

describe("Cycle", () => {
  test("buys time without changing the cycle number", () => {
    const cycle = new Cycle(artifact);
    cycle.update(15);
    cycle.extend(120_000);
    expect(cycle.number).toBe(1);
    expect(cycle.remainingSeconds).toBe(165);
    expect(cycle.progress).toBe(0);
  });

  test("restart restores authored duration and advances the number", () => {
    const cycle = new Cycle(artifact);
    expect(cycle.update(60)).toBe(true);
    cycle.restart();
    expect(cycle.number).toBe(2);
    expect(cycle.remainingSeconds).toBe(60);
  });

  test("the fourth expiry is the last — `endings.md` gives four cycles", () => {
    const four = {
      cycle: { durationMs: 60_000, maxCycles: 4 },
    } as DreamArtifact;
    const cycle = new Cycle(four);
    for (let played = 1; played < 4; played++) {
      expect(cycle.update(60)).toBe(true);
      // Asked the way the game asks it: after the timer, before the restart.
      expect(cycle.isFinal).toBe(false);
      cycle.restart();
    }
    expect(cycle.number).toBe(4);
    expect(cycle.update(60)).toBe(true);
    expect(cycle.isFinal).toBe(true);
  });

  test("a dream without a limit never ends on the clock", () => {
    const endless = {
      cycle: { durationMs: 60_000, maxCycles: null },
    } as DreamArtifact;
    const cycle = new Cycle(endless);
    for (let i = 0; i < 9; i++) cycle.restart();
    expect(cycle.isFinal).toBe(false);
  });

  test("formats the countdown", () => {
    expect(formatClock(125.9)).toBe("2:05");
  });
});
