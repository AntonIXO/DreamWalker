/**
 * What Retro Diffusion charges, and which style is the right one to charge it for.
 *
 * The style catalogue (`GET /v1/styles/selector`) publishes sizes, batch ceilings and
 * reference support — but **not prices**. Prices come from `check_cost`, which is free,
 * so the rule is: price every batch before running it, and memoise, because the cost of
 * a job depends only on `(style, width, height, num_images)`.
 *
 * Every number below was measured against the live API on 2026-08-12, and several of
 * them are surprising enough to change what the pipeline should generate:
 *
 * **`num_images` is not always a multiplier.** `rd_animation__small_sprites` costs
 * $0.07 whether you ask for one sprite or sixteen — 32×32, batch 16, so a sheet of
 * sixteen link objects is $0.0044 each rather than $0.07 each. Image models *do* scale
 * linearly, so the same instinct is wrong in the other direction there.
 *
 * **Two animation styles cost the same and one gives more.**
 * `four_angle_walking` and `four_angle_walking_idle` are both $0.07 at 48×48; the idle
 * variant returns an idle pose as well. There is no reason to buy the plain one.
 *
 * **The expensive animations are the ones that take reference images.**
 * `any_animation`, `big_animation` and `8_dir_rotation` are $0.25 and accept
 * `reference_images`; everything else in the family is $0.07 and does not.
 */

import type {
  RetroDiffusionClient,
  RetroInferenceRequest,
} from "./retroDiffusion";

/** A measured price. `flat` means `num_images` does not change it. */
export interface PriceNote {
  usd: number;
  flat: boolean;
  note?: string;
}

/**
 * Measured prices, for planning and for cross-checking the live estimate.
 *
 * Never used to *charge* — `check_cost` is authoritative and free. This table exists so
 * a batch plan can be costed offline, and so a silent price change shows up as a warning
 * rather than as a drained balance.
 */
export const MEASURED: Record<string, PriceNote> = {
  // --- animation, 1 image
  "rd_animation__four_angle_walking@48x48": { usd: 0.07, flat: true },
  "rd_animation__four_angle_walking_idle@48x48": {
    usd: 0.07,
    flat: true,
    note: "same price as four_angle_walking and includes an idle pose — prefer this",
  },
  "rd_animation__large_walking_idle@64x64": { usd: 0.07, flat: true },
  "rd_animation__battle_sprites@64x64": { usd: 0.07, flat: true },
  "rd_animation__dinoki@48x48": { usd: 0.07, flat: true },
  "rd_animation__vfx@24x24": { usd: 0.07, flat: true },
  "rd_animation__small_sprites@32x32": {
    usd: 0.07,
    flat: true,
    note: "batch up to 16 for the same $0.07 — $0.0044 a sprite, the cheapest art here",
  },
  // --- animation, reference-capable and four times the price
  "rd_animation__any_animation@64x64": { usd: 0.25, flat: true },
  "rd_animation__big_animation@128x128": { usd: 0.25, flat: true },
  "rd_animation__8_dir_rotation@80x80": { usd: 0.25, flat: true },
  // --- portraits
  "rd_plus__default@128x128": { usd: 0.033, flat: false },
  // Not reachable on every key: this account's catalogue exposes only rd_fast__1_bit,
  // __low_res, __mc_item and __mc_texture. Always check the catalogue, never the docs.
  "rd_fast__low_res@128x128": { usd: 0.0194, flat: false },
  "rd_pro__default@128x128": { usd: 0.18, flat: false },
  // --- room backdrops
  "rd_plus__environment@320x176": { usd: 0.053, flat: false },
};

/**
 * The canvas edit tools, from `GET /v1/edit/tools` on 2026-08-12.
 *
 * This matters more than it looks: **the entire ingestion chain is free**. Downscaling a
 * 48px sprite to the atlas grid, locking it to the dream's palette and snapping it back
 * onto whole pixels all cost nothing, so every acceptance check in §5 of
 * `prompts-pixelart.md` — «проверять скриптом, не глазом» — can run on every asset,
 * every time, without touching the balance. All the budget risk is in generation.
 *
 * Call `client.editTools()` rather than trusting this copy; it is here so a plan can be
 * costed offline and so a tool quietly becoming paid shows up as a diff.
 */
export const EDIT_TOOLS: Record<string, PriceNote> = {
  k_centroid_downscale: {
    usd: 0,
    flat: true,
    note: "input_image,width,height — 48px sprite frames to the atlas grid",
  },
  palette_converter: {
    usd: 0,
    flat: true,
    note: "input_image,input_palette,dither_mode,dither_strength — the palette lock",
  },
  pixel_correction: {
    usd: 0,
    flat: true,
    note: "input_image — snaps to the pixel grid",
  },
  color_reducer: {
    usd: 0,
    flat: true,
    note: "input_image,color_count,dither_mode,dither_strength",
  },
  rotate: { usd: 0, flat: true, note: "input_image,rotation_degrees" },
  background_remover: { usd: 0.01, flat: true },
  color_style_transfer: { usd: 0.01, flat: true },
  image_edit: { usd: 0.18, flat: true },
  inpainting: { usd: 0.18, flat: true },
  outpainting: { usd: 0.18, flat: true },
  seam_tiling: { usd: 0.18, flat: true },
};

