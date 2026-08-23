import { WordNotebook } from "../game/wordNotebook";
import { t } from "../../shared/i18n";

export class WordNotebookPanel {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly systemLabelEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly instructionEl: HTMLElement;
  private readonly alphabetNoteEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly inputs: HTMLInputElement[];

  constructor(
    parent: HTMLElement,
    private readonly notebook: WordNotebook,
    private readonly onClose: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel word-notebook";
    this.root.hidden = true;
    this.root.innerHTML = `
      <header class="panel-title-row">
        <div><span class="system-label notebook-system-label"></span><h2 class="notebook-title"></h2></div>
        <span class="word-observed"></span>
      </header>
      <p class="notebook-instruction"></p>
      <div class="word-notebook-grid"></div>
      <p class="dim notebook-alphabet-note"></p>
      <div class="row"><button class="ghost end" type="button"></button></div>
    `;
    parent.appendChild(this.root);
    this.systemLabelEl = this.root.querySelector(".notebook-system-label")!;
    this.titleEl = this.root.querySelector(".notebook-title")!;
    this.instructionEl = this.root.querySelector(".notebook-instruction")!;
    this.alphabetNoteEl = this.root.querySelector(".notebook-alphabet-note")!;
    this.count = this.root.querySelector(".word-observed")!;
    this.closeBtn = this.root.querySelector("button")!;

    const grid = this.root.querySelector(".word-notebook-grid")!;
    this.inputs = Array.from({ length: 6 }, (_, index) => {
      const label = document.createElement("label");
      label.className = "word-hypothesis";
      label.innerHTML = `<span>${index + 1}</span>`;
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 24;
      input.value = this.notebook.words[index] ?? "";
      input.placeholder = t("wordNotebook.placeholder");
      input.addEventListener("input", () => {
        this.notebook.set(index, input.value);
        input.value = this.notebook.words[index] ?? "";
      });
      label.appendChild(input);
      grid.appendChild(label);
      return input;
    });
    this.closeBtn.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.systemLabelEl.textContent = t("ui.system_label_clue");
    this.titleEl.textContent = t("wordNotebook.title");
    this.instructionEl.textContent = t("wordNotebook.instruction");
    this.alphabetNoteEl.textContent = t("wordNotebook.alphabet_note");
    this.closeBtn.textContent = t("ui.close");

    this.count.textContent = t("wordNotebook.observed", {
      n: this.notebook.observedCount,
    });
    this.inputs.forEach((input, index) => {
      input.placeholder = t("wordNotebook.placeholder");
      input.value = this.notebook.words[index] ?? "";
    });
    this.root.hidden = false;
    this.inputs.find((input) => !input.value)?.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose();
  }
}
