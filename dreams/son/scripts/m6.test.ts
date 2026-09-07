import { describe, expect, test } from "bun:test";

import type { RoomHotspot } from "../../../src/shared/room";
import type { ScriptHost } from "../../../src/shared/pack";
import type { WorldAction } from "../../../src/shared/world-action";
import { m6Script } from "./m6";

const hotspot = { id: "figura-na-beregu" } as RoomHotspot;

function fakeHost(): ScriptHost & {
  placed: number;
  opened: boolean;
  opens: number;
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
      host.opens += 1;
    },
    hideFigure: () => undefined,
    showFigure: () => undefined,
    figureInWorld: () => false,
    whisper: () => undefined,
    observeClue: () => undefined,
    dispatch: (action: WorldAction) => {
      if (action.type === "open") {
        host.opened = true;
        host.opens += 1;
      }
      return {
        ok: true,
        refusal: null,
        affectedRooms: [] as string[],
        affectedObjects: [] as string[],
        events: [],
      };
    },
    placed: 0,
    opened: false,
    opens: 0,
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

  test("approaching a figure on the shore is not a conversation", () => {
    const host = fakeHost();
    expect(m6Script.onApproach?.(host, "anyone")).toBe(false);
  });

  test("the next cycle reseals the way back and can open it again", () => {
    const host = fakeHost();
    m6Script.onUse?.(host, hotspot);
    m6Script.onUse?.(host, hotspot);
    m6Script.onUse?.(host, hotspot);
    m6Script.onUpdate?.(host, 0);
    expect(host.opens).toBe(1);

    // `resetWorld` restores the sealed door; without clearing the flag the script
    // would never open it again and the pond would keep the sanitar for good.
    m6Script.onCycleReset?.(host);
    m6Script.onUpdate?.(host, 0);
    expect(host.opens).toBe(2);
  });

  test("object.used after the third approach opens the exit", () => {
    const host = fakeHost();
    m6Script.onUse?.(host, hotspot);
    m6Script.onUse?.(host, hotspot);
    m6Script.onUse?.(host, hotspot);
    m6Script.onWorldEvent?.(host, {
      type: "object.used",
      objectId: "figura-na-beregu",
      targetId: null,
      actor: { kind: "player" },
    });
    expect(host.opened).toBe(true);
  });
});
