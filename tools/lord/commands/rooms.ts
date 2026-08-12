/**
 * `lord rooms <slug>` — the authored-room half of the Lord flow.
 *
 * This replaces `lord layout`, and the replacement is the whole point of format 4. The
 * old command generated a mission graph, routed it onto a lattice and painted eight
 * layers of terrain, then checked its own work with a flood fill because a generator can
 * wall off a place by accident. Rooms are drawn by hand now, so there is nothing to
 * generate and nothing to reroll — but there is still something to check, because a
 * *person* can wall off a place by accident just as easily.
 *
 *   lord rooms <slug>            list the catalogue
 *   lord rooms <slug> --scaffold write a blank 20x11 room for each id in rooms.md
 *   lord rooms <slug> --check    walk the door and link graph from the spawn
 *
 * The scaffold deliberately writes an *empty box*. No parser can read a floor plan out of
 * prose, and pretending otherwise would produce twenty-nine wrong rooms that all look
 * finished. The ASCII is the author's job; this only makes the file to draw in.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DreamRoom } from "../../../src/shared/room";
import { loadRoomFiles, loadRoomSettings } from "../content/files";
import { dreamDir, loadDraft, saveDraft } from "../project";
import { color, heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

/** 20x11 at 16px is 320x176 — a room a camera can hold whole at an integer zoom. */
const DEFAULT_WIDTH = 20;
const DEFAULT_HEIGHT = 11;

function blankCells(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    if (y === 0 || y === height - 1) {
      rows.push("#".repeat(width));
    } else if (y === 1) {
      rows.push(`#${"=".repeat(width - 2)}#`);
    } else {
      rows.push(`#${".".repeat(width - 2)}#`);
    }
  }
  return rows;
}

export function blankRoom(id: string, name: string): DreamRoom {
  return {
    id,
    name,
    kind: "place",
    tileSize: 16,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    cells: blankCells(DEFAULT_WIDTH, DEFAULT_HEIGHT),
    cellVariants: {},
    props: [],
    hotspots: [],
    entries: [
      {
        id: "default",
        x: DEFAULT_WIDTH / 2,
        y: DEFAULT_HEIGHT - 2,
        facing: "n",
      },
    ],
    doors: [],
    figureSlots: [
      { id: "a", x: 4, y: 5 },
      { id: "b", x: DEFAULT_WIDTH - 5, y: 5 },
    ],
    graphics: {
      floorRole: "floor",
      wallRole: "wall",
      propRole: "prop",
      backdropImage: null,
      backdropFit: "cells",
      glitchPreset: "none",
    },
    camera: "frame",
    tonus: { x: 0, y: 0 },
    revisit: { escalates: false, note: null },
    meta: null,
    description: "",
    atmosphere: "",
    personality: "",
    tags: [],
    copy: {},
  };
}

/**
 * Everywhere you can get to from the spawn, through doors and through links.
 *
 * `strandedRegions()` used to flood-fill 52k tiles to answer this. With authored rooms it
 * is a breadth-first walk over a graph the author wrote down, and it catches exactly the
 * same class of mistake: a room nobody can reach, or a link pointing at nothing.
 */
export function reachableRooms(
  rooms: readonly DreamRoom[],
  spawnRoomId: string,
): Set<string> {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const seen = new Set<string>();
  const queue = [spawnRoomId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const room = byId.get(id)!;
    for (const door of room.doors) queue.push(door.toRoomId);
    for (const hotspot of room.hotspots) {
      if (hotspot.link?.to === "room") queue.push(hotspot.link.roomId);
    }
  }
  return seen;
}

/** Links and doors that name a room nobody authored. */
export function danglingTargets(
  rooms: readonly DreamRoom[],
): Array<{ from: string; via: string; to: string }> {
  const ids = new Set(rooms.map((room) => room.id));
  const bad: Array<{ from: string; via: string; to: string }> = [];
  for (const room of rooms) {
    for (const door of room.doors) {
      if (!ids.has(door.toRoomId)) {
        bad.push({ from: room.id, via: door.id, to: door.toRoomId });
      }
    }
    for (const hotspot of room.hotspots) {
      if (hotspot.link?.to === "room" && !ids.has(hotspot.link.roomId)) {
        bad.push({ from: room.id, via: hotspot.id, to: hotspot.link.roomId });
      }
    }
  }
  return bad;
}

