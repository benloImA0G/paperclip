export const COUNCIL_ROUND_ORDERS = ["seat", "random", "reverse"] as const;

export type CouncilRoundOrder = (typeof COUNCIL_ROUND_ORDERS)[number];

export const COUNCIL_ROUND_STYLES = ["collaborate", "challenge", "chain"] as const;

export type CouncilRoundStyle = (typeof COUNCIL_ROUND_STYLES)[number];
