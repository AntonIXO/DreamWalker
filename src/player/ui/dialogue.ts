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
 *
 * A microphone fills the same box. Edge's (and Chromium's) speech-to-text lands as a
 * draft the player can still edit — voice is a way to speak, not a second channel that
 * bypasses wording.
 */

import { highestPortraitState } from "../../shared/content";
import { getLocale, t } from "../../shared/i18n";
import { clampPortraitByExhaustion } from "../game/exhaustion";
import { bandAt, coverForPortrait, weatherFor } from "../game/forecast";
import type { FigureState } from "../game/world";
import type { DreamMind, TurnResponse } from "../mind/types";
import type { WorldAction } from "../../shared/world-action";
import type { DreamArtifact } from "../../shared/dream";
import type { AtlasTextures } from "../render/atlasTextures";
import { setMarkdown } from "./markdown";
import type { ModelThinkingIndicator } from "./modelThinking";
import { npcFor } from "../../../dreams/son/npcs";
import {
  loadVoicePref,
  saveVoicePref,
  VoiceInput,
  type VoiceStatus,
} from "./speech";

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
  /**
   * Confirmed physical actions from this turn. `action` on the result is gesture
   * only. Return whether the speaker left the player's room.
   */
  onWorldActions?(
    figure: FigureState,
    actions: readonly WorldAction[],
  ): {
    close: boolean;
  };
}

export class DialoguePanel {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly skyEl: HTMLElement;
  private readonly actionEl: HTMLElement;
  private readonly portraitEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly memoryEl: HTMLSelectElement;
  private readonly leverageEl: HTMLSelectElement;
  private readonly micEl: HTMLButtonElement;
  private readonly hintEl: HTMLElement;
  private readonly voice: VoiceInput;
  private figure: FigureState | null = null;
  private busy = false;
  private voiceMode = false;
  private applyingCaption = false;
  private idlePlaceholder = "что ты скажешь";

