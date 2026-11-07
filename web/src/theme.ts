// The look of this device: dark ("escuro"), light ("claro") or "auto" (follows the phone).
// Saved per device like the sound; applied as data-theme on <html> before anything is drawn,
// so the door and the chat open in the right colours. "auto" leaves the attribute off and
// style.css follows prefers-color-scheme.

export type Theme = "escuro" | "claro" | "auto";

export const THEME_KEY = "kuribotas.theme";

const NAMES: Record<string, Theme> = {
  escuro: "escuro",
  dark: "escuro",
  noite: "escuro",
  claro: "claro",
  light: "claro",
  dia: "claro",
  auto: "auto",
};

// "/tema Claro" and "/theme light" both work; anything else is not a theme.
export function themeNamed(name: string): Theme | undefined {
  return NAMES[name.trim().toLowerCase()];
}

// What goes in data-theme: nothing for auto.
export function themeAttr(theme: Theme): "dark" | "light" | null {
  return theme === "escuro" ? "dark" : theme === "claro" ? "light" : null;
}

export function loadTheme(): Theme {
  try {
    return themeNamed(localStorage.getItem(THEME_KEY) ?? "") ?? "auto";
  } catch {
    return "auto"; // storage blocked: follow the phone
  }
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage blocked: it still applies until the app closes
  }
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const attr = themeAttr(theme);
  if (attr === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", attr);
}
