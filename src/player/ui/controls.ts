/**
 * What the keys do.
 *
 * A game with a free-text box has to say this out loud. Every other top-down game can
 * assume WASD and be right; this one takes the keyboard away mid-sentence and gives it
 * back, so the player needs somewhere to check what `E` was for without leaving the dream.
 *
 * Labels come from `keyFor`, which reads the real binding table in `game/input.ts`. A
 * rebinding therefore updates this panel rather than making it lie, and renaming an action
 * breaks the build here instead of at play time.
 */

import { Action, keyFor, type ActionName } from "../game/input";
import {
  getLocale,
  onLocaleChange,
  setLocale,
  t,
  type SupportedLocale,
} from "../../shared/i18n";

interface Row {
  key: string;
  what: string;
}

const bound = (action: ActionName, whatKey: string): Row => ({
  key: keyFor(action),
  what: t(whatKey as Parameters<typeof t>[0]),
});

function getPlayingRows(): Row[] {
  return [
    { key: "WASD · ←↑↓→", what: t("controls.key_walk") },
    bound(Action.INTERACT, "controls.key_interact"),
    bound(Action.CANCEL, "controls.key_cancel"),
    bound(Action.MEMORIES, "controls.key_memories"),
    bound(Action.VERBS, "controls.key_verbs"),
    bound(Action.JOURNAL, "controls.key_journal"),
    bound(Action.WORDS, "controls.key_words"),
    bound(Action.HELP, "controls.key_help"),
  ];
}

function getDebugRows(): Row[] {
  return [
    bound(Action.DEBUG, "controls.key_debug"),
    bound(Action.HEARTBEAT, "controls.key_heartbeat"),
    bound(Action.GRANT, "controls.key_grant"),
  ];
}

function getTalkingNotes(): string[] {
  return [
    t("controls.note_1"),
    t("controls.note_2"),
    t("controls.note_3"),
    t("controls.note_4"),
  ];
}

function rowsHtml(list: readonly Row[]): string {
  return list
    .map(
      (row) =>
        `<div class="keys-row"><kbd>${row.key}</kbd><span>${row.what}</span></div>`,
    )
    .join("");
}

export interface ControlsCallbacks {
  /** Fired when the panel closes, so whatever opened it can come back. */
  onClose(): void;
  /** Soundtrack mute, if the beds loaded. */
  music?: {
    enabled(): boolean;
    toggle(): boolean;
  };
}

export class ControlsPanel {
  private readonly root: HTMLElement;
  private readonly musicEl: HTMLButtonElement | null;
  private readonly langEl: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly playingKeysEl: HTMLElement;
  private readonly talkingTitleEl: HTMLElement;
  private readonly talkingNotesEl: HTMLElement;
  private readonly debugTitleEl: HTMLElement;
  private readonly debugKeysEl: HTMLElement;
  private readonly closeEl: HTMLButtonElement;
  private unsubscribeLocale: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: ControlsCallbacks = { onClose: () => {} },
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel controls";
    this.root.hidden = true;
    this.root.innerHTML = `
      <h2 class="controls-title"></h2>
      <div class="keys controls-playing"></div>
      <h3 class="controls-talking-title"></h3>
      <ul class="notes controls-talking-notes"></ul>
      <h3 class="controls-debug-title"></h3>
      <div class="keys dim controls-debug"></div>
      <div class="row">
        <button class="controls-lang ghost" type="button"></button>
        ${this.callbacks.music ? `<button class="controls-music ghost" type="button"></button>` : ""}
        <button class="controls-close ghost end" type="button"></button>
      </div>
    `;
    parent.appendChild(this.root);

    this.titleEl = this.root.querySelector(".controls-title")!;
    this.playingKeysEl = this.root.querySelector(".controls-playing")!;
    this.talkingTitleEl = this.root.querySelector(".controls-talking-title")!;
    this.talkingNotesEl = this.root.querySelector(".controls-talking-notes")!;
    this.debugTitleEl = this.root.querySelector(".controls-debug-title")!;
    this.debugKeysEl = this.root.querySelector(".controls-debug")!;
    this.musicEl = this.root.querySelector(".controls-music");
    this.langEl = this.root.querySelector(".controls-lang")!;
    this.closeEl = this.root.querySelector(".controls-close")!;

    this.musicEl?.addEventListener("click", () => {
      this.callbacks.music?.toggle();
      this.syncMusic();
    });
    this.langEl.addEventListener("click", () => {
      const nextLocale: SupportedLocale = getLocale() === "ru" ? "en" : "ru";
      setLocale(nextLocale);
    });
    this.closeEl.addEventListener("click", () => this.close());

    this.render();
    this.unsubscribeLocale = onLocaleChange(() => this.render());
  }

  private render(): void {
    this.titleEl.textContent = t("controls.title");
    this.playingKeysEl.innerHTML = rowsHtml(getPlayingRows());
    this.talkingTitleEl.textContent = t("controls.section_talking");
    this.talkingNotesEl.innerHTML = getTalkingNotes()
      .map((line) => `<li>${line}</li>`)
      .join("");
    this.debugTitleEl.textContent = t("controls.section_debug");
    this.debugKeysEl.innerHTML = rowsHtml(getDebugRows());
    this.closeEl.textContent = t("ui.step_back");

    const locale = getLocale();
    this.langEl.textContent = `${t("ui.language")}: ${locale.toUpperCase()}`;

    this.syncMusic();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.render();
    this.root.hidden = false;
  }

  syncMusic(): void {
    if (!this.musicEl || !this.callbacks.music) return;
    const on = this.callbacks.music.enabled();
    this.musicEl.textContent = on
      ? t("controls.music_on")
      : t("controls.music_off");
    this.musicEl.setAttribute("aria-pressed", on ? "true" : "false");
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  toggle(): void {
    if (this.root.hidden) this.open();
    else this.close();
  }

  destroy(): void {
    this.unsubscribeLocale?.();
    this.root.remove();
  }
}
