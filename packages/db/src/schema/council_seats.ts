import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/**
 * Council Chat seats. A war room is an issue (origin_kind = 'council'); each
 * seat is one model voice in that room, bound to an AI connection grant.
 * Credentials never live here: they stay behind the connection grant.
 */
export const councilSeats = pgTable(
  "council_seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    persona: text("persona").notNull().default(""),
    connectionId: uuid("connection_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    model: text("model").notNull(),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roomIdx: index("council_seats_room_idx").on(t.companyId, t.issueId, t.position),
  }),
);
