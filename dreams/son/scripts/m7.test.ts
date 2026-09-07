import { describe, expect, test } from "bun:test";

import type { RoomHotspot } from "../../../src/shared/room";
import type { ScriptHost } from "../../../src/shared/pack";
import type { WorldAction } from "../../../src/shared/world-action";
import { M7 } from "../rooms/m7-rm-rf";
import { m7Script } from "./m7";

function fakeHost(): ScriptHost & {
  closed: string[];
  removed: string[];
  observed: string[];
  entered: string | null;
  flags: Map<string, string | number | boolean>;
} {
  const flags = new Map<string, string | number | boolean>();
  const host = {
    currentRoomId: "m7-rm-rf",
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
    enterRoom: (roomId: string) => {
      host.entered = roomId;
    },
    placePlayer: () => undefined,
    closeHotspot: (id: string) => {
      host.closed.push(id);
    },
    removeProp: (id: string) => {
      host.removed.push(id);
    },
    retargetRift: () => undefined,
    openDoor: () => undefined,
    hideFigure: () => undefined,
    showFigure: () => undefined,
    figureInWorld: () => false,
    whisper: () => undefined,
    observeClue: (clueId: string) => {
      host.observed.push(clueId);
    },
    dispatch: (action: WorldAction) => {
      if (action.type === "take") host.removed.push(action.objectId);
      if (action.type === "close") host.closed.push(action.targetId);
      return {
        ok: true,
        refusal: null,
        affectedRooms: [] as string[],
        affectedObjects: [] as string[],
        events: [],
      };
    },
    closed: [] as string[],
    removed: [] as string[],
    observed: [] as string[],
    entered: null as string | null,
    flags,
  };
  return host;
}

describe("m7 rm -rf", () => {
  test("the first object is gone at 2.4s, the last at a 0.6s step", () => {
    const host = fakeHost();
    m7Script.onEnter?.(host);
    m7Script.onUpdate?.(host, 2.39);
    expect(host.removed).toEqual([]);
    m7Script.onUpdate?.(host, 0.02);
    expect(host.removed[0]).toBe("zametki");
    // 2.4 + 1.8 + 1.2 + 0.6 = 6.0 until the table, then 0.6 more to fall.
    m7Script.onUpdate?.(host, 3.6);
    expect(host.removed).toEqual(["zametki", "shemy", "monitor", "stol"]);
    expect(host.entered).toBeNull();
    m7Script.onUpdate?.(host, 0.6);
    expect(host.entered).toBe("19-dvor-i-oranzhevye-lavochki");
  });

  test("grabbing the notes observes the authored clue and refuses a second", () => {
    const host = fakeHost();
    m7Script.onEnter?.(host);
    const notes = M7.hotspots.find((hotspot) => hotspot.id === "zametki");
    expect(notes?.clueId).toBe("clue-1");
    expect(m7Script.onUse?.(host, notes!)).toBe(true);
    expect(host.observed).toEqual(["clue-1"]);
    expect(host.flags.get("m7.taken")).toBe("zametki");
    const second = { id: "stol", clueId: "clue-3" } as RoomHotspot;
    expect(m7Script.onUse?.(host, second)).toBe(false);
    expect(host.observed).toEqual(["clue-1"]);
  });
});
