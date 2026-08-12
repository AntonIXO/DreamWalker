import { WordNotebook } from "../game/wordNotebook";

export class WordNotebookPanel {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
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
        <div><span class="system-label">УЛИКИ</span><h2>Шесть слов</h2></div>
        <span class="word-observed"></span>
      </header>
      <p>Запиши свои гипотезы. Игра не скажет, угадал ли ты предмет.</p>
      <div class="word-notebook-grid"></div>
      <p class="dim">Только английские буквы. Порядок здесь ничего не означает.</p>
      <div class="row"><button class="ghost end" type="button">Закрыть</button></div>
    `;
    parent.appendChild(this.root);
    this.count = this.root.querySelector(".word-observed")!;
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
      input.placeholder = "hypothesis";
      input.addEventListener("input", () => {
        this.notebook.set(index, input.value);
        input.value = this.notebook.words[index] ?? "";
      });
      label.appendChild(input);
      grid.appendChild(label);
      return input;
    });
    this.root
      .querySelector("button")!
      .addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.count.textContent = `осмотрено ${this.notebook.observedCount}/6`;
    this.inputs.forEach((input, index) => {
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
