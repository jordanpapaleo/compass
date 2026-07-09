/** Light/dark theme via daisyUI `data-theme` on the root element, persisted. */

export type Theme = "light" | "dark";

const KEY = "compass-theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  // Fall back to whatever the document was seeded with (index.html: dark).
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}
