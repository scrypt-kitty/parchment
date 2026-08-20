const bar = document.getElementById("findbar") as HTMLElement;
const input = document.getElementById("find-input") as HTMLInputElement;
const counter = document.getElementById("find-count") as HTMLElement;
const doc = document.getElementById("doc") as HTMLElement;

let marks: HTMLElement[] = [];
let current = -1;

export function isOpen(): boolean {
  return !bar.hidden;
}

export function open(): void {
  bar.hidden = false;
  input.focus();
  input.select();
  if (input.value) run(input.value);
}

export function close(): void {
  bar.hidden = true;
  clear();
  doc.focus();
}

/** Re-run the active query, e.g. after the document reloads from disk. */
export function refresh(): void {
  if (isOpen() && input.value) run(input.value);
}

function clear(): void {
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  }
  marks = [];
  current = -1;
  counter.textContent = "0/0";
}

function run(query: string): void {
  clear();
  if (!query) return;

  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Never match inside the copy buttons we inject, or inside empty space.
      const parent = node.parentElement;
      if (!parent || parent.closest(".copy-code")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) targets.push(node as Text);

  for (const node of targets) {
    const text = node.nodeValue ?? "";
    const lower = text.toLowerCase();
    let from = 0;
    let hit = lower.indexOf(needle, from);
    if (hit === -1) continue;

    const fragment = document.createDocumentFragment();
    while (hit !== -1) {
      if (hit > from) fragment.appendChild(document.createTextNode(text.slice(from, hit)));
      const mark = document.createElement("mark");
      mark.className = "find-hit";
      mark.textContent = text.slice(hit, hit + needle.length);
      fragment.appendChild(mark);
      marks.push(mark);
      from = hit + needle.length;
      hit = lower.indexOf(needle, from);
    }
    if (from < text.length) fragment.appendChild(document.createTextNode(text.slice(from)));
    node.parentNode?.replaceChild(fragment, node);
  }

  if (marks.length) step(0);
  else counter.textContent = "0/0";
}

function step(index: number): void {
  if (!marks.length) return;
  marks[current]?.classList.remove("current");
  current = (index + marks.length) % marks.length;
  const mark = marks[current];
  mark.classList.add("current");
  mark.scrollIntoView({ block: "center", behavior: "smooth" });
  counter.textContent = `${current + 1}/${marks.length}`;
}

export function next(): void {
  step(current + 1);
}

export function previous(): void {
  step(current - 1);
}

let debounce: number | undefined;
input.addEventListener("input", () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => run(input.value), 120);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.shiftKey ? previous() : next();
  } else if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
});

document.getElementById("find-next")!.addEventListener("click", next);
document.getElementById("find-prev")!.addEventListener("click", previous);
document.getElementById("find-close")!.addEventListener("click", close);