  constructor(
    parent: HTMLElement,
    private readonly mind: DreamMind,
    private readonly thinking: ModelThinkingIndicator,
    private readonly artifact: DreamArtifact,
    private readonly atlas: AtlasTextures,
    private readonly callbacks: DialogueCallbacks,
    private readonly portraitUrls: ReadonlyMap<string, string> = new Map(),
  ) {
    this.root = document.createElement("div");
    this.root.className = "dialogue";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="dialogue-portrait" aria-hidden="true"><div></div></div>
      <div class="dialogue-copy">
        <div class="dialogue-name"></div>
        <div class="dialogue-sky" hidden></div>
        <div class="dialogue-action" hidden></div>
        <div class="dialogue-log"></div>
        <form class="dialogue-form">
          <div class="dialogue-compose">
            <input class="dialogue-input" type="text" autocomplete="off" spellcheck="false"
                   placeholder="что ты скажешь" maxlength="240" />
            <button class="dialogue-mic" type="button" hidden
                    aria-label="Говорить" aria-pressed="false" title="Говорить">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor"
                      d="M8 1.75c1.24 0 2.25 1.01 2.25 2.25v4a2.25 2.25 0 1 1-4.5 0v-4c0-1.24 1.01-2.25 2.25-2.25z"/>
                <path fill="none" stroke="currentColor" stroke-width="1.25"
                      d="M3.75 7.25a4.25 4.25 0 0 0 8.5 0M8 11.5V14.25M5.5 14.25h5"/>
              </svg>
            </button>
          </div>
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
    this.skyEl = this.root.querySelector(".dialogue-sky")!;
    this.actionEl = this.root.querySelector(".dialogue-action")!;
    this.portraitEl = this.root.querySelector(".dialogue-portrait > div")!;
    this.logEl = this.root.querySelector(".dialogue-log")!;
    this.inputEl = this.root.querySelector(".dialogue-input")!;
    this.memoryEl = this.root.querySelector(".dialogue-memory")!;
    this.leverageEl = this.root.querySelector(".dialogue-leverage")!;
    this.micEl = this.root.querySelector(".dialogue-mic")!;
    this.hintEl = this.root.querySelector(".dialogue-hint")!;
    this.voice = new VoiceInput({
      onCaption: (text) => this.applyCaption(text),
      onUtterance: (text) => {
        if (!this.isOpen || this.busy) return;
        this.applyCaption(text);
        void this.send();
      },
      onStatus: (status) => this.refreshVoiceChrome(status),
    });

    this.root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.inputEl.addEventListener("input", () => {
      if (this.applyingCaption) return;
      this.voice.noteTyped(this.inputEl.value);
    });
    this.micEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.micEl.addEventListener("click", () => this.toggleVoice());
    window.addEventListener("keydown", this.onVoiceKey);

    if (this.voice.supported) {
      this.micEl.hidden = false;
      this.voiceMode = loadVoicePref();
    }
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
    this.memoryEl.replaceChildren(new Option(t("dialogue.keep_memory"), ""));
    for (const memory of this.mind.availableMemories()) {
      this.memoryEl.add(
        new Option(
          t("dialogue.offer_memory_prefix", { text: memory.text }),
          memory.id,
        ),
      );
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
    this.idlePlaceholder = npc.placeholder ?? t("dialogue.placeholder");
    this.inputEl.placeholder = this.idlePlaceholder;
    this.memoryEl.hidden = npc.hideMemoryOffer === true;
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
    this.paintFace();
    if (preselectLeverage && this.leverageEl.options.length > 1) {
      this.leverageEl.selectedIndex = 1;
    }
    this.clearDraft();
    this.inputEl.focus();
    this.refreshVoiceChrome(this.voice.currentStatus);
    this.syncVoice();
    this.callbacks.onOpen(figure);
  }

  /** Empty the box without closing. Leftover typing next to «Ну ладно.» reads as a bug. */
  clearDraft(): void {
    this.inputEl.value = "";
  }

  private refreshLeverage(): void {
    const figure = this.figure;
    const held = figure ? this.callbacks.leverageOn(figure.id) : [];
    this.leverageEl.replaceChildren(new Option(t("dialogue.keep_secret"), ""));
    const namePrefix = getLocale() === "ru" ? "назвать: " : "name: ";
    for (const id of held) {
      this.leverageEl.add(new Option(`${namePrefix}${labelFor(id)}`, id));
    }
    const npc = this.figure ? npcFor(this.figure.id) : null;
    this.leverageEl.hidden = Boolean(npc?.hideLeverage) || held.length === 0;
  }

  private paintFace(): void {
    const figure = this.figure;
    if (!figure) {
      delete this.root.dataset.face;
      this.skyEl.hidden = true;
      this.skyEl.textContent = "";
      return;
    }
    this.root.dataset.face = figure.portraitState;
    const sky = weatherFor(figure.portraitState);
    this.skyEl.hidden = !sky;
    this.skyEl.textContent = sky ?? "";
    this.skyEl.dataset.sky = bandAt(coverForPortrait(figure.portraitState)).id;
    this.renderPortrait();
  }

  private renderPortrait(): void {
    const figure = this.figure;
    if (!figure) return;
    const authored = this.portraitUrls.get(figure.id);
    if (authored) {
      this.portraitEl.textContent = "";
      Object.assign(this.portraitEl.style, {
        backgroundImage: `url(${JSON.stringify(authored)})`,
        backgroundPosition: "center",
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
      });
      return;
    }
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
    this.voice.halt();
    this.root.hidden = true;
    this.figure = null;
    this.paintFace();
    this.inputEl.blur();
    this.refreshVoiceChrome("idle");
    this.callbacks.onClose();
  }

  /**
   * Esc peels the microphone first. Closing the conversation is a second press,
   * same as every other nested panel: one layer at a time.
   */
  cancelListening(): boolean {
    if (!this.voice.active) return false;
    this.voice.halt();
    this.refreshVoiceChrome(this.voice.currentStatus);
    return true;
  }

  private line(text: string, className: string): HTMLElement {
    const node = document.createElement("p");
    node.className = className;
    setMarkdown(node, text);
    this.logEl.appendChild(node);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return node;
  }

  private applyCaption(text: string): void {
    this.applyingCaption = true;
    this.inputEl.value = text;
    this.inputEl.setSelectionRange(text.length, text.length);
    this.applyingCaption = false;
  }

  /**
   * Space is the mic. It has to work even if the box is not focused — a player who
   * just walked up and pressed E should be able to talk without clicking anything.
   * An already-typed line still gets a real space, so correcting a misheard word
   * does not start the recognizer.
   */
  private readonly onVoiceKey = (event: KeyboardEvent): void => {
    if (!this.isOpen || !this.voice.supported) return;
    if (event.code !== "Space" || event.altKey || event.metaKey) return;
    if (event.isComposing) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "SELECT") return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    const steal =
      this.voice.active ||
      this.voiceMode ||
      this.inputEl.value.trim() === "" ||
      target === this.micEl;
    if (!steal) return;
    event.preventDefault();
    this.toggleVoice();
  };

