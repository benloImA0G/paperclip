import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

/** Tried in order when a seat's primary model fails (capacity, timeout, empty answer). */
export interface CouncilSeatFallback {
  connectionId: string;
  grantId: string;
  model: string;
}
export type CouncilSeatRole = "none" | "researcher" | "builder" | "critic" | "synthesizer" | "moderator";
export type CouncilSeatStoredConfig = CouncilSeatFallback[] | { fallbacks: CouncilSeatFallback[]; role?: CouncilSeatRole };

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
    /** OpenAI-style reasoning effort sent with each call; "none" switches thinking off on models that support it. */
    reasoningEffort: text("reasoning_effort"),
    /** Seat's model can read images; only such seats receive attached images. */
    acceptsImages: boolean("accepts_images").notNull().default(false),
    fallbacks: jsonb("fallbacks").$type<CouncilSeatStoredConfig>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roomIdx: index("council_seats_room_idx").on(t.companyId, t.issueId, t.position),
  }),
);
