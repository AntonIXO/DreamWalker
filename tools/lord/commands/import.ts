/**
 * `lord import <slug>` — turn `dream-walker-new/` into an authorable dream.
 *
 * One command because the two halves are not independent: characters have to be placed
 * in rooms, and the roster is what makes the validator's 1:1 figure↔character rule
 * satisfiable. It is re-runnable and never clobbers a file that already exists, so a
 * room whose walls have been drawn survives a re-import.
 *
 * What it does *not* do is invent geometry. Every room lands as a blank 20×11 box with
 * its objects, links and tonus already filled in; the ASCII is drawn by a person.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DreamRoom } from "../../../src/shared/room";
import { ARCHETYPES } from "../art/silhouettes";
import { parseSoul, toCharacterCard } from "../content/importCharacters";
import { parseRoomsDocument, toRoomCards } from "../content/importRooms";
import { dreamDir, loadDraft, REPO_ROOT, saveDraft } from "../project";
import { color, heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

const SOURCE = join(REPO_ROOT, "dream-walker-new");

async function writeIfMissing(path: string, body: string): Promise<boolean> {
  try {
    await writeFile(path, body, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export async function importCommand(
  slug: string | null,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord import <slug>");
  const draft = await loadDraft(slug);
  const base = join(dreamDir(slug), "content");

  heading(`Import — ${draft.title}`);

  // --- rooms
  const markdown = await readFile(join(SOURCE, "rooms.md"), "utf8");
  const parsed = parseRoomsDocument(markdown);
  const { rooms, unresolved } = toRoomCards(parsed);
  const roomDir = join(base, "rooms");
  await mkdir(roomDir, { recursive: true });

  let writtenRooms = 0;
  for (const room of rooms) {
    const wrote = await writeIfMissing(
      join(roomDir, `${room.id}.json`),
      `${JSON.stringify(room, null, 2)}\n`,
    );
    if (wrote) writtenRooms++;
  }
  ok(
    `${rooms.length} rooms parsed (${rooms.filter((r) => r.kind === "meta").length} meta), ` +
      `${writtenRooms} written, ${rooms.length - writtenRooms} already drawn`,
  );
  for (const miss of unresolved) {
    warn(
      `${miss.room}: link target «${miss.target}» matched no room — left as a refusal`,
    );
  }

  // --- characters and their souls
  const characterDir = join(base, "characters");
  const soulDir = join(base, "souls");
  await mkdir(characterDir, { recursive: true });
  await mkdir(soulDir, { recursive: true });

  const ids = (
    await readdir(join(SOURCE, "characters"), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let writtenCharacters = 0;
  const cast: Array<{ id: string; name: string }> = [];
  for (const [index, id] of ids.entries()) {
    const soulText = await readFile(
      join(SOURCE, "characters", id, "SOUL.md"),
      "utf8",
    );
    const soul = parseSoul(id, soulText);
    cast.push({ id, name: soul.name });

    // The soul goes to disk unpublished; only the server ever reads it.
    await writeFile(join(soulDir, `${id}.md`), soul.soul, "utf8");

    const card = toCharacterCard(soul, ARCHETYPES[index % ARCHETYPES.length]!);
    if (
      await writeIfMissing(
        join(characterDir, `${id}.json`),
        `${JSON.stringify(card, null, 2)}\n`,
      )
    ) {
      writtenCharacters++;
    }
  }
  ok(
    `${ids.length} characters parsed, ${writtenCharacters} written, ` +
      `${ids.length} souls refreshed (never published)`,
  );

  // --- the roster, which is what makes 14 figures = 14 characters true
  const places = rooms.filter((room) => room.kind === "place");
  const rosterPath = join(base, "figures.json");
  const roster = cast.map((entry, index) => ({
    id: entry.id,
    name: entry.name,
    roomId: places[index % places.length]!.id,
    slotId: index % 2 === 0 ? "a" : "b",
    archetypeId: ARCHETYPES[index % ARCHETYPES.length],
    holdsShardId: null as string | null,
  }));
  if (
    await writeIfMissing(rosterPath, `${JSON.stringify(roster, null, 2)}\n`)
  ) {
    note(
      "content/figures.json written — move people to the rooms they belong in",
    );
  }

  // --- spawn and finale
  const spawn = places.find((room) => room.id.startsWith("19")) ?? places[0]!;
  // §5 of the bible: the Eye is the last door, and it lives wherever the author puts it.
  const finale = places.find((room) => room.id.startsWith("01")) ?? places[0]!;
  const settingsPath = join(base, "settings.json");
  if (
    await writeIfMissing(
      settingsPath,
      `${JSON.stringify({ spawn: { roomId: spawn.id, entryId: "default" }, finaleRoomId: finale.id }, null, 2)}\n`,
    )
  ) {
    note(
      `spawn ${spawn.id} · finale ${finale.id} — change in content/settings.json`,
    );
  }

  if (flags.verbose) {
    console.log();
    for (const room of rooms) {
      const links = room.hotspots.filter((h) => h.link).length;
      console.log(
        `  ${color.bold(room.id.padEnd(34))} ${String(room.hotspots.length).padStart(2)} objects  ` +
          `${links} links  (${room.tonus.x}, ${room.tonus.y})`,
      );
    }
  }

  draft.rooms = rooms as DreamRoom[];
  await saveDraft(draft);
  console.log();
  note(`Next: draw the walls, then \`bun run lord rooms ${slug} --check\``);
}
