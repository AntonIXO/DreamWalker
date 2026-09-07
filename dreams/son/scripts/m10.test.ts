import { describe, expect, test } from "bun:test";

import type { ScriptHost } from "../../../src/shared/pack";
import { m10Script } from "./m10";

function fakeHost(): ScriptHost & {
  whispers: string[];
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const host = {
    currentRoomId: "m10-zamorozhennaia-morkovka",
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
    retargetRift: () => undefined,
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
    whispers: [] as string[],
    flags,
  };
  return host;
}

describe("m10 frozen carrot", () => {
  test("the config types itself three times, then stops", () => {
    const host = fakeHost();
    m10Script.onEnter?.(host);
    m10Script.onUpdate?.(host, 3.9);
    expect(host.whispers).toEqual([]);
    m10Script.onUpdate?.(host, 0.2);
    expect(host.whispers[0]).toBe("server {");
    m10Script.onUpdate?.(host, 8);
    expect(host.whispers).toHaveLength(3);
    m10Script.onUpdate?.(host, 20);
    expect(host.whispers).toHaveLength(3);
  });
});
