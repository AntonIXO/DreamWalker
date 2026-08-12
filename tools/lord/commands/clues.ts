/** Generate the six wordless semantic clue objects with Retro Diffusion. */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  RetroDiffusionClient,
  type RetroInferenceRequest,
} from "../art/retroDiffusion";
import { loadContentFiles } from "../content/files";
import { dreamDir, loadDraft, saveDraft } from "../project";
import { heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

interface PrivateMnemonic {
  clues: Array<{
    clueId: string;
    position: number;
    word: string;
    visualPrompt: string;
    retroDiffusion: unknown;
  }>;
}

function numericSeed(slug: string, clueId: string): number {
  let hash = 2166136261;
  for (const character of `${slug}:${clueId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function asBase64(path: string): Promise<string> {
  return (await readFile(path)).toString("base64");
}

export async function cluesCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord clues <slug> [--check-cost|--yes]");
  const token = process.env.RETRO_DIFFUSION_API_KEY?.trim();
  if (!token)
    throw new Error("set RETRO_DIFFUSION_API_KEY before running lord clues");
  const draft = await loadDraft(slug);
  draft.content = await loadContentFiles(draft);
  const dir = dreamDir(slug);
  const privatePath = join(dir, "mnemonic.local.json");
  const mnemonic = JSON.parse(
    await readFile(privatePath, "utf8"),
  ) as PrivateMnemonic;
  const byId = new Map(mnemonic.clues.map((clue) => [clue.clueId, clue]));
  const palette = await asBase64(join(dir, "atlas.png"));
  const reference = draft.provenance.reference
    ? [await asBase64(join(process.cwd(), draft.provenance.reference))]
    : undefined;
  const client = new RetroDiffusionClient(token);
  const style = String(flags.style || "rd_fast__game_asset");
  const pro = style.startsWith("rd_pro__");
  const candidateCount = Math.max(
    1,
    Math.min(pro ? 4 : 16, Number(flags.candidates ?? (pro ? 4 : 2))),
  );
  const detailSize = pro ? 128 : 96;
  await client.assertAvailableStyle(style);

  heading(`Retro clues — ${draft.title}`);
  const selectedClues = flags.clue
    ? draft.content.clues.filter((clue) => clue.id === flags.clue)
    : draft.content.clues;
  if (selectedClues.length === 0) {
    throw new Error(`no clue card ${String(flags.clue)}`);
  }
  const requests = selectedClues.map((clue) => {
    const secret = byId.get(clue.id);
    if (!secret)
      throw new Error(`mnemonic has no private mapping for ${clue.id}`);
    const defaultPrompt = `One clearly recognizable ${secret.word}, centered isolated full silhouette, ordinary proportions, completely blank unmarked surfaces, a single turquoise seam with one sand-colored dot, no letters, no numbers, no symbols, no label, no writing`;
    const prompt = flags.retry
      ? defaultPrompt
      : secret.visualPrompt.trim() || defaultPrompt;
    secret.visualPrompt = prompt;
    const request: RetroInferenceRequest = {
      prompt,
      prompt_style: style,
      width: detailSize,
      height: detailSize,
      num_images: candidateCount,
      seed: numericSeed(slug, clue.id) + Number(flags.retry ?? 0),
      input_palette: palette,
      reference_images: pro ? reference : undefined,
      remove_bg: true,
      bypass_prompt_expansion: true,
    };
    return { clue, secret, request };
  });

  let estimated = 0;
  for (const entry of requests) {
    const cost = await client.estimate(entry.request);
    estimated += cost.balance_cost;
  }
  note(
    `API estimate: $${estimated.toFixed(2)} for ${requests.length * candidateCount} candidates (${style})`,
  );
  if (flags["check-cost"] || !flags.yes) {
    note(
      "No generation was charged. Pass --yes to generate and select candidate 1.",
    );
    return;
  }

  for (const { clue, secret, request } of requests) {
    note(`${clue.id}: generating ${candidateCount} wordless candidates…`);
    const result = await client.generate(request);
    const candidates = await client.images(result);
    if (candidates.length < candidateCount) {
      warn(
        `${clue.id}: API returned ${candidates.length} candidates instead of ${candidateCount}`,
      );
    }
    const outputDir = join(dir, "content", "generated", "clues", clue.id);
    await mkdir(outputDir, { recursive: true });
    await Promise.all(
      candidates.map((image, index) =>
        writeFile(join(outputDir, `candidate-${index + 1}.png`), image),
      ),
    );
    const picked = Math.max(
      0,
      Math.min(candidates.length - 1, Number(flags.pick ?? 1) - 1),
    );
    const selected = candidates[picked];
    if (!selected) throw new Error(`${clue.id}: no image to select`);
    await writeFile(join(outputDir, "detail.png"), selected);

    const source = selected.toString("base64");
    const downscaled = await client.edit("k_centroid_downscale", {
      input_image: source,
      width: 32,
      height: 32,
    });
    const converted = await client.edit("palette_converter", {
      input_image: downscaled,
      input_palette: palette,
      dither_mode: "bayer_4x4",
      dither_strength: 35,
    });
    const corrected = await client.edit("pixel_correction", {
      input_image: converted,
    });
    await writeFile(
      join(outputDir, "world.png"),
      Buffer.from(corrected, "base64"),
    );

    clue.detailImage = `assets/clues/${clue.id}/detail.png`;
    clue.worldImage = `assets/clues/${clue.id}/world.png`;
    secret.retroDiffusion = {
      requestId: result.request_id ?? null,
      style: request.prompt_style,
      seed: request.seed,
      cost: result.balance_cost,
      selectedCandidate: picked + 1,
    };
    await writeFile(
      join(dir, "content", "clues", `${clue.id}.json`),
      `${JSON.stringify(clue, null, 2)}\n`,
      "utf8",
    );
    ok(`${clue.id}: candidate ${picked + 1} selected`);
  }

  await writeFile(
    privatePath,
    `${JSON.stringify(mnemonic, null, 2)}\n`,
    "utf8",
  );
  draft.content = await loadContentFiles(draft);
  await saveDraft(draft);
  ok("six Retro Diffusion clue objects are ready for build");
}
