import { describe, expect, test } from "bun:test";

import { META_IDS } from "../../../src/player/game/exhaustion";
import type { ScriptHost } from "../../../src/shared/pack";
import { RIFT_IDS } from "../rooms/rifts";
import { riftScript } from "./rifts";

function fakeHost(overrides: Partial<ScriptHost> = {}): ScriptHost & {
  retargets: Array<{ doorId: string; toRoomId: string }>;
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const retargets: Array<{ doorId: string; toRoomId: string }> = [];
  const host = {
    currentRoomId: "19-dvor-i-oranzhevye-lavochki",
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
    addExhaustion: () => undefined,
    knownClueIds: () => [],
    enterRoom: () => undefined,
    placePlayer: () => undefined,
    closeHotspot: () => undefined,
    removeProp: () => undefined,
    retargetRift: (doorId: string, toRoomId: string) => {
      retargets.push({ doorId, toRoomId });
    },
    openDoor: () => undefined,
    hideFigure: () => undefined,
    showFigure: () => undefined,
    figureInWorld: () => false,
    whisper: () => undefined,
    observeClue: () => undefined,
    retargets,
    flags,
    ...overrides,
  };
  return host;
}

describe("exhaustion rifts", () => {
  test("there are authored rifts to steal", () => {
    expect(RIFT_IDS.length).toBeGreaterThan(0);
  });

  test("a dry cycle never moves a doorway", () => {
    const host = fakeHost({ exhaustion: 0, cycleNumber: 1 });
    riftScript.onCycleReset?.(host);
    expect(host.retargets).toEqual([]);
  });

  test("spending a memory always steals one rift into a meta-space", () => {
    const host = fakeHost({ exhaustion: 0.4, cycleNumber: 2 });
    riftScript.onMemorySpent?.(host);
    expect(host.retargets).toHaveLength(1);
    expect(RIFT_IDS).toContain(host.retargets[0]!.doorId);
    expect(META_IDS as readonly string[]).toContain(
      host.retargets[0]!.toRoomId,
    );
    expect(host.retargets[0]!.toRoomId).not.toBe(host.currentRoomId);
  });
});
