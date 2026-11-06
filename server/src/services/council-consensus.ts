export const AGREEMENT_THRESHOLD = 65;
export const STANCE_TEXT_LIMIT = 200;
export const STALL_DELTA = 3;

export type Stance = "agree" | "agree_with_conditions" | "disagree" | "abstain";

export type ParsedStance = {
  stance: Stance;
  confidence: 1 | 2 | 3 | 4 | 5;
  concession?: string;
  objection?: string;
};

type ScoredStance = ParsedStance & { seat: string; confidence: number };

export type AgreementScore = {
  percent: number;
  label: "Strong agreement" | "Agreement with concessions" | "Split" | "No agreement" | "Not enough input";
  plain: string;
  concessions: Array<{ seat: string; text: string }>;
  objections: Array<{ seat: string; text: string }>;
  counts: { agree: number; conditions: number; disagree: number; abstain: number };
  reached: boolean;
};

const STANCE_LINE = /^\s*(STANCE|CONFIDENCE|CONCESSION|OBJECTION)\s*:\s*(.*?)\s*$/i;

function matchStanceLine(line: string) {
  return line.replaceAll("**", "").match(STANCE_LINE);
}

function normalizeValue(value: string) {
  return value.trim().replace(/^\*+\s*|\s*\*+$/g, "").trim();
}

function stanceFromValue(value: string): Stance | null {
  switch (normalizeValue(value).toLowerCase().replace(/\s+/g, " ")) {
    case "agree":
      return "agree";
    case "agree with conditions":
      return "agree_with_conditions";
    case "disagree":
      return "disagree";
    case "abstain":
      return "abstain";
    default:
      return null;
  }
}

function truncate(value: string) {
  return value.slice(0, STANCE_TEXT_LIMIT);
}

function lastStanceLine(lines: string[]) {
  let result = -1;
  for (const [index, line] of lines.entries()) {
    const match = matchStanceLine(line);
    if (match?.[1].toUpperCase() === "STANCE") result = index;
  }
  return result;
}

export function parseStance(text: string): ParsedStance | null {
  const lines = text.split(/\r?\n/);
  const start = lastStanceLine(lines);
  if (start === -1) return null;

  const stanceMatch = matchStanceLine(lines[start]);
  const stance = stanceMatch ? stanceFromValue(stanceMatch[2]) : null;
  if (!stance) return null;

  let confidence: 1 | 2 | 3 | 4 | 5 = 3;
  let concession: string | undefined;
  let objection: string | undefined;
  for (const line of lines.slice(start + 1)) {
    const match = matchStanceLine(line);
    if (!match) continue;
    const field = match[1].toUpperCase();
    const value = normalizeValue(match[2]);
    if (field === "CONFIDENCE" && /^[1-5]$/.test(value)) confidence = Number(value) as 1 | 2 | 3 | 4 | 5;
    if (field === "CONCESSION" && value) concession = truncate(value);
    if (field === "OBJECTION" && value) objection = truncate(value);
  }

  return { stance, confidence, ...(concession ? { concession } : {}), ...(objection ? { objection } : {}) };
}

export function stripStanceBlock(text: string) {
  const lines = text.split(/\r?\n/);
  const start = lastStanceLine(lines);
  if (start === -1) return text;
  const hasOnlyBlockLinesAfterward = lines.slice(start + 1).every((line) => !line.trim() || matchStanceLine(line));
  return hasOnlyBlockLinesAfterward ? lines.slice(0, start).join("\n").trimEnd() : text;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function scoreAgreement(stances: ScoredStance[]): AgreementScore {
  const counts = { agree: 0, conditions: 0, disagree: 0, abstain: 0 };
  const concessions: AgreementScore["concessions"] = [];
  const objections: AgreementScore["objections"] = [];
  let numerator = 0;
  let denominator = 0;

  for (const item of stances) {
    if (item.stance === "agree") counts.agree += 1;
    if (item.stance === "agree_with_conditions") counts.conditions += 1;
    if (item.stance === "disagree") counts.disagree += 1;
    if (item.stance === "abstain") counts.abstain += 1;
    if (item.concession) concessions.push({ seat: item.seat, text: item.concession });
    if (item.objection) objections.push({ seat: item.seat, text: item.objection });

    if (item.stance === "abstain") continue;
    const weight = 0.6 + 0.4 * (Math.max(1, Math.min(5, item.confidence)) / 5);
    const points = item.stance === "agree" ? 1 : item.stance === "agree_with_conditions" ? 0.65 : 0;
    numerator += points * weight;
    denominator += weight;
  }

  const participating = stances.length - counts.abstain;
  const percent = participating < 2 ? 0 : Math.round((100 * numerator) / denominator);
  const label: AgreementScore["label"] = participating < 2
    ? "Not enough input"
    : percent >= 85 && counts.disagree === 0
      ? "Strong agreement"
      : percent >= AGREEMENT_THRESHOLD
        ? "Agreement with concessions"
        : percent >= 40
          ? "Split"
          : "No agreement";
  const reached = participating >= 2 && percent >= AGREEMENT_THRESHOLD;
  const agreementText = counts.conditions
    ? `${counts.agree + counts.conditions} of ${stances.length} seats agree (${countLabel(counts.conditions, "with conditions", "with conditions")})`
    : `${counts.agree} of ${stances.length} seats agree`;
  const differences = [
    counts.disagree ? countLabel(counts.disagree, "disagrees", "disagree") : "",
    counts.abstain ? countLabel(counts.abstain, "abstains", "abstain") : "",
  ].filter(Boolean).join("; ");
  const plain = `${agreementText}${differences ? `; ${differences}` : ""}. Agreement ${percent}%: ${label}.`;

  return { percent, label, plain, concessions, objections, counts, reached };
}

export function shouldStop(history: number[], opts: { maxRounds: number; threshold?: number }) {
  const last = history.at(-1);
  const threshold = opts.threshold ?? AGREEMENT_THRESHOLD;
  if (last !== undefined && last >= threshold) return { stop: true, reason: "agreement" as const };
  if (history.length >= opts.maxRounds) return { stop: true, reason: "max_rounds" as const };
  if (history.length >= 2 && last !== undefined && Math.abs(last - history.at(-2)!) <= STALL_DELTA) {
    return { stop: true, reason: "stalled" as const };
  }
  return { stop: false, reason: "continue" as const };
}
