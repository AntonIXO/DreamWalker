/**
 * `lord figures <slug>` — put people in the rooms and hand them what they know.
 *
 * §2 is firm that this is a *seeding*, not a schema: the Lord decides who starts out
 * holding which hook, and from then on the sleeping mind may move them. So this command
 * proposes a spread and lets the Lord reroll it — it is not solving anything.
 *
 * Two modes, and the roster is the one that matters now:
 *
 *   - **roster** — `content/figures.json` lists the cast by hand. Exactly those figures
 *     are placed, in the rooms they name. This is what a dream with fourteen written
 *     characters uses, and it is the only mode that can satisfy the validator's 1:1
 *     figure↔character rule.
 *   - **proposal** — no roster, so a spread is invented and offered for reroll. Kept for
 *     a dream that is still being sketched.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FigurePlacement } from "../../../src/shared/dream";
import type { DreamRoom } from "../../../src/shared/room";
import { ARCHETYPES } from "../art/silhouettes";
import { loadRoomFiles } from "../content/files";
import { dreamDir, loadDraft, saveDraft } from "../project";
import { makeRng, randomSeedWord, type Rng } from "../rng";
import {
  color,
  heading,
  isInteractive,
  note,
  ok,
  readOneOf,
} from "../term/prompt";
import type { Flags } from "../cli";

const FIGURE_NAMES = [
  "Санитарка",
  "Человек в халате",
  "Кто-то в очереди",
  "Женщина у окна",
  "Мальчик",
  "Дежурный",
  "Тот, кто ждёт",
  "Соседка",
];

/** One entry of `content/figures.json`. */
interface RosterEntry {
  id: string;
  name: string;
  roomId: string;
  slotId?: string;
  archetypeId?: string;
  holdsShardId?: string | null;
}

async function loadRoster(slug: string): Promise<RosterEntry[] | null> {
  const path = join(dreamDir(slug), "content", "figures.json");
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as RosterEntry[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** A named slot in the room that nobody has claimed yet. */
function freeSlot(
  room: DreamRoom,
  taken: Set<string>,
  rng: Rng,
): string | null {
  const free = room.figureSlots.filter(
    (slot) => !taken.has(`${room.id}:${slot.id}`),
  );
  if (free.length === 0) return null;
  const slot = rng.pick(free);
  taken.add(`${room.id}:${slot.id}`);
  return slot.id;
}

function placeRoster(
  roster: readonly RosterEntry[],
  rooms: readonly DreamRoom[],
  rng: Rng,
): FigurePlacement[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const taken = new Set<string>();
  const placements: FigurePlacement[] = [];

  for (const entry of roster) {
    const room = byId.get(entry.roomId);
    if (!room)
      throw new Error(
        `${entry.id} names room ${entry.roomId}, which does not exist`,
      );
    // «Ходить можно, разговаривать не с кем» — a meta-space holds nobody.
    if (room.kind === "meta") {
      throw new Error(`${entry.id} is placed in the meta-space ${room.id}`);
    }
    const slotId =
      entry.slotId && room.figureSlots.some((slot) => slot.id === entry.slotId)
        ? (taken.add(`${room.id}:${entry.slotId}`), entry.slotId)
        : freeSlot(room, taken, rng);
    if (!slotId) {
      throw new Error(
        `${room.id} has no free figure slot for ${entry.id} — add one to its room file`,
      );
    }
    placements.push({
      id: entry.id,
      archetypeId: entry.archetypeId ?? ARCHETYPES[0],
      name: entry.name,
      roomId: room.id,
      slotId,
      holdsShardId: entry.holdsShardId ?? null,
    });
  }
  return placements;
}

function proposePlacements(
  rooms: readonly DreamRoom[],
  shardIds: readonly string[],
  rng: Rng,
): FigurePlacement[] {
  const places = rooms.filter(
    (room) => room.kind === "place" && room.figureSlots.length > 0,
  );
  if (places.length === 0) return [];

  const taken = new Set<string>();
  const placements: FigurePlacement[] = [];
  const push = (roomId: string, holdsShardId: string | null): void => {
    const room = places.find((candidate) => candidate.id === roomId);
    if (!room) return;
    const slotId = freeSlot(room, taken, rng);
    if (!slotId) return;
    const index = placements.length;
    placements.push({
      id: `figure${index + 1}`,
      archetypeId: ARCHETYPES[index % ARCHETYPES.length]!,
      name: FIGURE_NAMES[index % FIGURE_NAMES.length]!,
      roomId: room.id,
      slotId,
      holdsShardId,
    });
  };

  // Hooks go somewhere the author already marked as worth visiting; the rest fill in.
  const clueRooms = places.filter((room) =>
    room.tags.includes("clue-compatible"),
  );
  const preferred = clueRooms.length > 0 ? clueRooms : places;
  shardIds.forEach((shardId, index) => {
    push(preferred[index % preferred.length]!.id, shardId);
  });
  const ambient = rng.int(1, 3);
  for (let i = 0; i < ambient; i++) {
    push(rng.pick(places).id, null);
  }
  return placements;
}

function describe(
  placements: readonly FigurePlacement[],
  rooms: readonly DreamRoom[],
): void {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  for (const figure of placements) {
    const room = byId.get(figure.roomId);
    console.log(
      `  ${color.bold(figure.name.padEnd(22))} ${(room?.name ?? figure.roomId).padEnd(24)} ` +
        color.grey(
          `${figure.roomId}:${figure.slotId}` +
            (figure.holdsShardId ? ` · ${figure.holdsShardId}` : ""),
        ),
    );
  }
}

export async function figuresCommand(
  slug: string | null,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord figures <slug>");
  const draft = await loadDraft(slug);
  draft.rooms = await loadRoomFiles(slug);
  if (draft.rooms.length === 0) {
    throw new Error(`no rooms yet — run \`bun run lord rooms ${slug}\` first`);
  }

  const roster = await loadRoster(slug);
  heading(`Figures — ${draft.title}`);

  if (roster) {
    // A written cast is not a proposal, so there is nothing to reroll: place it and stop.
    const placements = placeRoster(roster, draft.rooms, makeRng("roster"));
    describe(placements, draft.rooms);
    draft.figures = placements;
    await saveDraft(draft);
    console.log();
    ok(`${placements.length} figures placed from content/figures.json`);
    note(`Next: bun run lord content ${slug}`);
    return;
  }

  const shardIds = draft.shards.map((shard) => shard.id);
  let seed = String(flags.seed ?? randomSeedWord());
  for (;;) {
    const placements = proposePlacements(draft.rooms, shardIds, makeRng(seed));
    describe(placements, draft.rooms);
    console.log();

    const answer =
      flags.yes || !isInteractive()
        ? "a"
        : await readOneOf(["r", "a", "q"], "[r]eroll / [a]ccept / [q]uit");
    if (answer === "q") return;
    if (answer === "r") {
      seed = randomSeedWord();
      continue;
    }
    draft.figures = placements;
    await saveDraft(draft);
    ok(`${placements.length} figures placed`);
    note(
      `A written cast goes in dreams/${slug}/content/figures.json — one entry per character.`,
    );
    note(`Next: bun run lord content ${slug}`);
    return;
  }
}
