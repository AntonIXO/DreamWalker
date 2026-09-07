import { describe, expect, test } from "bun:test";

import type { ScriptHost } from "../../../src/shared/pack";
import { m8Script } from "./m8";

function fakeHost(overrides: Partial<ScriptHost> = {}): ScriptHost & {
  exhaustionAdded: number;
  entered: string | null;
  retargets: Array<{ doorId: string; toRoomId: string }>;
  whispers: string[];
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const host = {
    currentRoomId: "m8-5854",
    exhaustion: 0,
    cycleNumber: 1,
    playerX: 0,
    playerY: 0,
    playerMoving: false,
    tileSize: 16,
    now: () => 0,
    getFlag: (key: string) => flags.get(key),
    setFlag: (key: string, value: string | number | boolean) => {
      flags.set(key, value);
    },
    addExhaustion: (delta: number) => {
      host.exhaustionAdded += delta;
    },
    knownClueIds: () => [] as string[],
    enterRoom: (roomId: string) => {
      host.entered = roomId;
    },
    placePlayer: () => undefined,
    closeHotspot: () => undefined,
    removeProp: () => undefined,
    retargetRift: (doorId: string, toRoomId: string) => {
      host.retargets.push({ doorId, toRoomId });
    },
    openDoor: () => undefined,
    hideFigure: () => undefined,
    showFigure: () => undefined,
    figureInWorld: () => false,
    whisper: (text: string) => {
      host.whispers.push(text);
    },
    observeClue: () => undefined,
    dispatch: () => ({
      ok: true,
      refusal: null,
      affectedRooms: [] as string[],
      affectedObjects: [] as string[],
      events: [],
    }),
    exhaustionAdded: 0,
    entered: null as string | null,
    retargets: [] as Array<{ doorId: string; toRoomId: string }>,
    whispers: [] as string[],
    flags,
    ...overrides,
  };
  return host;
}

describe("m8 days", () => {
  test("three clues pick one door out of the corridor", () => {
    const host = fakeHost({
      knownClueIds: () => ["clue-1", "clue-3", "clue-4"],
    });
    m8Script.onEnter?.(host);
    expect(host.retargets).toHaveLength(1);
    expect(host.retargets[0]!.doorId.startsWith("m8-5854--day-")).toBe(true);
    expect(host.retargets[0]!.toRoomId).toBe("19-dvor-i-oranzhevye-lavochki");
  });

  test("brute force costs and then dumps you out", () => {
    const host = fakeHost({ currentRoomId: "m8-den" });
    for (let i = 0; i < 19; i++) m8Script.onEnter?.(host);
    expect(host.exhaustionAdded).toBe(0);
    m8Script.onEnter?.(host);
    expect(host.exhaustionAdded).toBeCloseTo(0.05);
    expect(host.entered).toBeNull();
    for (let i = 0; i < 19; i++) m8Script.onEnter?.(host);
    expect(host.entered).toBeNull();
    m8Script.onEnter?.(host);
    expect(host.exhaustionAdded).toBeCloseTo(0.1);
    expect(host.entered).toBe("19-dvor-i-oranzhevye-lavochki");
  });
});
