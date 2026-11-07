// The little one peeking over the wall (the app's icon, from a family sketch). Inside the app its
// eyes move: right, at you, left, down, each its own way (style.css, "peek-*"). It shows while the
// app has no connection and in place of the status dot when you're "A zongolar" (invisible).
// Plain SVG shapes and classes: no inline styles, so the strict CSP stays as it is.
export function Peeker({ label }: { label?: string }) {
  const eye = (cx: number, side: "l" | "r") => (
    <g>
      <ellipse cx={cx} cy="250" rx="62" ry="108" fill="#e8e6e1" stroke="#080a0f" stroke-width="12" />
      <ellipse class={`pupil pupil-${side}`} cx={cx + 26} cy="268" rx="20" ry="27" fill="#080a0f" />
      {/* The lid is painted in the background's colour (style.css .peeker .lid), so it works in both themes. */}
      <path
        class="lid"
        d={`M ${cx - 66} 238 Q ${cx} 196 ${cx + 66} 238 L ${cx + 66} 140 L ${cx - 66} 140 Z`}
        fill="#080a0f"
        stroke="#080a0f"
        stroke-width="12"
      />
    </g>
  );
  const fingers = (x0: number, n: number) =>
    Array.from({ length: n }, (_, i) => (
      <rect
        key={i}
        x={x0 + i * 34}
        y={300 - 6 * Math.sin(i + 1)}
        width="40"
        height="60"
        rx="20"
        fill="#e8e6e1"
        stroke="#080a0f"
        stroke-width="9"
      />
    ));
  return (
    <svg
      class="peeker"
      viewBox="30 150 452 250"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      {eye(196, "l")}
      {eye(316, "r")}
      <rect x="0" y="330" width="512" height="80" fill="#f2a93b" />
      <line x1="0" y1="330" x2="512" y2="330" stroke="#080a0f" stroke-width="12" />
      {fingers(48, 4)}
      {fingers(388, 3)}
    </svg>
  );
}
