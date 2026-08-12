/**
 * `lord layout <slug>` — generate a starting map and keep rerolling until it is right.
 *
 * §6 keeps Dormans' planner, but demoted: this produces the *starting* layout, not a
 * proof. There is no solvability solver and no coverage check — the concept threw both
 * out deliberately. What replaces them is the person at the keyboard, who looks at the
 * map and presses `r` if it is boring.
 *
 * Once accepted, the map is data. Nothing re-derives it from the seed at runtime; the
 * seed is kept only so a reroll can be repeated.
 */

import { generateLayout } from "../worldgen/layout";
import { generateMissionGraph } from "../worldgen/missionGraph";
import { RECIPES, type Recipe } from "../worldgen/recipe";
import { buildOverworld, strandedRegions } from "../worldgen/overworld";
import { makeRng, randomSeedWord } from "../worldgen/rng";
import { loadDraft, saveDraft } from "../project";
import {
  color,
  heading,
  note,
  ok,
  readOneOf,
  isInteractive,
} from "../term/prompt";
import { previewMap } from "../term/mapview";
import type { DreamMap } from "../../../src/shared/dream";
import type { Flags } from "../cli";

function recipeFor(name: string): Recipe {
  const recipe = RECIPES[name];
  if (!recipe) {
    throw new Error(
      `unknown recipe "${name}". Known: ${Object.keys(RECIPES).join(", ")}`,
    );
  }
  return recipe;
}

function generate(
  seed: string,
  recipe: Recipe,
): { map: DreamMap; applied: string[] } {
  // One Rng threaded through all three stages: the same seed always gives the same map,
  // which is what makes a reroll something the Lord can step back to.
  const rng = makeRng(seed);
  const mission = generateMissionGraph(rng, recipe);
  const layout = generateLayout(mission.graph, rng);
  const map = buildOverworld(layout, mission.graph, rng);

  // The mission graph guarantees the *mission* is crossable; it knows nothing about the
  // ground. Terrain is built by taking walkable tiles away — water, buildings, cliffs —
  // and any one of those can wall a place off by accident. A preview will not show it:
  // the map looks perfectly good and half of it cannot be reached. So it is checked, and
  // a world that fails is thrown away like any other bad roll.
  const stranded = strandedRegions(map);
  if (stranded.length > 0) {
    throw new Error(`terrain walled off ${stranded.join(", ")}`);
  }

  return { map, applied: mission.applied };
}

export async function layoutCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord layout <slug>");
  const draft = await loadDraft(slug);

  const recipeName = flags.recipe ?? draft.provenance.recipe ?? "default";
  const recipe = recipeFor(recipeName);

  heading(`Layout — ${draft.title}`);
  note(`recipe "${recipeName}" · ${draft.genreContract}`);

  let seed = flags.seed ?? randomSeedWord();

  for (;;) {
    let result: { map: DreamMap; applied: string[] };
    try {
      result = generate(seed, recipe);
    } catch (error) {
      note(
        color.red(
          `seed "${seed}" produced nothing usable: ${(error as Error).message}`,
        ),
      );
      seed = randomSeedWord();
      continue;
    }

    previewMap(result.map, draft.palette, seed);
    console.log(`  ${color.grey(`rules: ${result.applied.join(", ")}`)}`);

    if (!isInteractive() || flags.yes) {
      draft.map = result.map;
      draft.provenance.layoutSeed = seed;
      draft.provenance.recipe = recipeName;
      // A new map invalidates where everybody was standing.
      if (draft.figures.length > 0) {
        note(
          `clearing ${draft.figures.length} figure placements — the rooms moved`,
        );
        draft.figures = [];
      }
      await saveDraft(draft);
      console.log();
      ok(`layout accepted (seed ${seed})`);
      note(`Next: bun run lord art ${slug}`);
      return;
    }

    console.log();
    const key = await readOneOf(
      ["r", "a", "q"],
      `${color.bold("r")}eroll · ${color.bold("a")}ccept · ${color.bold("q")}uit`,
    );

    if (key === "q") {
      note("nothing written");
      return;
    }
    if (key === "r") {
      seed = randomSeedWord();
      continue;
    }

    draft.map = result.map;
    draft.provenance.layoutSeed = seed;
    draft.provenance.recipe = recipeName;
    if (draft.figures.length > 0) {
      note(
        `clearing ${draft.figures.length} figure placements — the rooms moved`,
      );
      draft.figures = [];
    }
    await saveDraft(draft);

    console.log();
    ok(`layout accepted (seed ${seed})`);
    note(`${result.map.rooms.length} cells, ${result.map.doors.length} doors`);
    console.log();
    note(`Next: bun run lord art ${slug}`);
    return;
  }
}
