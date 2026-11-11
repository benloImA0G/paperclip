import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";

export const memoryEntries = pgTable("memory_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  sourceUrl: text("source_url"),
  sourceLabel: text("source_label"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  pinned: boolean("pinned").notNull().default(false),
  status: text("status").notNull().default("active"),
  originKind: text("origin_kind").notNull().default("manual"),
  originRef: text("origin_ref"),
  createdByLabel: text("created_by_label").notNull(),
  withdrawnReason: text("withdrawn_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
}, (t) => ({ companyStatusIdx: index("memory_entries_company_status_idx").on(t.companyId, t.status), activeUnique: uniqueIndex("memory_entries_active_unique").on(t.companyId, t.kind, t.title).where(sql`${t.status} = 'active'`) }));
