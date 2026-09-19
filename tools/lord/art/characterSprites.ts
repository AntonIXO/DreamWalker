/**
 * Source-grounded silhouettes for the figures of `son`.
 *
 * These are intentionally physical, short prompts. Retro Diffusion's animation model
 * supplies the pixel-art grammar; repeating the full portrait prompt makes it paint a
 * scene inside every 48px cell. The details below come from `prompts-pixelart.md`,
 * `story.md`, and each figure's SOUL rather than from generic RPG classes.
 */

import type { CharacterDefinition } from "../../../src/shared/content";

const SON_SILHOUETTES: Readonly<Record<string, string>> = {
  kirill:
    "A nearly bald teenage boy with a thin neck, an oversized hoodie and a fresh cheek scrape, cocky shoulders that fold inward under pressure",
  papa: "A middle-aged former sports instructor gone slightly soft, in a tracksuit jacket, carrying a mundane object he is already explaining incorrectly",
  mama: "A decisive woman in her forties, hair pinned back and practical clothes, carrying a coil of barbed wire as casually as a shopping bag",
  "babushka-nadya":
    "An elderly woman in a headscarf with a heavy market bag, her outline subtly doubled as if another woman occupies the same coat",
  "liosha-gnedkov":
    "A friendly young man split by one hard vertical seam, one half warm and alive, the other cold and grave-pale, open relaxed posture",
  nilufar:
    "A young woman with long dark hair in ordinary clothes, walking past without interest, posture slightly elevated and untouchable",
  turyshev:
    "A young man in a worn tracksuit with the permanent slouch of an orange courtyard bench, carrying one plain beer bottle",
  anton:
    "A young man in a faded hoodie with a cheap backpack and hackathon lanyard, face deliberately underdefined except for sharply detailed eyes, always a little late",
  glaz: "One enormous downward-looking eye in a pine-cone moth body, five asymmetric wings made from cyan wireframe, purple moth tissue, cracked olive earth, sand shards and striped carapace",
  ubiitsa:
    "A compact dusk-colored car-shaped figure with a shadowed driver fused into the windshield, only two hands and two headlight eyes fully visible",
  dolzhniki:
    "Three stern ordinary men crowded into one walking silhouette, moving as a single knot, the front man holding a piece of raw meat with complete seriousness",
  "kripto-bro":
    "A young man in expensive-looking cheap streetwear with a cross-body bag and phone, sincere salesman's smile, train-platform posture",
  hudozhnik:
    "A charismatic man with large expressive hands frozen mid-explanation, his open mouth rendered as a rough low-detail gap, no audience around him",
  tetya:
    "An unremarkable middle-aged woman in a plain coat, always turned slightly away and absorbed, edges a little unfinished as if the dream stopped drawing",
  raisa:
    "An elderly preparation-school teacher in a neat cardigan, glasses on a chain and a perfectly squared stack of papers under one arm, attentive not kindly",
  lysyi:
    "A calm bald man of thirty-five in a dark jacket, expensive square watch held conspicuously at his wrist, half-turned as if quietly blocking a stairwell",
  kurt: "A tired friendly blond young man imagined from old magazine covers, oversized striped sweater, seated-at-the-wall slouch even while moving, no guitar",
  "ded-slava":
    "A weathered grandfather in garden clothes and heavy boots, carrying a shovel like an ordinary extension of his hands, alive and busy",
  aleksei:
    "A smooth mid-level webinar salesman in a fitted casual jacket, phone and cheap lanyard, walking fast while gesturing as if interrupting someone",
  shchenok:
    "A small six-month-old mixed-breed puppy on all four paws, unmistakable dog muzzle, floppy ears, short fur and wagging tail, cheerful, quadruped animal only, no human anatomy, no upright pose, no clothing",
};

export function characterSpritePrompt(character: CharacterDefinition): string {
  const subject =
    SON_SILHOUETTES[character.id] ??
    `${character.name}, ${character.role}, ${character.initialActivity}`;
  return [
    subject,
    "full body visible and contained inside every frame",
    "one strong instantly readable silhouette",
    "minimal internal detail",
    "washed bone-cream, deep indigo, violet, teal, olive and dried-blood accents",
    "deadpan fever-dream mismatch, mundane rather than theatrical horror",
    "same identity, clothes and proportions in every direction",
    "no letters, labels, scenery, floor line, weapons or extra characters",
  ].join(", ");
}