export async function roomsCommand(
  slug: string | null,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord rooms <slug> [--scaffold] [--check]");
  const draft = await loadDraft(slug);

  if (flags.scaffold) {
    const ids = String(flags.scaffold)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new Error("--scaffold takes a comma-separated list of room ids");
    }
    const dir = join(dreamDir(slug), "content", "rooms");
    await mkdir(dir, { recursive: true });
    let written = 0;
    for (const id of ids) {
      const path = join(dir, `${id}.json`);
      // Never clobber a drawn room: the ASCII in it is hours of somebody's evening.
      try {
        await writeFile(
          path,
          `${JSON.stringify(blankRoom(id, id), null, 2)}\n`,
          { flag: "wx" },
        );
        written++;
      } catch {
        note(`${id} already exists — left alone`);
      }
    }
    ok(`${written} room file(s) written to dreams/${slug}/content/rooms/`);
  }

  if (flags.wire) {
    // §2 — «ОТЕЛЬ … Лучший кандидат на центральную комнату». The bible's Линк bullets
    // are one-way and sparse on purpose, so a playable dream needs a spine as well: a
    // door from the hub to every place, and one back. Links stay the interesting
    // connections; doors are the ones you can walk.
    const rooms = await loadRoomFiles(slug);
    const hubId = String(flags.wire);
    const hub = rooms.find((room) => room.id === hubId);
    if (!hub) throw new Error(`no room ${hubId} to wire through`);
    const dir = join(dreamDir(slug), "content", "rooms");
    let wired = 0;
    for (const room of rooms) {
      // A meta-space has no doors — «выход не ищется, он случается».
      if (room.kind === "meta" || room.id === hub.id) continue;
      const backId = `${room.id}--to-hub`;
      if (!room.doors.some((door) => door.id === backId)) {
        room.doors.push({
          id: backId,
          x: Math.floor(room.width / 2),
          y: room.height - 1,
          w: 2,
          h: 1,
          toRoomId: hub.id,
          toEntryId: "default",
          type: "open",
          keyId: null,
          prompt: null,
        });
        await writeFile(
          join(dir, `${room.id}.json`),
          `${JSON.stringify(room, null, 2)}\n`,
        );
        wired++;
      }
      const outId = `hub--to-${room.id}`;
      if (!hub.doors.some((door) => door.id === outId)) {
        const index = hub.doors.length;
        hub.doors.push({
          id: outId,
          x: 1 + (index % (hub.width - 2)),
          y: 1,
          w: 1,
          h: 1,
          toRoomId: room.id,
          toEntryId: "default",
          type: "open",
          keyId: null,
          prompt: null,
        });
      }
    }
    await writeFile(
      join(dir, `${hub.id}.json`),
      `${JSON.stringify(hub, null, 2)}\n`,
    );
    ok(`wired ${wired} rooms through ${hub.id}`);
  }

  draft.rooms = await loadRoomFiles(slug);
  const settings = await loadRoomSettings(slug);
  draft.spawn = settings.spawn ?? draft.spawn;
  draft.finaleRoomId = settings.finaleRoomId ?? draft.finaleRoomId;
  await saveDraft(draft);

  heading(`${draft.rooms.length} room(s) in ${slug}`);
  for (const room of draft.rooms) {
    const links = room.hotspots.filter((hotspot) => hotspot.link).length;
    const marks = [
      room.kind === "meta" ? "meta" : null,
      room.graphics.backdropImage ? "art" : null,
      room.revisit.escalates ? "escalates" : null,
    ].filter(Boolean);
    console.log(
      `  ${color.bold(room.id.padEnd(22))} ${room.name.padEnd(26)} ` +
        color.grey(
          `${room.width}x${room.height} · ${room.doors.length}d ${links}l ` +
            `(${room.tonus.x}, ${room.tonus.y})${marks.length ? " · " + marks.join(" ") : ""}`,
        ),
    );
  }

  if (!flags.check) return;

  console.log();
  const dangling = danglingTargets(draft.rooms);
  for (const bad of dangling) {
    warn(`${bad.from} → ${bad.via} points at ${bad.to}, which does not exist`);
  }

  if (!draft.spawn) {
    warn("no spawn set — add one to content/settings.json");
    return;
  }
  const reachable = reachableRooms(draft.rooms, draft.spawn.roomId);
  const stranded = draft.rooms.filter((room) => !reachable.has(room.id));
  for (const room of stranded) {
    warn(`${room.id} cannot be reached from ${draft.spawn.roomId}`);
  }

  if (dangling.length === 0 && stranded.length === 0) {
    ok(`every room is reachable from ${draft.spawn.roomId}`);
  }
}
