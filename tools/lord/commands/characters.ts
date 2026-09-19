/** Generate one two-frame, four-direction Retro Diffusion sheet per figure. */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CharacterDefinition } from "../../../src/shared/content";
import { characterSpritePrompt } from "../art/characterSprites";
import { assertAffordable, describePlan, priceBatch } from "../art/pricing";
import {
  RejectedBeforeCharge,
  RetroDiffusionClient,
  type RetroInferenceRequest,
} from "../art/retroDiffusion";
import { decodePng } from "../art/reference";
import { encodePngRgba, keyOutBackground } from "../art/sheet";
import {
  anchorReport,
  readWalkSheet,
  reduceWalkSheetToTwoFrames,
} from "../art/walkSheet";
import { loadContentFiles } from "../content/files";
import { dreamDir, loadDraft } from "../project";
import { heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

const STYLE = "rd_animation__four_angle_walking_idle";
const FRAME = 48;
const SUBMIT_GAP_MS = 6500;

interface SpriteManifestEntry {
  path: string;
  frameW: number;
  frameH: number;
  dirs: string[];
  frames: number;
  anchorY: number;
}

function seedFor(id: string): number {
  let hash = 2166136261;
  for (const ch of `figure:${id}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function submitWithBackoff(
  client: RetroDiffusionClient,
  request: RetroInferenceRequest,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const accepted = await client.submit(request);
      // Polling is read-only. A transient SOCKS failure here must retry the same task,
      // never submit a second paid generation.
      for (let pollAttempt = 0; ; pollAttempt++) {
        try {
          return await client.poll(accepted.task_id);
        } catch (error) {
          const message = String(error);
          const terminal =
            message.includes("job failed") || message.includes("timed out");
          if (terminal || pollAttempt >= 8) throw error;
          warn(
            `poll for ${accepted.task_id} interrupted; retrying the same task`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(30_000, 5000 * 2 ** pollAttempt)),
          );
        }
      }
    } catch (error) {
      if (!(error instanceof RejectedBeforeCharge) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
}

async function charactersFor(slug: string): Promise<CharacterDefinition[]> {
  if (slug === "son") {
    const { allCharacters } = await import("../../../dreams/son/figures/cards");
    return allCharacters();
  }
  const draft = await loadDraft(slug);
  return (await loadContentFiles(draft)).characters;
}

export async function charactersCommand(
  slug: string | null,
  flags: Flags,
): Promise<void> {
  if (!slug)
    throw new Error("usage: lord characters <slug> [--figure id] [--yes]");
  const token = process.env.RETRO_DIFFUSION_API_KEY?.trim();
  if (!token) throw new Error("RETRO_DIFFUSION_API_KEY is not set");

  const draft = await loadDraft(slug);
  const client = new RetroDiffusionClient(token);
  const style = String(flags.style ?? STYLE);
  // Colour/symmetry guesses are unreliable for hoods, bald heads and monsters.
  // Use an explicit row order and review the sheet before publishing it.
  const order = String(flags.directions ?? "s,e,n,w").split(",");
  if (
    order.length !== 4 ||
    new Set(order).size !== 4 ||
    order.some((dir) => !["s", "e", "n", "w"].includes(dir))
  ) {
    throw new Error("--directions must list all four rows, e.g. s,e,n,w");
  }
  const assetDir = join(dreamDir(slug), "content", "assets", "sprites");
  const all = await charactersFor(slug);
  const selected = all.filter((character) =>
    flags.figure ? character.id === String(flags.figure) : true,
  );
  if (selected.length === 0) {
    throw new Error(`no character ${String(flags.figure)}`);
  }

  const characters: CharacterDefinition[] = [];
  for (const character of selected) {
    const path = join(assetDir, `${character.id}.png`);
    if (!flags.force && (await exists(path))) continue;
    characters.push(character);
  }
  if (characters.length === 0)
    throw new Error("all selected character sheets already exist");

  heading(`Character sprites — ${draft.title}`);
  note(
    `${characters.length} four-direction walk+idle sheets via Retro Diffusion`,
  );

  const jobs = characters.map((character) => ({
    key: character.id,
    request: {
      prompt: characterSpritePrompt(character),
      prompt_style: style,
      width: FRAME,
      height: FRAME,
      num_images: 1,
      seed: seedFor(character.id) + Number(flags.retry ?? 0),
      frames_duration: 4 as const,
      return_spritesheet: true,
      upload_outputs: false,
      remove_bg: true,
      bypass_prompt_expansion: true,
    },
  }));

  for (const job of jobs) await client.assertRequest(job.request);
  const plan = await priceBatch(client, jobs, {
    capUsd: flags.budget ? Number(flags.budget) : undefined,
    reserveUsd: 0.25,
  });
  console.log(describePlan(plan));
  if (!flags.yes) {
    note("dry run — pass --yes to generate");
    return;
  }
  assertAffordable(plan);
  const recoverTask = flags.recover ? String(flags.recover) : null;
  if (recoverTask && plan.jobs.length !== 1) {
    throw new Error("--recover requires exactly one --figure");
  }

  await mkdir(assetDir, { recursive: true });
  const manifestPath = join(assetDir, "manifest.json");
  let manifest: Record<string, SpriteManifestEntry> = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      SpriteManifestEntry
    >;
  } catch {
    // The first generated character creates the manifest.
  }
  const paletteImage = (
    await readFile(join(dreamDir(slug), "atlas.png"))
  ).toString("base64");
  let spent = 0;

  for (const [index, job] of plan.jobs.entries()) {
    process.stdout.write(`  ${job.key} … `);
    const result = recoverTask
      ? await client.poll(recoverTask)
      : await submitWithBackoff(client, job.request);
    spent += result.balance_cost;
    const [raw] = await client.images(result);
    if (!raw) throw new Error(`${job.key}: Retro Diffusion returned no image`);

    let bytes = raw;
    try {
      const converted = await client.edit("palette_converter", {
        input_image: raw.toString("base64"),
        input_palette: paletteImage,
        dither_mode: "bayer_4x4",
        dither_strength: 24,
      });
      bytes = Buffer.from(converted, "base64");
    } catch (error) {
      warn(`${job.key}: palette lock skipped: ${String(error)}`);
    }

    // Palette conversion paints transparent pixels cream. Clear only the cream that is
    // connected to an edge, so cream clothing and highlights inside the body survive.
    const sheet = readWalkSheet(keyOutBackground(decodePng(bytes)), FRAME);
    const reduced = reduceWalkSheetToTwoFrames(sheet);
    const weakStride = reduced.picks.some((pick) => pick.difference < 0.16);
    if (weakStride) warn(`${job.key}: subtle stride; inspect the sheet`);
    const anchors = reduced.picks.map((pick, row) =>
      anchorReport(sheet.frames[row]![pick.indices[0]]!),
    );
    const floating = anchors.some(
      (anchor) => anchor.bottomGap > 10 || Math.abs(anchor.centroidOffset) > 7,
    );
    if (floating) warn(`${job.key}: unusual foot anchor; inspect the sheet`);
    warn(
      `${job.key}: visually review row order ${order.join(",")} before publishing`,
    );

    await writeFile(
      join(assetDir, `${job.key}.png`),
      encodePngRgba(reduced.image),
    );
    manifest[job.key] = {
      path: `assets/sprites/${job.key}.png`,
      frameW: FRAME,
      frameH: FRAME,
      dirs: order,
      frames: 2,
      anchorY: 0.9,
    };
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        Object.fromEntries(
          Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
        ),
        null,
        2,
      )}\n`,
    );
    console.log(
      `$${result.balance_cost.toFixed(3)} · dirs ${order.join(",")} · picks ${reduced.picks.map((pick) => pick.indices.join("/")).join(" ")}`,
    );

    if (index < plan.jobs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SUBMIT_GAP_MS));
    }
  }

  const { balance } = await client.credits();
  console.log();
  ok(`generated ${plan.jobs.length} character sheets for $${spent.toFixed(3)}`);
  note(`$${balance.toFixed(3)} Retro Diffusion balance remains`);
  note(`Next: bun run lord build ${slug}`);
}
