/**
 * Talking to a figure of the dream.
 *
 * A free-text box, because §3 makes the *wording* the whole game: a precise question
 * buys more and costs more cover than a vague one, so the player has to weigh sentences
 * rather than pick from a list. Options would remove the only decision that matters.
 *
 * The panel is thin. It sends what was typed to the `DreamMind` and prints what comes
 * back, including the tell — which is rendered as the figure's own line, not as a
 * warning, because the moment it looks like a UI alert it stops being a conversation.
 */

import { highestPortraitState } from "../../shared/content";
import { clampPortraitByExhaustion } from "../game/exhaustion";
import type { FigureState } from "../game/world";
import type { DreamMind, TurnResponse } from "../mind/types";
import type { DreamArtifact } from "../../shared/dream";
import type { AtlasTextures } from "../render/atlasTextures";
import { setMarkdown } from "./markdown";
import type { ModelThinkingIndicator } from "./modelThinking";
import { npcFor } from "../../../dreams/son/npcs";

export interface DialogueCallbacks {
  onOpen(figure: FigureState): void;
  onClose(): void;
  onTell(figure: FigureState, quoted: string): void;
  /** Fired once, the turn a figure reaches «знает». Not fired again while it holds. */
  onKnows?(figure: FigureState): void;
  onShard(shardId: string): void;
  onMemorySpent(memoryId: string): void;
  onJournal(figure: FigureState, text: string): void;
  /** What the sanitar may hold over this person right now. */
  leverageOn(figureId: string): readonly string[];
  /** Somebody let something slip about somebody else. */
  onLeverage(aboutFigureId: string, leverageId: string): void;
  /** They gave it up, or they shut for good. */
  onPressed(figure: FigureState, outcome: "leveraged" | "broken"): void;
  onResonance(declaration: string): void;
  exhaustion(): number;
}

