export const COUNCIL_ROUND_ORDERS = ["seat", "random", "reverse"] as const;

export type CouncilRoundOrder = (typeof COUNCIL_ROUND_ORDERS)[number];
