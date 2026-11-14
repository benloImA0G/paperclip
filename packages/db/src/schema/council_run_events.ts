import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const councilRunEvents = pgTable("council_run_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runSequenceIdx: uniqueIndex("council_run_events_run_sequence_idx").on(t.runId, t.sequence),
  roomCreatedIdx: index("council_run_events_room_created_idx").on(t.roomId, t.createdAt),
}));
