/**
 * `lord objects <slug>` — art for the things in the rooms.
 *
 * The rooms carry 106 authored hotspots: a rope to the vault, a shelf you can sleep on,
 * a piece of meat somebody has decided is a bomb. Those are what the player actually
 * looks at and touches, and they are the right thing to spend the budget on — a room is
 * legible from tiles and objects, whereas one big painted backdrop is a perspective
 * picture that fights the walk mask and costs more.
 *
 * The economics settle it. `rd_animation__small_sprites` is **$0.07 flat for up to
 * sixteen 32×32 sprites** — `num_images` is not a multiplier there — so a batch of
 * sixteen objects costs $0.0044 each. Generating the same sixteen through an image style
 * would be $0.39. Everything after generation is free.
 *
 *   lord objects <slug>                    price it and stop
 *   lord objects <slug> --room 19 --yes    art for one room's objects
 *   lord objects <slug> --yes --budget 1   the lot, under a ceiling
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DreamRoom, RoomHotspot } from "../../../src/shared/room";
import { assertAffordable, describePlan, priceBatch } from "../art/pricing";
import { RetroDiffusionClient } from "../art/retroDiffusion";
import { loadRoomFiles } from "../content/files";
import { dreamDir, loadDraft } from "../project";
import { heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

/** Sixteen to a call, because sixteen cost the same as one. */
const BATCH = 16;
const SIZE = 32;

function seedFor(id: string): number {
  let hash = 2166136261;
  for (const ch of id) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0);
}

/**
 * The prompt is the *subject*, and nothing else.
 *
 * RD's own guidance is explicit — «describe the SUBJECT only, never write "pixel art"»,
 * because the styling comes from `prompt_style`. The first version of the backdrop
 * command ignored that and prepended the whole §1.1 style block, which fought the style
 * model and produced a Victorian sitting room for an outdoor courtyard. §1.3's tone rule
 * survives because it describes the subject rather than the rendering: an ordinary object
 * treated with too much reverence is what this dream looks like.
 */
function promptFor(hotspot: RoomHotspot, room: DreamRoom): string {
  return [
    hotspot.prompt,
    `from ${room.name.toLowerCase()}`,
    "single object centered on transparent background",
    "mundane banal object rendered with excessive reverence and detail, deadpan",
  ].join(", ");
}

export async function objectsCommand(
  slug: string | null,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord objects <slug>");
  const token = process.env.RETRO_DIFFUSION_API_KEY;
  if (!token) throw new Error("RETRO_DIFFUSION_API_KEY is not set");

  const draft = await loadDraft(slug);
  const client = new RetroDiffusionClient(token);
  const dir = dreamDir(slug);
  const rooms = (await loadRoomFiles(slug)).filter((room) =>
    flags.room ? room.id.startsWith(String(flags.room)) : true,
  );

  // One flat list of every object that still has no picture.
  const wanted = rooms.flatMap((room) =>
    room.hotspots
      .filter((hotspot) => hotspot.kind !== "ui")
      .map((hotspot) => ({ room, hotspot })),
  );
  if (wanted.length === 0) throw new Error("no objects to draw");

  heading(`Objects — ${draft.title}`);
  note(`${wanted.length} objects in ${rooms.length} room(s)`);

  // Batched purely for price. Each call still returns one image per object.
  const batches: Array<typeof wanted> = [];
  for (let i = 0; i < wanted.length; i += BATCH) {
    batches.push(wanted.slice(i, i + BATCH));
  }

  const jobs = batches.map((batch, index) => ({
    key: `objects-${index + 1} (${batch.length})`,
    request: {
      // One prompt covers the batch; the model varies within it. Cheaper than one call
      // per object by a factor of sixteen, and these are set dressing, not portraits.
      prompt: batch
        .map(({ hotspot, room }) => promptFor(hotspot, room))
        .join("; "),
      prompt_style: "rd_animation__small_sprites",
      width: SIZE,
      height: SIZE,
      // Measured, not assumed: this style returns a SINGLE 160x128 sheet — a 5x4 grid of
      // 32px sprites — regardless of num_images. `max_number_of_images: 16` in the
      // catalogue describes the ceiling, not a promise of sixteen separate files. The
      // sheet has to be sliced the way `walkSheet.ts` slices a walk.
      num_images: 1,
      seed: seedFor(batch[0]!.hotspot.id),
      return_spritesheet: true,
      bypass_prompt_expansion: true,
    },
  }));

  for (const job of jobs) await client.assertRequest(job.request);
  const plan = await priceBatch(client, jobs, {
    capUsd: flags.budget ? Number(flags.budget) : undefined,
  });
  console.log(describePlan(plan));
  note(
    `$${(plan.totalUsd / wanted.length).toFixed(4)} an object — small_sprites is flat per call`,
  );
  if (!flags.yes) {
    note("dry run — pass --yes to generate");
    return;
  }
  assertAffordable(plan);

  const paletteImage = (await readFile(join(dir, "atlas.png"))).toString(
    "base64",
  );
  const assetDir = join(dir, "content", "assets", "objects");
  await mkdir(assetDir, { recursive: true });
  const roomDir = join(dir, "content", "rooms");
  const touched = new Set<DreamRoom>();
  let spent = 0;

  for (const [index, job] of plan.jobs.entries()) {
    const batch = batches[index]!;
    process.stdout.write(`  ${job.key} … `);

    // Submit without retries and recover through the task list: a lost response means a
    // job that was accepted and charged, and resubmitting pays for it twice.
    let result;
    const submittedAt = Date.now();
    try {
      const accepted = await client.submit(job.request);
      result = await client.poll(accepted.task_id);
    } catch (error) {
      // DO NOT "recover" by taking the newest succeeded task. An earlier version did
      // exactly that and silently reused one batch's output for four later batches —
      // seven objects ended up pointing at the same picture and nothing failed. A task
      // can only be claimed if it started *after* this batch was submitted, and if it
      // cannot be identified the run stops rather than inventing art.
      const since = submittedAt;
      const orphan = (await client.listTasks(20)).find(
        (task) =>
          (task.status === "succeeded" || task.status === "running") &&
          Date.parse(task.created_at) >= since,
      );
      if (!orphan) throw error;
      warn(`response lost — recovering ${orphan.task_id}`);
      result = await client.poll(orphan.task_id);
    }
    spent += result.balance_cost;

    const images = await client.images(result);
    for (const [slot, raw] of images.entries()) {
      const entry = batch[slot];
      if (!entry) break;
      let base64 = raw.toString("base64");
      try {
        base64 = await client.edit("palette_converter", {
          input_image: base64,
          input_palette: paletteImage,
          dither_mode: "bayer_4x4",
          dither_strength: 35,
        });
      } catch {
        // Free tool; a failure here costs nothing and the raw sprite still ships.
      }
      const buffer = Buffer.from(base64, "base64");
      if (buffer.subarray(0, 4).toString("hex") !== "89504e47") continue;
      const name = `${entry.room.id}--${entry.hotspot.id}.png`;
      await writeFile(join(assetDir, name), buffer);
      entry.hotspot.image = `assets/objects/${name}`;
      touched.add(entry.room);
    }
    console.log(
      `$${result.balance_cost.toFixed(3)} · ${images.length} sprites`,
    );
  }

  for (const room of touched) {
    await writeFile(
      join(roomDir, `${room.id}.json`),
      `${JSON.stringify(room, null, 2)}\n`,
    );
  }

  const { balance } = await client.credits();
  console.log();
  ok(`spent $${spent.toFixed(3)} — $${balance.toFixed(3)} left`);
  note(`Next: bun run lord build ${slug}`);
}
