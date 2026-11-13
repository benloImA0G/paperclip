import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  feedbackExports,
  feedbackVotes,
  instanceSettings,
  issueComments,
  issues,
} from "@paperclipai/db";
import { feedbackService } from "../services/feedback.ts";
import { COUNCIL_SEAT_AUTHOR_PREFIX } from "../services/council-chat.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("feedbackService.saveIssueVote on Council seat comments", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof feedbackService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("paperclip-council-feedback-");
    db = createDb(started.connectionString);
    svc = feedbackService(db);
    tempDb = started;
  }, 120_000);

  afterEach(async () => {
    await db.delete(feedbackExports);
    await db.delete(feedbackVotes);
    await db.delete(instanceSettings);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const otherIssueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    for (const id of [issueId, otherIssueId]) {
      await db.insert(issues).values({
        id,
        companyId,
        title: "Council room",
        status: "todo",
        priority: "medium",
        createdByUserId: "user-1",
      });
    }
    const seatCommentId = randomUUID();
    const humanCommentId = randomUUID();
    const agentCommentId = randomUUID();
    const otherIssueSeatCommentId = randomUUID();
    await db.insert(issueComments).values([
      { id: seatCommentId, companyId, issueId, authorUserId: `${COUNCIL_SEAT_AUTHOR_PREFIX}seat-1`, body: "Seat answer" },
      { id: humanCommentId, companyId, issueId, authorUserId: "user-1", body: "Human note" },
      { id: agentCommentId, companyId, issueId, authorAgentId: agentId, body: "Agent update" },
      {
        id: otherIssueSeatCommentId,
        companyId,
        issueId: otherIssueId,
        authorUserId: `${COUNCIL_SEAT_AUTHOR_PREFIX}seat-1`,
        body: "Seat answer elsewhere",
      },
    ]);
    return { issueId, seatCommentId, humanCommentId, agentCommentId, otherIssueSeatCommentId };
  }

  const vote = (issueId: string, targetId: string) =>
    svc.saveIssueVote({ issueId, targetType: "issue_comment", targetId, vote: "up", authorUserId: "user-1" });

  it("accepts and saves a vote on a Council seat comment", async () => {
    const s = await seed();
    const result = await vote(s.issueId, s.seatCommentId);
    expect(result.vote).toMatchObject({ targetId: s.seatCommentId, vote: "up" });
    const rows = await db.select().from(feedbackVotes);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetId).toBe(s.seatCommentId);
  });

  it("still rejects a human-written comment", async () => {
    const s = await seed();
    await expect(vote(s.issueId, s.humanCommentId)).rejects.toMatchObject({ status: 422 });
  });

  it("still accepts an agent-authored comment", async () => {
    const s = await seed();
    const result = await vote(s.issueId, s.agentCommentId);
    expect(result.vote).toMatchObject({ targetId: s.agentCommentId, vote: "up" });
  });

  it("rejects a seat comment that belongs to another issue", async () => {
    const s = await seed();
    await expect(vote(s.issueId, s.otherIssueSeatCommentId)).rejects.toMatchObject({ status: 404 });
  });
});
