import { describe, expect, test } from "bun:test";

import type { RoomHotspot } from "../../../src/shared/room";
import type { ScriptHost } from "../../../src/shared/pack";
import { m6Script } from "./m6";

const hotspot = { id: "figura-na-beregu" } as RoomHotspot;

function fakeHost(): ScriptHost & {
  placed: number;
  opened: boolean;
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const host = {
    currentRoomId: "m6-krugi-vokrug-pruda",
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
    placePlayer: () => {
      host.placed += 1;
    },
    closeHotspot: () => undefined,
    removeProp: () => undefined,
    retargetRift: () => undefined,
    openDoor: () => {
      host.opened = true;
    },
    hideFigure: () => undefined,
    showFigure: () => undefined,
    figureInWorld: () => false,
    whisper: () => undefined,
    placed: 0,
    opened: false,
    flags,
  };
  return host;
}

describe("m6 pond", () => {
  test("the first two approaches fail, the third opens the path", () => {
    const host = fakeHost();
    expect(m6Script.onUse?.(host, hotspot)).toBe(true);
    expect(m6Script.onUse?.(host, hotspot)).toBe(true);
    expect(host.placed).toBe(2);
    expect(m6Script.onUse?.(host, hotspot)).toBe(false);
    m6Script.onUpdate?.(host, 0);
    expect(host.opened).toBe(true);
  });
});
