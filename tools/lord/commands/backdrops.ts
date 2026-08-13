/**
 * `lord backdrops <slug>` — the picture a room is.
 *
 * Generation is the only part that costs anything; everything after it is free, because
 * `GET /v1/edit/tools` reports `palette_converter` and `pixel_correction` as free tools.
 * So every backdrop is locked to the dream's palette and snapped back onto whole pixels
 * as a matter of course, rather than as something you pay extra to be careful about.
 *
 *   lord backdrops <slug> --check-cost        price it and stop
 *   lord backdrops <slug> --room 19 --yes     generate one
 *   lord backdrops <slug> --yes --budget 1.5  generate the lot, under a ceiling
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DreamRoom } from "../../../src/shared/room";
import { assertAffordable, describePlan, priceBatch } from "../art/pricing";
import { roomBackdropPrompt } from "../art/pixelPrompts";
import { RetroDiffusionClient } from "../art/retroDiffusion";
import { loadRoomFiles } from "../content/files";
import { dreamDir, loadDraft } from "../project";
import { heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

function seedFor(id: string): number {
  let hash = 2166136261;
  for (const ch of id) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0);
}

function promptFor(room: DreamRoom): string {
  return roomBackdropPrompt(room.id);
}

export async function backdropsCommand(
  slug: string | null,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord backdrops <slug>");
  const token = process.env.RETRO_DIFFUSION_API_KEY;
  if (!token) throw new Error("RETRO_DIFFUSION_API_KEY is not set");

  const draft = await loadDraft(slug);
  const client = new RetroDiffusionClient(token);
  const dir = dreamDir(slug);
  const rooms = (await loadRoomFiles(slug)).filter((room) => {
    if (flags.room && !room.id.startsWith(String(flags.room))) return false;
    if (!flags.force && room.graphics.backdropImage) return false;
    return true;
  });
  if (rooms.length === 0) throw new Error("no rooms matched");

  heading(`Backdrops — ${draft.title}`);

  // A meta-space is one full-frame picture; a place is its own tile rect, so the art is
  // generated at exactly the size it will be drawn and never resampled.
  const jobs = rooms.map((room) => {
    const wide = room.kind === "meta";
    return {
      key: room.id,
      request: {
        prompt: promptFor(room),
        // rd_plus__environment for both. The documented rd_fast__game_asset is not in
        // this account's live catalogue — the published style list is wider than what a
        // given key can actually reach, which is why assertRequest checks the catalogue
        // rather than a hardcoded name.
        // `topdown_map` rather than `environment`: the latter draws scenes in elevation.
        prompt_style: "rd_plus__topdown_map",
        // §1.5: a meta-space is one 256×144 picture, not a tileset.
        width: wide ? 256 : room.width * room.tileSize,
        height: wide ? 144 : room.height * room.tileSize,
        num_images: 1,
        seed: seedFor(room.id),
        // Off. The expander rewrites the prompt per call, which both loses the camera
        // instruction and makes two rooms of the same dream disagree about what the
        // style words meant.
        bypass_prompt_expansion: true,
      },
    };
  });

  for (const job of jobs) await client.assertRequest(job.request);
  const plan = await priceBatch(client, jobs, {
    capUsd: flags.budget ? Number(flags.budget) : undefined,
  });
  console.log(describePlan(plan));
  if (!flags.yes) {
    note("dry run — pass --yes to generate");
    return;
  }
  assertAffordable(plan);

  const paletteImage = (await readFile(join(dir, "atlas.png"))).toString(
    "base64",
  );
  const assetDir = join(dir, "content", "assets", "rooms");
  await mkdir(assetDir, { recursive: true });
  const roomDir = join(dir, "content", "rooms");

  let spent = 0;
  for (const job of plan.jobs) {
    const room = rooms.find((candidate) => candidate.id === job.key)!;
    process.stdout.write(`  ${room.id} … `);
    try {
      // A submit whose response is lost was still accepted *and charged*. Resubmitting
      // pays twice — which is exactly what happened when a command timeout killed this
      // very loop mid-flight. Submit without retries, then recover through the task list.
      let result;
      try {
        const accepted = await client.submit(job.request);
        result = await client.poll(accepted.task_id);
      } catch (error) {
        const recent = await client.listTasks(10);
        const orphan = recent.find(
          (task) => task.status === "succeeded" || task.status === "running",
        );
        if (!orphan) throw error;
        warn(`submission response lost — recovering task ${orphan.task_id}`);
        result = await client.poll(orphan.task_id);
      }
      spent += result.balance_cost;
      const [raw] = await client.images(result);
      if (!raw) {
        warn("no image");
        continue;
      }

      // Free from here: lock to the dream's palette, then snap back onto whole pixels.
      let base64 = raw.toString("base64");
      try {
        base64 = await client.edit("palette_converter", {
          input_image: base64,
          input_palette: paletteImage,
          dither_mode: "bayer_4x4",
          dither_strength: 35,
        });
        base64 = await client.edit("pixel_correction", { input_image: base64 });
      } catch (error) {
        warn(`post-processing skipped: ${String(error)}`);
      }

      const buffer = Buffer.from(base64, "base64");
      if (buffer.subarray(0, 4).toString("hex") !== "89504e47") {
        warn(`${room.id} came back as something other than a PNG`);
        continue;
      }
      await writeFile(join(assetDir, `${room.id}.png`), buffer);

      room.graphics.backdropImage = `assets/rooms/${room.id}.png`;
      await writeFile(
        join(roomDir, `${room.id}.json`),
        `${JSON.stringify(room, null, 2)}\n`,
      );
      console.log(`$${result.balance_cost.toFixed(3)}`);
    } catch (error) {
      warn(`${room.id} skipped: ${String(error)}`);
    }
  }

  const { balance } = await client.credits();
  console.log();
  ok(`spent $${spent.toFixed(3)} — $${balance.toFixed(3)} left`);
  note(`Next: bun run lord build ${slug}`);
}
