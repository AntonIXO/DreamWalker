/**
 * The generation recipe — how many times each grammar rule may fire.
 *
 * This is GraphDungeonGenerator's `graphRecipe.txt`, as TypeScript so the Lord gets
 * type errors instead of a silently ignored line. §10 of the concept calls the number
 * of hooks "the main difficulty dial, felt out on live players" — this is where that
 * dial lives.
 */

export const RULE_NAMES = [
  "addNormal",
  "addPuzzle",
  "addKeyLock",
  "addLever",
  "makeLink",
  "makeBranching",
  "moveLockBack",
] as const;

export type RuleName = (typeof RULE_NAMES)[number];

export interface RuleBudget {
  min: number;
  max: number;
}

export type Recipe = Record<RuleName, RuleBudget>;

/**
 * A dream you can cross in a few minutes but not in one straight line: three
 * gates, one backdoor, a couple of loops so it does not read as a tree.
 */
export const DEFAULT_RECIPE: Recipe = {
  addNormal: { min: 4, max: 7 },
  addPuzzle: { min: 1, max: 2 },
  addKeyLock: { min: 1, max: 2 },
  addLever: { min: 1, max: 1 },
  makeLink: { min: 1, max: 2 },
  makeBranching: { min: 2, max: 4 },
  moveLockBack: { min: 0, max: 1 },
};

/** One room and a way out. Useful for testing the §9 single-scene MVP. */
export const SMALL_RECIPE: Recipe = {
  addNormal: { min: 2, max: 3 },
  addPuzzle: { min: 0, max: 1 },
  addKeyLock: { min: 1, max: 1 },
  addLever: { min: 0, max: 0 },
  makeLink: { min: 0, max: 1 },
  makeBranching: { min: 1, max: 2 },
  moveLockBack: { min: 0, max: 0 },
};

export const RECIPES: Record<string, Recipe> = {
  default: DEFAULT_RECIPE,
  small: SMALL_RECIPE,
};

export function validateRecipe(recipe: Recipe): void {
  for (const name of RULE_NAMES) {
    const budget = recipe[name];
    if (!budget) throw new Error(`recipe is missing rule ${name}`);
    if (budget.min < 0) throw new Error(`${name}.min must be >= 0`);
    if (budget.max < budget.min)
      throw new Error(`${name}.max must be >= ${name}.min`);
  }
}
