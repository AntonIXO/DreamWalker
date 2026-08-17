import { describe, expect, test } from "bun:test";

import type { ScriptHost } from "../../../src/shared/pack";
import { m5Script } from "./m5";

function fakeHost(overrides: Partial<ScriptHost> = {}): ScriptHost & {
  entered: string | null;
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const host = {
    currentRoomId: "m5-odinochestvo",
    exhaustion: 0,
    cycleNumber: 1,
    playerX: 160,
    playerY: 144,
    playerMoving: false,
    tileSize: 16,
    now: () => 0,
    getFlag: (key: string) => flags.get(key),
    setFlag: (key: string, value: string | number | boolean) => {
      flags.set(key, value);
    },
    addExhaustion: () => undefined,
    knownClueIds: () => [],
    enterRoom: (roomId: string) => {
      host.entered = roomId;
    },
    placePlayer: () => undefined,
    closeHotspot: () => undefined,
    removeProp: () => undefined,
    retargetRift: () => undefined,
    openDoor: () => undefined,
    hideFigure: () => undefined,
    showFigure: () => undefined,
    figureInWorld: () => false,
    whisper: () => undefined,
    entered: null as string | null,
    flags,
    ...overrides,
  };
  return host;
}

describe("m5 loneliness", () => {
  test("ten tiles of walking leave, standing does nothing", () => {
    const host = fakeHost();
    m5Script.onEnter?.(host);
    m5Script.onUpdate?.(host, 40);
    expect(host.entered).toBeNull();
    const walked = fakeHost({
      getFlag: (key) => host.flags.get(key),
      setFlag: (key, value) => host.flags.set(key, value),
      playerX: 160 + 16 * 11,
      enterRoom: (roomId) => {
        host.entered = roomId;
      },
    });
    m5Script.onUpdate?.(walked, 0.1);
    expect(host.entered).toBe("19-dvor-i-oranzhevye-lavochki");
  });
});
