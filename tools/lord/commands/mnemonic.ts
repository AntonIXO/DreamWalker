/** Create the dummy 12-word flag and publish only six known positions plus its hash. */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateMnemonic, validateMnemonic, wordlists } from "bip39";

import { dreamDir, loadDraft, saveDraft, saveSecret } from "../project";
import { heading, note, ok } from "../term/prompt";
import type { Flags } from "../cli";

// A white-list, not an abstract-word blacklist. A word is suitable only when an artist
// can draw one unambiguous object for it; adjectives and actions otherwise turn six
// clues into six attractive but useless rocks.
const CONCRETE_WORDS = new Set(
  `
anchor animal ankle antenna apple arch armor arrow avocado baby bacon badge bag balcony ball bamboo banana banner barrel basket beach bean beef belt bench bicycle bird blade blanket blossom blouse board boat bomb bone book boy bracket brain bread brick broccoli broom brother bubble buffalo bulb bullet bunker burger bus butter cabbage cabin cable cactus cage cake camera canal candy cannon canoe canvas canyon car card carpet cart castle cat cattle cave celery chair chalk cheese chef cherry chest chicken child chimney cigar cinnamon circle claw cliff clock clog cloth cloud clown club coconut coffee coil coin column comic copper coral corn cotton couch coyote cradle crane crater cricket cross crystal cube cup curtain cushion dad deer dentist desert desk diamond diary dice dinosaur dirt dish doctor dog doll dolphin donkey door dove dragon dress drill drink drum duck dune dust dwarf eagle earth egg elbow elephant elevator envelope eye fabric face family fan farm father fence field figure finger fire fish flag flame flower foil food foot forest fork fossil fox frame friend frog fruit furnace gadget galaxy gallery game garage garden garlic garment gate guitar gun hair hammer hamster hand harbor hat hawk head heart hedgehog helmet hen hill hip honey hood horn horse hospital hotel hub ice icon insect iron island ivory jacket jaguar jar jeans jelly jewel juice jungle kangaroo ketchup key kidney kitchen kite kitten kiwi knee knife label ladder lake lamp laptop lawn leaf lemon leopard letter lion lizard lobster lock luggage lumber machine magnet maid mail mammal man mango mansion maple marble mask meat medal menu mesh metal milk mirror mobile model monkey monster moon mosquito mother motor mountain mouse muffin mule muscle mushroom napkin neck nephew nest net noodle nose nurse nut oak ocean oil olive onion orange orchard organ orphan ostrich oven oyster paddle page palace palm panda panther paper parrot peanut pear pelican pen pencil pepper pet phone piano picnic pig pigeon pill pilot pipe pistol pizza planet plastic plate pony pool potato pottery powder pumpkin puppy pyramid rabbit raccoon rack radar radio rail rain raven razor rice ribbon rifle ring river robot rocket roof rose rubber rug sail salad salmon salt sauce sausage school scissors scorpion screen sea seat seed shadow shaft shed shell shield ship shoe shoulder shrimp sibling silk silver sister skate skin skirt skull slab snake snow soap sock soda soldier soup sphere spice spider spoon squirrel stadium staff stairs stamp steak steel stem stereo stick stomach stone stool stove subway sun sword table tag tail tank tape tattoo taxi tent tiger timber tissue toast tobacco toe toilet tomato tongue tool tooth torch tornado tortoise tower town toy track train trap trash tray tree trophy truck trumpet tube tuna tunnel turkey turtle umbrella uncle uniform valley valve van vehicle violin village volcano wagon wall walnut warrior wasp water weapon weasel whale wheat wheel wife window wine wing wire wolf woman wood wool yard zebra zoo
`
    .trim()
    .split(/\s+/),
);

function visualEnough(word: string): boolean {
  return CONCRETE_WORDS.has(word);
}

function digest(value: string): string {
  return createHash("sha256").update(value.normalize("NFKD")).digest("hex");
}

export async function mnemonicCommand(
  slug: string | undefined,
  _flags: Flags,
): Promise<void> {
  void _flags;
  if (!slug) throw new Error("usage: lord mnemonic <slug>");
  const draft = await loadDraft(slug);
  if (draft.content.clues.length !== 6) {
    throw new Error(
      "create exactly six clue cards before sealing the mnemonic",
    );
  }

  heading(`Mnemonic — ${draft.title}`);
  let mnemonic = "";
  let words: string[] = [];
  let visualPositions: number[] = [];
  for (let attempt = 0; attempt < 10_000; attempt++) {
    mnemonic = generateMnemonic(128, undefined, wordlists.english);
    words = mnemonic.split(" ");
    visualPositions = words
      .map((word, index) => (visualEnough(word) ? index : -1))
      .filter((index) => index >= 0);
    if (visualPositions.length >= 6) break;
  }
  if (!validateMnemonic(mnemonic, wordlists.english)) {
    throw new Error("generated mnemonic did not pass its BIP39 checksum");
  }
  if (visualPositions.length < 6) {
    throw new Error("could not find a phrase with six visual words");
  }

  // Spread the hidden words through the phrase instead of taking a visible block.
  const hidden = visualPositions
    .sort((a, b) => {
      const centreA = Math.abs(a - 5.5);
      const centreB = Math.abs(b - 5.5);
      return centreB - centreA || a - b;
    })
    .slice(0, 6)
    .sort((a, b) => a - b);
  const hiddenSet = new Set(hidden);
  const hash = digest(mnemonic);
  draft.secretHash = hash;
  draft.content.mnemonic = {
    hash,
    wordlist: "english",
    knownSlots: words.map((word, index) =>
      hiddenSet.has(index) ? null : word,
    ),
  };
  await Promise.all([
    saveSecret(slug, mnemonic),
    writeFile(
      join(dreamDir(slug), "mnemonic.local.json"),
      `${JSON.stringify(
        {
          format: 1,
          warning: "Dummy game mnemonic. Never fund or reuse it.",
          mnemonic,
          hiddenPositions: hidden,
          clues: hidden.map((position, index) => ({
            clueId: draft.content.clues[index]!.id,
            position,
            word: words[position],
            visualPrompt: "",
            retroDiffusion: null,
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    saveDraft(draft),
  ]);

  ok("valid 12-word English BIP39 phrase sealed");
  ok("six known slots published; six clue mappings stay local");
  note(
    "The phrase is a game flag. Do not use it for a wallet or put funds on it.",
  );
  note(`Next: bun run lord clues ${slug} --check-cost`);
}
