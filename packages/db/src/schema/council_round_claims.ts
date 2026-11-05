import { boolean, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/**
 * The distributed ownership and cancellation state for a Council room round.
 * `issue_id` is the unique active-room constraint; expired leases may be
 * atomically replaced by another server after an unclean worker exit.
 */
export const councilRoundClaims = pgTable(
  "council_round_claims",
  {
    issueId: uuid("issue_id").primaryKey().references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index("council_round_claims_company_idx").on(t.companyId) }),
);
