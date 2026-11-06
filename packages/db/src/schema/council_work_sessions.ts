import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/**
 * The latest work session of a Council room (goal -> steps -> summary), kept so it survives a
 * server restart and can be reviewed later. One row per room; a new session replaces it.
 */
export const councilWorkSessions = pgTable(
  "council_work_sessions",
  {
    issueId: uuid("issue_id").primaryKey().references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    status: text("status").notNull(),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index("council_work_sessions_company_idx").on(t.companyId) }),
);
