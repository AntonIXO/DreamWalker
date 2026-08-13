/**
 * `lord objects <slug>` — art for the things in the rooms.
 *
 * The rooms carry 106 authored hotspots: a rope to the vault, a shelf you can sleep on,
 * a piece of meat somebody has decided is a bomb. Those are what the player actually
 * looks at and touches, and they are the right thing to spend the budget on — a room is
 * legible from tiles and objects, whereas one big painted backdrop is a perspective
 * picture that fights the walk mask and costs more.
 *
 * The economics, corrected. The first attempt used `rd_animation__small_sprites`
 * because it is $0.07 flat — but that style is a *character* sheet: one figure in twenty
 * poses (four-direction walk, arms, looking, surprised, lying down). Flat pricing there
 * buys frames of one subject, not a set of different objects, and the sheet it returned
 * was twenty pictures of the same man.
 *
 * `rd_plus__item_sheet` is the style built for this: many distinct objects on one canvas,
 * priced **per canvas rather than per object**. Everything after generation is free.
 *
 *   lord objects <slug>                    price it and stop
 *   lord objects <slug> --room 19 --yes    art for one room's objects
 *   lord objects <slug> --yes --budget 1   the lot, under a ceiling
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DreamRoom, RoomHotspot } from "../../../src/shared/room";
import { objectHotspotPrompt } from "../art/pixelPrompts";
import { assertAffordable, describePlan, priceBatch } from "../art/pricing";
import {
  RejectedBeforeCharge,
  RetroDiffusionClient,
  type RetroInferenceRequest,
} from "../art/retroDiffusion";
import { decodePng } from "../art/reference";
import { encodePngRgba, keyOutBackground, sliceSheet } from "../art/sheet";
import { loadRoomFiles } from "../content/files";
import { dreamDir, loadDraft } from "../project";
import { heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

/**
 * Submit, waiting out a rate limit rather than treating it as a lost response.
 *
 * This is the bug that broke the first run. `submit` has retries disabled so an
 * ambiguous transport failure cannot be paid for twice — but a 429 is not ambiguous, and
 * six of seven batches died on one. Worse, each was then handed to "recovery", which
 * found the *first* batch's finished task and reused its art six times.
 */
async function submitWithBackoff(
  client: RetroDiffusionClient,
  request: RetroInferenceRequest,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const accepted = await client.submit(request);
      return await client.poll(accepted.task_id);
    } catch (error) {
      if (!(error instanceof RejectedBeforeCharge) || attempt >= 4) throw error;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

/** Sixteen to a call, because sixteen cost the same as one. */
const BATCH = 12;
const SHEET = 256;
const CELL = 64;

/** ~10 requests a minute per key is the ceiling, and seven in a row tripped it. */
const SUBMIT_GAP_MS = 7000;

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
  return objectHotspotPrompt(hotspot.prompt, room.id);
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
      // One canvas, many objects, described as a grid so the slicer has something
      // regular to cut. The style renders pixel art; the prompt is subjects.
      prompt:
        `grid of ${batch.length} distinct top-down game objects, evenly spaced, ` +
        `simple flat background: ` +
        batch.map(({ hotspot, room }) => promptFor(hotspot, room)).join("; "),
      prompt_style: "rd_plus__item_sheet",
      width: SHEET,
      height: SHEET,
      num_images: 1,
      seed: seedFor(batch[0]!.hotspot.id),
      bypass_prompt_expansion: true,
    },
  }));

  for (const job of jobs) await client.assertRequest(job.request);
  const plan = await priceBatch(client, jobs, {
    capUsd: flags.budget ? Number(flags.budget) : undefined,
  });
  console.log(describePlan(plan));
  note(
    `$${(plan.totalUsd / wanted.length).toFixed(4)} an object — priced per sheet, not per object`,
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
  const startBalance = plan.balanceUsd;
  let spent = 0;

  for (const [index, job] of plan.jobs.entries()) {
    const batch = batches[index]!;
    process.stdout.write(`  ${job.key} … `);

    // Submit without retries and recover through the task list: a lost response means a
    // job that was accepted and charged, and resubmitting pays for it twice.
    let result;
    const submittedAt = Date.now();
    try {
      result = await submitWithBackoff(client, job.request);
    } catch (error) {
      if (error instanceof RejectedBeforeCharge) throw error;
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

    const [sheet] = await client.images(result);
    if (!sheet) {
      warn("no sheet came back");
      continue;
    }
    // One canvas holding many objects: cut it on the grid the prompt asked for.
    const cells = sliceSheet(decodePng(sheet), CELL);
    for (const [slot, cell] of cells.entries()) {
      const entry = batch[slot];
      if (!entry) break;
      // Clear the sheet's flat background before anything else touches it.
      let base64 = encodePngRgba(keyOutBackground(cell)).toString("base64");
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
    console.log(`$${result.balance_cost.toFixed(3)} · ${cells.length} cells`);

    // Stay under the documented ~10 requests a minute.
    if (index < plan.jobs.length - 1) {
      await new Promise((r) => setTimeout(r, SUBMIT_GAP_MS));
    }
  }

  for (const room of touched) {
    await writeFile(
      join(roomDir, `${room.id}.json`),
      `${JSON.stringify(room, null, 2)}\n`,
    );
  }

  // Measured against the balance rather than summed from results: a result that came
  // back from recovery is a job that was already paid for, and adding its cost again
  // reports a loss that never happened. The first run claimed $0.49 and cost $0.07.
  const { balance } = await client.credits();
  console.log();
  ok(
    `spent $${(startBalance - balance).toFixed(3)} (${spent.toFixed(3)} reported by jobs) — $${balance.toFixed(3)} left`,
  );
  note(`Next: bun run lord build ${slug}`);
}
