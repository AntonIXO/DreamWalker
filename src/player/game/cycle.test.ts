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
  });

  test("restart restores authored duration and advances the number", () => {
    const cycle = new Cycle(artifact);
    expect(cycle.update(60)).toBe(true);
    cycle.restart();
    expect(cycle.number).toBe(2);
    expect(cycle.remainingSeconds).toBe(60);
  });

  test("formats the countdown", () => {
    expect(formatClock(125.9)).toBe("2:05");
  });
});
