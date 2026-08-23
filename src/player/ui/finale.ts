import type { DreamArtifact } from "../../shared/dream";
import { t } from "../../shared/i18n";
import type { WordNotebook } from "../game/wordNotebook";
import type { DreamMind } from "../mind/types";
import { setMarkdown } from "./markdown";
import type { ModelThinkingIndicator } from "./modelThinking";

/**
 * The six outcomes of `endings.md`.
 *
 * Two of them are the ones that make the game a risk rather than a crossword: `empty` is
 * a correct phrase over a wallet that never had anything in it, and `walk-away` is
 * leaving with five words while the wallet was full — and the game never tells you which
 * it was, «даже в статистике».
 */
export type EndingKind =
  | "match"
  | "empty"
  | "unfinished"
  | "resonance"
  | "void"
  | "walk-away"
  | "locked";

export interface FinaleCallbacks {
  onOpen(): void;
  onClose(): void;
  onEnded(kind: EndingKind): void;
  /**
   * What the sanitar spent to get here, one flat line each.
   *
   * `endings.md` asks for it in as many words on both «Взял» and «Пусто», and the two
   * screens are the same correct phrase in two different worlds — so the list is the
   * part that is identical, and the number is the part that is not.
   */
  whatWasPaid?(): string[];
}

export class FinalePanel {
  private readonly root: HTMLElement;
  private readonly systemLabelEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly instructionsEl: HTMLElement;
  private readonly form: HTMLElement;
  private readonly inputs: HTMLInputElement[] = [];
  private readonly reply: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly leaveBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private busy = false;
  private ended = false;
  private kind: EndingKind | null = null;

