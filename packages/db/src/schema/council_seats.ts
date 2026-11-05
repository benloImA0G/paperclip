import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

/** Tried in order when a seat's primary model fails (capacity, timeout, empty answer). */
export interface CouncilSeatFallback {
  connectionId: string;
  grantId: string;
  model: string;
}
export type CouncilSeatRole = "none" | "researcher" | "builder" | "critic" | "synthesizer" | "moderator";
export type CouncilSeatKind = "model" | "agent";
export type CouncilSeatStoredConfig = CouncilSeatFallback[] | { fallbacks: CouncilSeatFallback[]; role?: CouncilSeatRole };

/**
 * Council Chat seats. A war room is an issue (origin_kind = 'council'); each
 * seat is one model or agent voice in that room. Credentials never live here:
 * they stay behind the connection grant.
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
    seatKind: text("seat_kind").$type<CouncilSeatKind>().notNull().default("model"),
    // Agent-owned seats have no useful identity after the agent is deleted.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    grantId: uuid("grant_id"),
    model: text("model"),
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
    seatKindShape: check(
      "council_seats_kind_shape_check",
      sql`(seat_kind = 'model' AND connection_id IS NOT NULL AND grant_id IS NOT NULL AND model IS NOT NULL AND agent_id IS NULL) OR (seat_kind = 'agent' AND agent_id IS NOT NULL)`,
    ),
  }),
);
