/** `lord content <slug>` — create/sync the files a writer and artist edit by hand. */

import { scaffoldContent } from "../content/files";
import { loadDraft, saveDraft } from "../project";
import { heading, note, ok } from "../term/prompt";
import type { Flags } from "../cli";

export async function contentCommand(
  slug: string | undefined,
  _flags: Flags,
): Promise<void> {
  void _flags;
  if (!slug) throw new Error("usage: lord content <slug>");
  const draft = await loadDraft(slug);
  if (!draft.map)
    throw new Error(
      `"${slug}" has no layout yet — run \`lord layout ${slug}\``,
    );
  if (draft.figures.length === 0) {
    throw new Error(
      `"${slug}" has no figures yet — run \`lord figures ${slug}\` first`,
    );
  }

  heading(`Content — ${draft.title}`);
  draft.content = await scaffoldContent(draft);
  await saveDraft(draft);

  ok(`${draft.content.chambers.length} room cards`);
  ok(`${draft.content.characters.length} character cards`);
  ok(`${draft.content.clues.length} clue cards`);
  note(`Edit dreams/${slug}/content/**/*.json, then run this command again.`);
  note(`Next: bun run lord mnemonic ${slug}`);
}
