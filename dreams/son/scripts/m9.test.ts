import { describe, expect, test } from "bun:test";

import type { ScriptHost } from "../../../src/shared/pack";
import { m9Script } from "./m9";

function fakeHost(): ScriptHost & {
  whispers: string[];
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const host = {
    currentRoomId: "m9-shkaf",
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

describe("m9 wardrobe", () => {
  test("the door opens in two slow beats, not all at once", () => {
    const host = fakeHost();
    m9Script.onEnter?.(host);
    m9Script.onUpdate?.(host, 5.9);
    expect(host.whispers).toEqual([]);
    m9Script.onUpdate?.(host, 0.2);
    expect(host.whispers).toHaveLength(1);
    m9Script.onUpdate?.(host, 10);
    expect(host.whispers).toHaveLength(2);
  });
});
