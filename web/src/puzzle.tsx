// The web logo: a sliding puzzle, solved. KURI on top (light tiles), BOTAS below (amber), the empty
// slot at the end of the top row (the social-media video shows it solving: I up, A left, S down).
// Plain spans and classes, so the CSP stays strict. On a phone the corner shows the peeker instead.
const TOP = ["K", "U", "R", "I"];
const BOTTOM = ["B", "O", "T", "A", "S"];

export function Puzzle({ class: extra = "" }: { class?: string }) {
  const tile = (ch: string, row: "top" | "bottom") => (
    <span key={ch} class={`tile tile-${row} tile-${ch}`}>
      {ch}
    </span>
  );
  return (
    <span class={`puzzle${extra ? ` ${extra}` : ""}`} role="img" aria-label="Kuribotas">
      {TOP.map((ch) => tile(ch, "top"))}
      <span class="tile-hole" />
      {BOTTOM.map((ch) => tile(ch, "bottom"))}
    </span>
  );
}
