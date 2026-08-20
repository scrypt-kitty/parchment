interface Heading {
  level: number;
  text: string;
  id: string;
}

const sidebar = document.getElementById("toc") as HTMLElement;
const list = document.getElementById("toc-list") as HTMLElement;

let observer: IntersectionObserver | null = null;
let visible = false;

export function isVisible(): boolean {
  return visible;
}

export function setVisible(next: boolean): void {
  visible = next;
  sidebar.hidden = !next;
  document.body.classList.toggle("with-toc", next);
}

export function build(headings: Heading[], scroller: HTMLElement): void {
  list.textContent = "";
  observer?.disconnect();
  observer = null;

  // A single H1 is the document title, not a navigable section — skip it so
  // short documents do not get a one-item table of contents.
  const items = headings.filter((h) => h.id && h.level >= 2 && h.level <= 4);
  if (items.length < 2) {
    sidebar.classList.add("empty");
    return;
  }
  sidebar.classList.remove("empty");

  const shallowest = Math.min(...items.map((h) => h.level));
  for (const heading of items) {
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = heading.text;
    link.dataset.id = heading.id;
    link.style.paddingInlineStart = `${(heading.level - shallowest) * 12 + 12}px`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    list.appendChild(link);
  }

  trackActiveHeading(items, scroller);
}

/** Highlight the entry for the heading nearest the top of the viewport. */
function trackActiveHeading(items: Heading[], scroller: HTMLElement): void {
  const seen = new Map<string, boolean>();

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting);
      const active = items.find((h) => seen.get(h.id)) ?? null;
      for (const link of list.querySelectorAll("a")) {
        link.classList.toggle("active", active !== null && link.dataset.id === active.id);
      }
    },
    { root: scroller, rootMargin: "0px 0px -75% 0px", threshold: 0 },
  );

  for (const heading of items) {
    const element = document.getElementById(heading.id);
    if (element) observer.observe(element);
  }
}
