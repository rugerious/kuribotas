// /bandeira: a giant flag in a club's colours waves across everyone's screen in the room. Only colours,
// words and plain emoji animals: never a club's crest (those are registered trademarks).
import type { Club } from "../../shared/protocol.ts";

export const CHEER_MS = 2600; // how long the flag stays (style.css matches)

export const CLUB: Record<Club, { name: string; word: string; mark: string }> = {
  benfica: { name: "Benfica", word: "SLB", mark: "🦅" },
  porto: { name: "Porto", word: "FCP", mark: "🐉" },
  sporting: { name: "Sporting", word: "SCP", mark: "🦁" },
  madrid: { name: "Real Madrid", word: "¡HALA MADRID!", mark: "" },
  barca: { name: "Barça", word: "BARÇAAAAAA", mark: "" },
};

const NAMES: Record<string, Club> = {
  benfica: "benfica",
  slb: "benfica",
  porto: "porto",
  fcp: "porto",
  sporting: "sporting",
  scp: "sporting",
  madrid: "madrid",
  real: "madrid",
  realmadrid: "madrid",
  barca: "barca",
  barcelona: "barca",
};

// "Benfica", "SLB", "barça", "Real Madrid"… → the club; anything else → undefined.
export function clubNamed(text: string): Club | undefined {
  const key = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z]/g, "");
  return NAMES[key];
}
