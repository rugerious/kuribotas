// The app's own button icons, drawn as SVG so they look the same on every phone (emoji don't).
// Lines in currentColor, so each icon takes its button's colour in every theme and style. Always
// decorative: the button carries the words (aria-label or text).

export type IconName = "gear" | "open" | "close" | "tips" | "edit" | "smile" | "chat" | "lock" | "nudge" | "tornado";

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

function shape(name: IconName) {
  switch (name) {
    case "gear":
      return (
        <>
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2.2" />
          {TEETH.map((a) => (
            <path key={a} d="M12 3.4v2.6" stroke-width="3" transform={`rotate(${a} 12 12)`} />
          ))}
        </>
      );
    case "open":
      return <path d="M10 7l5 5-5 5" />;
    case "close":
      return <path d="M14 7l-5 5 5 5" />;
    case "tips":
      return <path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.5 1.1-2.1A6 6 0 0 0 12 3z" />;
    case "edit":
      return <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />;
    case "smile":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" />
          <path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.8" />
        </>
      );
    case "chat":
      return <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />;
    case "lock":
      return (
        <>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </>
      );
    case "nudge":
      return (
        <>
          <rect x="7.5" y="3" width="9" height="18" rx="2" />
          <path d="M3.5 9v6M20.5 9v6" />
        </>
      );
    case "tornado":
      return <path d="M3 5h18M5 9h14M8 13h9M10 17h5M11.5 21h2" />;
  }
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      class={`icon icon-${name}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape(name)}
    </svg>
  );
}