  constructor(
    parent: HTMLElement,
    private readonly mind: DreamMind,
    private readonly thinking: ModelThinkingIndicator,
    private readonly artifact: DreamArtifact,
    private readonly notebook: WordNotebook,
    private readonly callbacks: FinaleCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel finale";
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="system-label finale-system-label"></span>
      <h2 class="finale-title"></h2>
      <p class="finale-instructions"></p>
      <div class="mnemonic-slots"></div>
      <p class="finale-reply"></p>
      <div class="row">
        <button class="finale-submit" type="button"></button>
        <button class="finale-leave ghost" type="button"></button>
        <button class="finale-close ghost" type="button"></button>
      </div>
    `;
    parent.appendChild(this.root);
    this.systemLabelEl = this.root.querySelector(".finale-system-label")!;
    this.titleEl = this.root.querySelector(".finale-title")!;
    this.instructionsEl = this.root.querySelector(".finale-instructions")!;
    this.form = this.root.querySelector(".mnemonic-slots")!;
    this.reply = this.root.querySelector(".finale-reply")!;
    this.submit = this.root.querySelector(".finale-submit")!;
    this.leaveBtn = this.root.querySelector(".finale-leave")!;
    this.closeBtn = this.root.querySelector(".finale-close")!;

    const suggestions = document.createElement("datalist");
    suggestions.id = "notebook-word-suggestions";
    this.root.appendChild(suggestions);
    artifact.content.mnemonic.knownSlots.forEach((word, index) => {
      const slot = document.createElement("label");
      slot.className = `mnemonic-slot ${word ? "known" : "hidden"}`;
      slot.innerHTML = `<span>${index + 1}</span>`;
      if (word) {
        const fixed = document.createElement("strong");
        fixed.textContent = word;
        slot.appendChild(fixed);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.maxLength = 24;
        input.setAttribute("list", suggestions.id);
        slot.appendChild(input);
        this.inputs.push(input);
      }
      this.form.appendChild(slot);
    });

    this.submit.addEventListener("click", () => void this.judge());
    this.leaveBtn.addEventListener("click", () => {
      this.showEnding(t("finale.door_other_side"), "walk-away");
    });
    this.closeBtn.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get isWaiting(): boolean {
    return this.busy;
  }

  /** «Пустота» — no way back except closing the tab. */
  get isTrapped(): boolean {
    return this.ended && this.kind === "void";
  }

  open(): void {
    this.systemLabelEl.textContent = t("ui.system_label_heart");
    this.titleEl.textContent = t("finale.title");
    this.instructionsEl.textContent = t("finale.instructions");
    this.submit.textContent = t("finale.submit");
    this.leaveBtn.textContent = t("finale.leave");
    this.closeBtn.textContent = t("ui.back");

    this.ended = false;
    this.reply.textContent = "";
    this.form.hidden = false;
    this.submit.hidden = false;
    const suggestions = this.root.querySelector("datalist")!;
    suggestions.replaceChildren(
      ...this.notebook.words
        .filter(Boolean)
        .map((word) =>
          Object.assign(document.createElement("option"), { value: word }),
        ),
    );
    this.inputs.forEach((input, index) => {
      input.disabled = false;
      input.value = this.notebook.words[index] ?? "";
    });
    this.root.hidden = false;
    this.inputs[0]?.focus();
    this.callbacks.onOpen();
  }

  openResonance(declaration: string): void {
    this.root.hidden = false;
    this.form.hidden = true;
    this.submit.hidden = true;
    this.showEnding(t("finale.resonance", { declaration }), "resonance");
    this.callbacks.onOpen();
  }

  private fullPhrase(): string[] {
    let hiddenIndex = 0;
    return this.artifact.content.mnemonic.knownSlots.map(
      (known) =>
        known ?? this.inputs[hiddenIndex++]!.value.trim().toLowerCase(),
    );
  }

  private async judge(): Promise<void> {
    if (this.busy || this.inputs.some((input) => !input.value.trim())) return;
    this.busy = true;
    this.submit.disabled = true;
    this.inputs.forEach((input) => (input.disabled = true));
    this.reply.textContent = t("finale.checking");
    try {
      const result = await this.thinking.run(t("ui.thinking_mnemonic"), () =>
        this.mind.judge(this.fullPhrase()),
      );
      if (result.verdict === "match") {
        const paid = this.callbacks.whatWasPaid?.() ?? [];
        const ledger = paid.length > 0 ? `\n\n${paid.join("\n")}` : "";
        if (result.locked) {
          this.showEnding(
            t("finale.locked_ending", { reply: result.reply }),
            "locked",
          );
          return;
        }
        const dry = result.wallet === "dry";
        const amount = dry ? "0.00000000" : (result.amount ?? "");
        if (dry) {
          this.reply.textContent = `${result.reply}\n\n${amount}`;
          this.reply.style.whiteSpace = "pre-line";
          await new Promise((resolve) => setTimeout(resolve, 2400));
        }
        this.showEnding(
          dry
            ? `${result.reply}\n\n${amount}${ledger}`
            : `${result.reply}${amount ? `\n\n${amount}` : ""}${ledger}`,
          dry ? "empty" : "match",
        );
        return;
      }
      setMarkdown(this.reply, result.reply);
    } catch (error) {
      this.reply.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.submit.disabled = false;
      this.inputs.forEach((input) => (input.disabled = false));
    }
  }

  /**
   * «Не сложилось» — the cycles ran out with the phrase incomplete.
   *
   * The gaps stay where they are: `WordNotebook` persists per slug, so the next run
   * opens on the same column with the same holes in it.
   */
  openFailed(words: readonly (string | null)[]): void {
    this.open();
    const column = words
      .map((word, index) => `${String(index + 1).padStart(2)}. ${word ?? "—"}`)
      .join("\n");
    this.showEnding(t("finale.failed_heading", { column }), "unfinished");
  }

  /** «Пустота» — every memory spent. The one screen with no way back to a menu. */
  openVoid(): void {
    this.open();
    this.showEnding(t("finale.void_ending"), "void");
  }

  private showEnding(text: string, kind: EndingKind): void {
    this.ended = true;
    this.kind = kind;
    setMarkdown(this.reply, text);
    this.reply.style.whiteSpace = "pre-line";
    this.form.hidden = true;
    this.submit.hidden = true;
    const leave = this.root.querySelector<HTMLButtonElement>(".finale-leave");
    const close = this.root.querySelector<HTMLButtonElement>(".finale-close");
    if (leave) leave.hidden = kind === "void";
    if (close) close.hidden = kind === "void";
    this.callbacks.onEnded(kind);
  }

  close(): void {
    if (this.root.hidden || this.ended) return;
    if (this.busy) this.mind.abort();
    this.root.hidden = true;
    this.callbacks.onClose();
  }
}
