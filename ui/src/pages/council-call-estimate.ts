export interface CallEstimateOptions {
  answeringSeats: number;
  targetedSeats?: number;
  hasModerator: boolean;
  rounds: number;
  untilAgreement: boolean;
  autoSummary: boolean;
  clarify: boolean;
  peerRanking: boolean;
  jury: boolean;
  panelSize: number;
  work: { planFirst: boolean; askFirst: boolean; juryChecks: boolean; finalReview: boolean; steps?: number };
}

export function estimateCalls(options: CallEstimateOptions): { low: number; high: number; lines: string[] } {
  if (options.targetedSeats !== undefined) {
    const seats = options.targetedSeats;
    return { low: seats, high: seats, lines: [`${seats} seats answer`] };
  }
  const { work } = options;
  const lines: string[] = [];
  if (work.planFirst) {
    const steps = work.steps ?? 4;
    const checks = work.juryChecks ? 3 : 1;
    const low = (work.askFirst ? 1 : 0) + 1 + steps * (1 + checks) + (work.finalReview ? 1 : 0) + 1;
    const high = low + steps * 2 + (work.finalReview ? 2 : 0) + 1;
    if (work.askFirst) lines.push("Questions add 1");
    lines.push("Planning adds 1", `${steps} steps and checks add ${steps * (1 + checks)}`);
    if (work.finalReview) lines.push("Final review adds 1–3");
    lines.push("Summary adds 1–2", `Retries may add ${steps * 2}`);
    return { low, high, lines };
  }
  const seats = options.panelSize > 0 ? Math.min(options.panelSize, options.answeringSeats) : options.answeringSeats;
  let low = seats;
  let high = seats;
  lines.push(`${seats} seats answer`);
  const moderator = options.hasModerator && seats >= 2 ? 1 : 0;
  low += moderator;
  high += moderator;
  if (moderator) lines.push("Moderator adds 1 per round");
  const minRounds = options.untilAgreement ? 1 : Math.max(0, options.rounds - 1);
  const maxRounds = options.untilAgreement ? 3 : minRounds;
  low += minRounds * (seats + moderator);
  high += maxRounds * (seats + moderator + (options.untilAgreement ? seats : 0));
  if (maxRounds) lines.push(options.untilAgreement ? "Discussion adds up to 3 rounds and stance follow-ups" : `${minRounds} discussion rounds add ${minRounds * (seats + moderator)}`);
  if (options.autoSummary) { low++; high++; lines.push("Summary adds 1"); }
  if (options.clarify) { high += 3; lines.push("Clarification may add 3"); }
  if (options.peerRanking && seats >= 3) { const count = Math.min(seats, 6); low += count; high += count; lines.push(`Ranking adds ${count}`); }
  if (options.jury && seats >= 2) { const count = Math.min(seats - 1, 6); low += count; high += count; lines.push(`Jury adds ${count}`); }
  return { low, high, lines };
}
