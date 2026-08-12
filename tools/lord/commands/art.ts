/**
 * `lord art <slug>` — four candidates per tile, a person picks one.
 *
 * This command is the concept's whole answer to slop (§7.4). Not a better model, not a
 * cleanup pass: a human in the loop as *selector*, which is the affordable half of the
 * studio answer of human paintover. The Lord never has to draw anything, only to have
 * taste for a few seconds per tile.
 *
 * Characters are not curated — §7.3 makes them palette swaps of fixed silhouettes, so
 * there is nothing to choose between and nothing that can drift out of the palette.
 */

import {
  CANDIDATES_PER_ROLE,
  TILE_ROLES,
  proceduralCandidates,
  type Candidate,
  type CandidateSource,
} from "../art/candidates";
import {
  autotileOf,
  frameCount,
  frameNamesFor,
} from "../../../src/shared/autotile";
import { bakeAtlas, writeAtlas } from "../art/atlas";
import { buildFigureFrames, buildPlayerFrames } from "../art/silhouettes";
import { toRgba, type Raster } from "../../../src/shared/art/raster";
import { dreamDir, loadDraft, saveDraft } from "../project";
import { randomSeedWord } from "../rng";
import {
  color,
  heading,
  isInteractive,
  note,
  ok,
  readOneOf,
} from "../term/prompt";
import { renderRow, renderSwatches } from "../term/pixels";
import type { Flags } from "../cli";

function previewCandidates(
  candidates: readonly Candidate[],
  background: string,
): string {
  return renderRow(
    candidates.map((candidate) => toRgba(candidate.preview)),
    candidates.map((_, i) => ` ${i + 1}`),
    background,
    3,
  );
}

export async function artCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord art <slug>");
  const draft = await loadDraft(slug);

  const source: CandidateSource = proceduralCandidates;
  const seed = flags.seed ?? draft.provenance.artSeed ?? randomSeedWord();
  const background =
    draft.palette.colors[draft.palette.roles.background] ?? "#101014";

  heading(`Art — ${draft.title}`);
  note(`source "${source.name}" · style: ${draft.styleWords.join(", ")}`);
  note(
    `palette "${draft.palette.name}" — every tile is drawn only from these:`,
  );
  console.log();
  console.log(renderSwatches(draft.palette.colors));

  const frames: Record<string, Raster> = {};
  const roleFrames: Record<string, string[]> = {};
  const chosen: Record<string, number> = {};

  for (const role of TILE_ROLES) {
    const candidates = await source.generate(
      role,
      draft.palette,
      draft.style,
      draft.styleWords,
      seed,
      CANDIDATES_PER_ROLE,
    );

    let pick = draft.provenance.chosen[role] ?? 0;

    if (isInteractive() && !flags.yes) {
      const kind = autotileOf(role);
      console.log();
      console.log(
        `${color.bold(role)} ${color.grey(
          kind === "plain"
            ? `— pick one of ${candidates.length}`
            : `— pick one of ${candidates.length}; ${frameCount(kind)} frames follow your choice`,
        )}`,
      );
      console.log(previewCandidates(candidates, background));
      const keys = candidates.map((_, i) => String(i + 1));
      const key = await readOneOf(keys, color.grey(`1-${candidates.length}`));
      pick = Number(key) - 1;
    }

    const winner = candidates[pick] ?? candidates[0]!;
    // Frame names are the contract with the renderer: `frameNamesFor` is the same function
    // `render/tilemap.ts` asks with, so a set baked here is a set it can find.
    const names = frameNamesFor(role);
    names.forEach((name, i) => {
      const raster = winner.frames[i] ?? winner.preview;
      frames[name] = raster;
    });
    roleFrames[role] = names;
    chosen[role] = winner.variant;
  }

  // Characters: no curation, only recolouring.
  Object.assign(frames, buildPlayerFrames(draft.palette));
  Object.assign(frames, buildFigureFrames(draft.palette));

  // Character frames stand for themselves: `walkerView.ts` reconstructs their names
  // directly rather than going through a role.
  for (const name of Object.keys(frames)) {
    if (name in roleFrames) continue;
    if (TILE_ROLES.some((role) => roleFrames[role]?.includes(name))) continue;
    roleFrames[name] = [name];
  }

  const baked = bakeAtlas({
    frames,
    roleFrames,
    chosen,
    palette: draft.palette,
  });
  await writeAtlas(dreamDir(slug), baked);

  draft.provenance.artSeed = seed;
  draft.provenance.chosen = chosen;
  await saveDraft(draft);

  console.log();
  ok(
    `atlas baked — ${Object.keys(frames).length} frames, ` +
      `${(baked.png.length / 1024).toFixed(1)} KB, ${draft.palette.colors.length} colours`,
  );
  note(`dreams/${slug}/atlas.png + atlas.json`);
  console.log();
  note(`Next: bun run lord figures ${slug}`);
}
