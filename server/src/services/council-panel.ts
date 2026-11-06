/**
 * Random panels: pick N seats from a larger pool with vendor diversity, give each a persona,
 * and label answers Seat A/B/C so judges never see who wrote what. Pure helpers, seeded for tests.
 */
import { blindLabels } from "./council-ranking.js";

export type PanelCandidate = { id: string; name: string; vendor: string; model: string };
export type PanelPersona = { id: string; label: string; brief: string };

export const PERSONAS: readonly PanelPersona[] = [
  { id: "skeptic", label: "Skeptic", brief: "Look for what could be wrong, missing or oversold. Ask for evidence." },
  { id: "optimist", label: "Optimist", brief: "Find the strongest upside and the simplest path to get it." },
  { id: "pragmatist", label: "Pragmatist", brief: "Care about cost, time and what can actually ship this week." },
  { id: "risk-officer", label: "Risk officer", brief: "Name the security, legal, data and failure risks and how to contain them." },
  { id: "customer", label: "Customer voice", brief: "Speak for the person who will use the result; judge by their benefit." },
  { id: "systems", label: "Systems thinker", brief: "Look at side effects, dependencies and how the parts interact over time." },
];

/** Small deterministic PRNG so a panel can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Pick `size` distinct candidates; with diverseVendors (default) one per vendor first, then fill. */
export function pickPanel(candidates: PanelCandidate[], opts: { size: number; seed?: number; diverseVendors?: boolean }): PanelCandidate[] {
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  const size = Math.max(1, Math.min(Math.floor(opts.size) || 1, 8, unique.length));
  if (!unique.length) return [];
  const rand = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
  const shuffled = shuffle(unique, rand);
  if (opts.diverseVendors === false) return shuffled.slice(0, size);
  const firstPerVendor: PanelCandidate[] = [];
  const rest: PanelCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of shuffled) {
    const vendor = candidate.vendor.toLowerCase();
    if (seen.has(vendor)) rest.push(candidate);
    else { seen.add(vendor); firstPerVendor.push(candidate); }
  }
  return [...firstPerVendor, ...rest].slice(0, size);
}

/** Personas without repeats while they last (then the cycle restarts). */
export function assignPersonas(panel: PanelCandidate[], seed?: number): Map<string, PanelPersona> {
  const rand = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
  const order = shuffle(PERSONAS, rand);
  return new Map(panel.map((candidate, index) => [candidate.id, order[index % order.length]!]));
}

export function personaInstruction(persona: PanelPersona): string {
  return `For this discussion your angle is ${persona.label}. ${persona.brief} Give your honest view from that angle; do not mention that you were assigned it.`;
}

export { blindLabels };

/** Shuffle answers and label them; `reveal` maps label -> seat id for the host only. */
export function anonymize(answers: Array<{ seatId: string; text: string }>, seed?: number): { answers: Array<{ label: string; text: string }>; reveal: Map<string, string> } {
  const rand = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
  const shuffled = shuffle(answers, rand);
  const labels = blindLabels(shuffled.length);
  return {
    answers: shuffled.map((answer, index) => ({ label: labels[index]!, text: answer.text })),
    reveal: new Map(shuffled.map((answer, index) => [labels[index]!, answer.seatId])),
  };
}