/**
 * How to make one character's portrait and sprite look like the same person.
 *
 * The problem `prompts-pixelart.md` §0 is about: four portrait states generated
 * independently come back as four different people. Its answer is reference images,
 * which are RD Pro only at $0.18 each.
 *
 * `input_image` + `strength` does the same conditioning on any model, and RD's own
 * `03_img2img.py` documents it — raw base64, no data URI, RGB without transparency,
 * and never send a `model` field because the model comes from `prompt_style`. So the
 * cheap chain is:
 *
 *   1. one walk sheet            $0.07   four angles of the character
 *   2. its south-facing frame  → input_image for the neutral portrait
 *   3. the curated portrait    → input_image for the other three states
 *
 * The sprite and the face are then tied to the same source rather than to the same
 * adjectives, for $0.07 + 4 × $0.033 = $0.20 a character instead of $1.26 at RD Pro.
 */
export const CONSISTENCY_STRENGTH = 0.45;

/** RD's published formulas, for a size that was never measured directly. */
export function estimateLocally(
  style: string,
  width: number,
  height: number,
  numImages: number,
): number {
  const area = width * height;
  const prefix = style.split("__")[0];
  if (prefix === "rd_animation") return 0.07;
  if (prefix === "rd_advanced_animation") return 0.14;
  if (prefix === "rd_tile") return 0.1;
  if (prefix === "rd_pro") return 0.18 * numImages;
  if (style.includes("low_res") || style.includes("mc_")) {
    return Math.max(0.02, (area + 13_700) / 600_000) * numImages;
  }
  if (prefix === "rd_plus") {
    return Math.max(0.025, (area + 50_000) / 2_000_000) * numImages;
  }
  return Math.max(0.015, (area + 100_000) / 6_000_000) * numImages;
}

export interface PricedJob {
  key: string;
  request: RetroInferenceRequest;
  usd: number;
}

export interface BudgetPlan {
  jobs: PricedJob[];
  totalUsd: number;
  balanceUsd: number;
  reserveUsd: number;
  capUsd: number;
}

function shapeKey(request: RetroInferenceRequest): string {
  return `${request.prompt_style}|${request.width}x${request.height}|${request.num_images}`;
}

/**
 * Cost a batch before running any of it.
 *
 * Memoised by shape, because price depends on nothing else: twenty-nine room backdrops
 * at the same size and style cost **one** dry run, not twenty-nine.
 */
export async function priceBatch(
  client: RetroDiffusionClient,
  jobs: Array<{ key: string; request: RetroInferenceRequest }>,
  options: { capUsd?: number; reserveUsd?: number } = {},
): Promise<BudgetPlan> {
  const seen = new Map<string, number>();
  const priced: PricedJob[] = [];

  for (const job of jobs) {
    const shape = shapeKey(job.request);
    let usd = seen.get(shape);
    if (usd === undefined) {
      const estimate = await client.estimate({
        ...job.request,
        num_images: job.request.num_images,
      });
      usd = estimate.balance_cost;
      seen.set(shape, usd);

      // A quiet price change is the failure mode that drains a balance, so say so.
      const local = estimateLocally(
        job.request.prompt_style,
        job.request.width,
        job.request.height,
        job.request.num_images,
      );
      if (local > 0 && Math.abs(local - usd) / Math.max(local, usd) > 0.01) {
        console.warn(
          `[rd] ${shape} priced at $${usd.toFixed(4)}, formula says $${local.toFixed(4)}`,
        );
      }
    }
    priced.push({ key: job.key, request: job.request, usd });
  }

  const { balance } = await client.credits();
  const reserveUsd = options.reserveUsd ?? 0.25;
  const capUsd = Math.min(options.capUsd ?? Infinity, balance - reserveUsd);
  return {
    jobs: priced,
    totalUsd: priced.reduce((sum, job) => sum + job.usd, 0),
    balanceUsd: balance,
    reserveUsd,
    capUsd,
  };
}

/** Refuse a plan that cannot be paid for, before the first job runs. */
export function assertAffordable(plan: BudgetPlan): void {
  if (plan.totalUsd <= plan.capUsd) return;
  throw new Error(
    `batch costs $${plan.totalUsd.toFixed(3)} but only $${Math.max(0, plan.capUsd).toFixed(3)} is available ` +
      `(balance $${plan.balanceUsd.toFixed(3)} less $${plan.reserveUsd.toFixed(2)} reserve) — ` +
      `raise --budget, top up, or generate fewer candidates`,
  );
}

/** A table for `--check-cost`, so the author sees what they are about to spend. */
export function describePlan(plan: BudgetPlan): string {
  const lines = plan.jobs.map(
    (job) => `  ${job.key.padEnd(38)} $${job.usd.toFixed(4)}`,
  );
  lines.push(
    `  ${"TOTAL".padEnd(38)} $${plan.totalUsd.toFixed(3)}  of $${plan.balanceUsd.toFixed(3)}`,
  );
  return lines.join("\n");
}
