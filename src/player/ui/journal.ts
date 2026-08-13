import { Journal, type JournalEntry } from "../game/cycle";
import { setMarkdown } from "./markdown";

export interface JournalCallbacks {
  onClose(): void;
}

/** The accumulating people notebook from §5, grouped by who the player met. */
export class JournalPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly journal: Journal,
    private readonly callbacks: JournalCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel journal-panel";
    this.root.hidden = true;
    this.root.innerHTML = `
      <h2>Журнал людей</h2>
      <p>Люди забывают каждый цикл. Твои записи — нет.</p>
      <div class="journal-people"></div>
      <div class="row"><button class="ghost end" type="button">Закрыть</button></div>
    `;
    this.body = this.root.querySelector(".journal-people")!;
    this.root
      .querySelector("button")!
      .addEventListener("click", () => this.close());
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  private section(
    title: string,
    entries: readonly JournalEntry[],
  ): HTMLElement {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);
    const list = document.createElement("ul");
    list.className = "journal-list";
    for (const entry of entries) {
      const item = document.createElement("li");
      const cycle = document.createElement("span");
      cycle.textContent = `цикл ${entry.cycle}`;
      const text = document.createElement("span");
      setMarkdown(text, entry.text);
      item.append(cycle, text);
      list.appendChild(item);
    }
    section.appendChild(list);
    return section;
  }

  refresh(): void {
    const grouped = new Map<string, JournalEntry[]>();
    const world: JournalEntry[] = [];
    for (const entry of this.journal.all()) {
      if (!entry.personId) {
        world.push(entry);
        continue;
      }
      const key = `${entry.personId}\0${entry.personName ?? "Неизвестный"}`;
      const list = grouped.get(key) ?? [];
      list.push(entry);
      grouped.set(key, list);
    }
    this.body.replaceChildren(
      ...[...grouped].map(([key, entries]) =>
        this.section(key.split("\0")[1]!, entries),
      ),
      ...(world.length > 0 ? [this.section("Другие наблюдения", world)] : []),
    );
    if (this.body.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Пока ты никого не узнал.";
      this.body.appendChild(empty);
    }
  }

  open(): void {
    this.refresh();
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  destroy(): void {
    this.root.remove();
  }
}