  private toggleVoice(): void {
    if (!this.voice.supported) return;
    if (!this.voiceMode) {
      this.voiceMode = true;
      saveVoicePref(true);
      this.syncVoice();
      this.refreshVoiceChrome(this.voice.currentStatus);
      return;
    }
    if (this.voice.active) {
      this.voiceMode = false;
      saveVoicePref(false);
      this.voice.halt();
      this.refreshVoiceChrome(this.voice.currentStatus);
      return;
    }
    this.syncVoice();
    this.refreshVoiceChrome(this.voice.currentStatus);
  }

  private syncVoice(): void {
    const shouldListen =
      this.voiceMode && this.isOpen && !this.busy && this.figure !== null;
    if (shouldListen) this.voice.listen(this.inputEl.value);
    else this.voice.halt();
  }

  private refreshVoiceChrome(status: VoiceStatus): void {
    const listening = status === "listening" || status === "hearing";
    if (this.voiceMode && listening) {
      this.root.dataset.voice = status;
    } else if (this.voiceMode) {
      this.root.dataset.voice = "on";
    } else {
      this.root.dataset.voice = "off";
    }
    const isRu = getLocale() === "ru";
    const muteLabel = isRu ? "Замолчать" : "Mute";
    const speakLabel = t("dialogue.mic_label");
    this.micEl.setAttribute("aria-pressed", this.voiceMode ? "true" : "false");
    this.micEl.setAttribute("aria-label", listening ? muteLabel : speakLabel);
    this.micEl.title = listening
      ? `${muteLabel} (${isRu ? "Пробел" : "Space"})`
      : `${speakLabel} (${isRu ? "Пробел" : "Space"})`;
    this.inputEl.placeholder = listening
      ? isRu
        ? "говори"
        : "speak"
      : this.idlePlaceholder;
    this.hintEl.textContent = voiceHint(
      status,
      this.voiceMode,
      this.voice.supported,
    );
  }

  private setFormEnabled(enabled: boolean): void {
    this.inputEl.disabled = !enabled;
    this.memoryEl.disabled = !enabled;
    this.leverageEl.disabled = !enabled;
  }

  private finishTurn(): void {
    this.busy = false;
    this.setFormEnabled(true);
    this.refreshMemories();
    this.syncVoice();
    this.inputEl.focus();
  }

  private async send(): Promise<void> {
    const figure = this.figure;
    const utterance = this.inputEl.value.trim();
    if (!figure || !utterance || this.busy) return;

    this.voice.halt();
    this.busy = true;
    this.inputEl.value = "";
    this.setFormEnabled(false);
    this.refreshVoiceChrome(this.voice.currentStatus);
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
      // A missing model is silence, not a canned line in this person's mouth.
      pending.remove();
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      if (!aborted) console.error(error);
      this.finishTurn();
      return;
    }

    // Walking away mid-answer is a legitimate move, and a model turn is slow enough to
    // make it a common one. Whatever they were going to say is lost, as it should be.
    if (this.figure !== figure) {
      this.busy = false;
      this.setFormEnabled(true);
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
    this.paintFace();

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

    const worldActions = worldActionsOf(response);
    const leftRoom =
      worldActions.length > 0 &&
      !!this.callbacks.onWorldActions?.(figure, worldActions)?.close;

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

    this.finishTurn();
    if (leftRoom) this.close();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onVoiceKey);
    this.voice.destroy();
    this.root.remove();
  }
}

function voiceHint(
  status: VoiceStatus,
  voiceMode: boolean,
  supported: boolean,
): string {
  const isRu = getLocale() === "ru";
  if (!supported) return isRu ? "Esc — отойти" : "Esc — step back";
  if (status === "blocked")
    return isRu
      ? "микрофон закрыт в браузере"
      : "microphone blocked in browser";
  if (status === "failed")
    return isRu
      ? "не расслышал — Пробел ещё раз"
      : "could not hear — Space again";
  if (status === "hearing")
    return isRu ? "слышу… пауза отправит" : "listening… pause will send";
  if (status === "listening")
    return isRu ? "говори · Пробел — замолчать" : "speak · Space to mute";
  if (voiceMode)
    return isRu
      ? "Пробел — говорить · Esc — отойти"
      : "Space — speak · Esc — step back";
  return isRu
    ? "Esc — отойти · Пробел — говорить"
    : "Esc — step back · Space — speak";
}

/** The key is opaque on purpose; the readable half lives in the soul, server-side. */
function labelFor(leverageId: string): string {
  return leverageId.split(":")[1]?.replace(/-/g, " ") ?? leverageId;
}

function worldActionsOf(response: TurnResponse): WorldAction[] {
  const extra = response as TurnResponse & { worldActions?: WorldAction[] };
  return Array.isArray(extra.worldActions) ? extra.worldActions : [];
}