export class DialoguePanel {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly actionEl: HTMLElement;
  private readonly portraitEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly memoryEl: HTMLSelectElement;
  private readonly leverageEl: HTMLSelectElement;
  private figure: FigureState | null = null;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly mind: DreamMind,
    private readonly thinking: ModelThinkingIndicator,
    private readonly artifact: DreamArtifact,
    private readonly atlas: AtlasTextures,
    private readonly callbacks: DialogueCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "dialogue";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="dialogue-portrait" aria-hidden="true"><div></div></div>
      <div class="dialogue-copy">
        <div class="dialogue-name"></div>
        <div class="dialogue-action" hidden></div>
        <div class="dialogue-log"></div>
        <form class="dialogue-form">
          <input class="dialogue-input" type="text" autocomplete="off" spellcheck="false"
                 placeholder="что ты скажешь" maxlength="240" />
          <select class="dialogue-memory" aria-label="Предложить воспоминание">
            <option value="">не отдавать воспоминание</option>
          </select>
          <select class="dialogue-leverage" aria-label="Назвать то, что знаешь" hidden>
            <option value="">не называть</option>
          </select>
        </form>
        <div class="dialogue-hint">Esc — отойти</div>
      </div>
    `;
    parent.appendChild(this.root);

    this.nameEl = this.root.querySelector(".dialogue-name")!;
    this.actionEl = this.root.querySelector(".dialogue-action")!;
    this.portraitEl = this.root.querySelector(".dialogue-portrait > div")!;
    this.logEl = this.root.querySelector(".dialogue-log")!;
    this.inputEl = this.root.querySelector(".dialogue-input")!;
    this.memoryEl = this.root.querySelector(".dialogue-memory")!;
    this.leverageEl = this.root.querySelector(".dialogue-leverage")!;

    this.root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get isWaiting(): boolean {
    return this.busy;
  }

  get currentFigureId(): string | null {
    return this.figure?.id ?? null;
  }

  private refreshMemories(): void {
    const previous = this.memoryEl.value;
    this.memoryEl.replaceChildren(new Option("не отдавать воспоминание", ""));
    for (const memory of this.mind.availableMemories()) {
      this.memoryEl.add(new Option(`отдать: ${memory.text}`, memory.id));
    }
    this.memoryEl.value = [...this.memoryEl.options].some(
      (option) => option.value === previous,
    )
      ? previous
      : "";
  }

  /**
   * Pressing is not a mode.
   *
   * It is the memory-offer idiom applied to leverage — a second `<select>` in the same
   * form, hidden when there is nothing to name. Free text stays the move (§3), and the
   * verb ring's `press` row is only a shortcut that opens this with the select already
   * on. A mode would have needed its own screen, its own escape and its own rules.
   */
  open(figure: FigureState, preselectLeverage = false): void {
    this.figure = figure;
    this.root.hidden = false;
    this.root.dataset.figure = figure.id;
    this.nameEl.textContent = figure.name;
    this.actionEl.hidden = true;
    const npc = npcFor(figure.id);
    this.inputEl.placeholder = npc.placeholder ?? "что ты скажешь";
    this.memoryEl.hidden = npc.hideMemoryOffer === true;
    this.renderPortrait();
    this.logEl.replaceChildren();
    for (const line of this.mind.conversation(figure.id)) {
      this.line(
        line.text,
        line.speaker === "sanitar" ? "said-by-you" : "said-by-them",
      );
    }
    this.refreshMemories();
    this.refreshLeverage();
    if (figure.id === "glaz") figure.portraitState = "knows";
    if (preselectLeverage && this.leverageEl.options.length > 1) {
      this.leverageEl.selectedIndex = 1;
    }
    this.inputEl.value = "";
    this.inputEl.focus();
    this.callbacks.onOpen(figure);
  }

  private refreshLeverage(): void {
    const figure = this.figure;
    const held = figure ? this.callbacks.leverageOn(figure.id) : [];
    this.leverageEl.replaceChildren(new Option("не называть", ""));
    for (const id of held) {
      this.leverageEl.add(new Option(`назвать: ${labelFor(id)}`, id));
    }
    const npc = this.figure ? npcFor(this.figure.id) : null;
    this.leverageEl.hidden = Boolean(npc?.hideLeverage) || held.length === 0;
  }

  private renderPortrait(): void {
    const figure = this.figure;
    if (!figure) return;
    const character = this.artifact.content.characters.find(
      (candidate) => candidate.id === figure.id,
    );
    const frameName = character?.portraits[figure.portraitState];
    const frame = frameName ? this.atlas.manifest.frames[frameName] : undefined;
    if (!frame) {
      this.portraitEl.removeAttribute("style");
      this.portraitEl.textContent = figure.name.slice(0, 1);
      return;
    }
    const scale = 128 / frame.w;
    this.portraitEl.textContent = "";
    Object.assign(this.portraitEl.style, {
      backgroundImage: `url(${JSON.stringify(this.atlas.imageUrl)})`,
      backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
      backgroundSize: `${this.atlas.sheetWidth * scale}px ${this.atlas.sheetHeight * scale}px`,
    });
  }

  close(): void {
    if (this.root.hidden) return;
    if (this.busy) this.mind.abort();
    this.root.hidden = true;
    this.figure = null;
    this.inputEl.blur();
    this.callbacks.onClose();
  }

  private line(text: string, className: string): HTMLElement {
    const node = document.createElement("p");
    node.className = className;
    setMarkdown(node, text);
    this.logEl.appendChild(node);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return node;
  }

  private async send(): Promise<void> {
    const figure = this.figure;
    const utterance = this.inputEl.value.trim();
    if (!figure || !utterance || this.busy) return;

    this.busy = true;
    this.inputEl.value = "";
    this.inputEl.disabled = true;
    this.memoryEl.disabled = true;
    this.leverageEl.disabled = true;
    const offeredMemoryId = this.memoryEl.value || null;
    const leverageOffered = this.leverageEl.value || null;
    this.line(utterance, "said-by-you");

    // A figure taking a moment to answer is in character, but a panel that looks frozen
    // is not. The placeholder becomes the reply rather than sitting above it, so the
    // wait reads as this person thinking and never as a line they said.
    const pending = this.line("…", "said-by-them pending");

    let response: TurnResponse;
    try {
      response = await this.thinking.run(
        `Продумывает ответ: ${figure.name}`,
        () =>
          this.mind.turn(
            {
              figureId: figure.id,
              utterance,
              offeredMemoryId,
              leverageOffered,
            },
            (partial) => {
              if (this.figure !== figure) return;
              setMarkdown(pending, partial || "…");
            },
          ),
      );
    } catch (error) {
      pending.className = "said-by-them";
      console.error(error);
      this.busy = false;
      this.inputEl.disabled = false;
      this.memoryEl.disabled = false;
      this.leverageEl.disabled = false;
      this.leverageEl.disabled = false;
      this.inputEl.focus();
      return;
    }

    // Walking away mid-answer is a legitimate move, and a model turn is slow enough to
    // make it a common one. Whatever they were going to say is lost, as it should be.
    if (this.figure !== figure) {
      this.busy = false;
      this.inputEl.disabled = false;
      this.memoryEl.disabled = false;
      this.leverageEl.disabled = false;
      this.leverageEl.disabled = false;
      return;
    }

    setMarkdown(pending, response.reply);
    pending.className = "said-by-them";
    if (response.action) {
      this.actionEl.hidden = false;
      this.actionEl.textContent = response.action;
    }
    // «Уровень 3 не откатывается» — suspicion is a ratchet, so a figure that has worked
    // it out cannot be talked back down into being merely curious. The Eye is the one
    // exception: its scale is «сколько правды санитар сказал», not suspicion at all.
    const before = figure.portraitState;
    const character = this.artifact.content.characters.find(
      (candidate) => candidate.id === figure.id,
    );
    const npc = npcFor(figure.id);
    const raised =
      character?.suspicionMonotone === false || npc.skipExhaustionClamp
        ? response.portraitState
        : highestPortraitState(before, response.portraitState);
    figure.portraitState = npc.skipExhaustionClamp
      ? raised
      : clampPortraitByExhaustion(this.callbacks.exhaustion(), raised, before);
    this.renderPortrait();

    // The rung that matters. Announced once, on the way up, so the picture can agree
    // with the face — «портрет "знает" — самый важный ассет в игре».
    if (before !== "knows" && figure.portraitState === "knows") {
      this.callbacks.onKnows?.(figure);
    }

    // A tell is already woven into the reply. Keeping it as metadata makes the cause
    // journalable without producing the unexplained yellow second sentence the old UI did.
    if (response.tell) {
      this.callbacks.onTell(figure, response.tell.quoted);
    }

    // «Третий уровень сам по себе не убивает. Убивает то, что ты продолжил давить на
    // фигуру, которая уже смотрит молча.» Resonance needs the дожим: the figure has to
    // have *already* known before this turn, and this turn has to have handed it one
    // more piece. Without that gate any single turn could end the run.
    const dozhim =
      before === "knows" &&
      figure.portraitState === "knows" &&
      (!!response.tell || !!leverageOffered);
    if (response.resonance && !dozhim) {
      response = { ...response, resonance: null };
    }

    if (response.yieldedShardId)
      this.callbacks.onShard(response.yieldedShardId);

    if (response.leverageLearned) {
      this.callbacks.onLeverage(
        response.leverageLearned.aboutFigureId,
        response.leverageLearned.leverageId,
      );
    }
    if (response.pressed) this.callbacks.onPressed(figure, response.pressed);

    if (response.journalEntry)
      this.callbacks.onJournal(figure, response.journalEntry);
    if (
      offeredMemoryId &&
      !this.mind
        .availableMemories()
        .some((memory) => memory.id === offeredMemoryId)
    ) {
      this.callbacks.onMemorySpent(offeredMemoryId);
    }

    if (response.resonance) {
      this.callbacks.onResonance(response.resonance.declaration);
    }

    this.busy = false;
    this.inputEl.disabled = false;
    this.memoryEl.disabled = false;
    this.leverageEl.disabled = false;
    this.refreshMemories();
    this.inputEl.focus();
  }

  destroy(): void {
    this.root.remove();
  }
}

/** The key is opaque on purpose; the readable half lives in the soul, server-side. */
function labelFor(leverageId: string): string {
  return leverageId.split(":")[1]?.replace(/-/g, " ") ?? leverageId;
}
