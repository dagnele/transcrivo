import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  sessionHistoryInputSchema,
  sessionEventSchema,
} from "@/lib/contracts/event";
import {
  sessionSolutionHistoryInputSchema,
  sessionSolutionEventSchema,
  sessionSolutionInputSchema,
  sessionSolutionSchema,
  type SessionSolution as SessionSolutionContract,
} from "@/lib/contracts/solution";
import {
  createSessionInputSchema,
  listSessionsInputSchema,
  paginatedSessionsSchema,
  sessionIdInputSchema,
  sessionSchema,
  toggleSolutionInputSchema,
  updateSessionInputSchema,
} from "@/lib/contracts/session";
import {
  subscribeToSessionEvents,
  subscribeToSessionSolutionEvents,
} from "@/server/api/session-events";
import { scheduleSessionSolutionGeneration } from "@/server/ai/session-solution-worker";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { db } from "@/server/db/client";
import { sessionEvents, sessionSolutions, sessions } from "@/server/db/schema";
import { generateSessionId } from "@/lib/ids";
import { CLI_TOKEN_LIFETIME_MS, signSessionToken } from "@/server/token";

function normalizeSessionSolution(
  solution: typeof sessionSolutions.$inferSelect,
): SessionSolutionContract {
  return sessionSolutionSchema.parse({
    ...solution,
    errorMessage: solution.errorMessage ?? null,
    provider: solution.provider ?? null,
    model: solution.model ?? null,
    promptVersion: solution.promptVersion ?? null,
    meta: solution.meta ?? null,
  });
}

export const sessionRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSessionInputSchema)
    .output(sessionSchema)
    .mutation(async ({ ctx, input }) => {
      const solutionEnabled =
        input.type === "coding" || input.type === "system_design";

      const [session] = await db
        .insert(sessions)
        .values({
          id: generateSessionId(),
          userId: ctx.session.user.id,
          title: input.title,
          type: input.type,
          language: input.language,
          status: "draft",
          solutionEnabled,
        })
        .returning();

      return sessionSchema.parse(session);
    }),

  update: protectedProcedure
    .input(updateSessionInputSchema)
    .output(sessionSchema)
    .mutation(async ({ ctx, input }) => {
      const [session] = await db
        .update(sessions)
        .set({ title: input.title, type: input.type, language: input.language })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)))
        .returning();

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      return sessionSchema.parse(session);
    }),

  delete: protectedProcedure
    .input(sessionIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db
        .delete(sessions)
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)))
        .returning({ id: sessions.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      return { success: true };
    }),

  list: protectedProcedure
    .input(listSessionsInputSchema)
    .output(paginatedSessionsSchema)
    .query(async ({ ctx, input }) => {
      const filters: Array<ReturnType<typeof eq> | ReturnType<typeof lt> | undefined> = [
        eq(sessions.userId, ctx.session.user.id),
        input.status ? eq(sessions.status, input.status) : undefined,
      ];

      if (input.cursor) {
        filters.push(lt(sessions.createdAt, new Date(input.cursor)));
      }

      const items = await db
        .select()
        .from(sessions)
        .where(and(...filters))
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .limit(input.limit + 1);

      const hasMore = items.length > input.limit;
      const pageItems = hasMore ? items.slice(0, input.limit) : items;
      const lastItem = pageItems.at(-1);

      return paginatedSessionsSchema.parse({
        items: pageItems,
        nextCursor: hasMore && lastItem ? lastItem.createdAt.toISOString() : null,
      });
    }),

  byId: protectedProcedure
    .input(sessionIdInputSchema)
    .output(sessionSchema)
    .query(async ({ ctx, input }) => {
      const session = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      return sessionSchema.parse(session);
    }),

  solution: protectedProcedure
    .input(sessionSolutionInputSchema)
    .output(sessionSolutionSchema.nullable())
    .query(async ({ ctx, input }) => {
      const ownedSession = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!ownedSession) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }

      const solution = await db.query.sessionSolutions.findFirst({
        where: eq(sessionSolutions.sessionId, input.sessionId),
        orderBy: [desc(sessionSolutions.version), desc(sessionSolutions.createdAt)],
      });

      return solution ? normalizeSessionSolution(solution) : null;
    }),

  solutionHistory: protectedProcedure
    .input(sessionSolutionHistoryInputSchema)
    .output(sessionSolutionSchema.array())
    .query(async ({ ctx, input }) => {
      const ownedSession = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!ownedSession) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }

      const items = await db
        .select()
        .from(sessionSolutions)
        .where(
          and(
            eq(sessionSolutions.sessionId, input.sessionId),
            input.afterVersion !== undefined
              ? gt(sessionSolutions.version, input.afterVersion)
              : undefined,
          ),
        )
        .orderBy(asc(sessionSolutions.version), asc(sessionSolutions.createdAt));

      return items.map(normalizeSessionSolution);
    }),

  solutionSubscribe: protectedProcedure
    .input(sessionSolutionHistoryInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      const ownedSession = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!ownedSession) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }

      const missedSolutions = await db
        .select()
        .from(sessionSolutions)
        .where(
          and(
            eq(sessionSolutions.sessionId, input.sessionId),
            input.afterVersion !== undefined
              ? gt(sessionSolutions.version, input.afterVersion)
              : undefined,
          ),
        )
        .orderBy(asc(sessionSolutions.version), asc(sessionSolutions.createdAt));

      for (const solution of missedSolutions) {
        const eventType =
          solution.status === "ready"
            ? "solution.ready"
            : solution.status === "error"
              ? "solution.failed"
              : "solution.updated";

        yield sessionSolutionEventSchema.parse({
          type: eventType,
          payload: {
            solutionId: solution.id,
            sessionId: solution.sessionId,
            version: solution.version,
            status: solution.status,
            format: solution.format,
            content: solution.content,
            sourceEventSequence: solution.sourceEventSequence,
            createdAt: solution.createdAt,
            provider: solution.provider ?? undefined,
            model: solution.model ?? undefined,
            promptVersion: solution.promptVersion ?? undefined,
            errorMessage: solution.errorMessage ?? undefined,
            meta: solution.meta ?? undefined,
          },
        });
      }

      for await (const event of subscribeToSessionSolutionEvents(
        input.sessionId,
        signal,
      )) {
        yield sessionSolutionEventSchema.parse(event);
      }
    }),

  history: protectedProcedure
    .input(sessionHistoryInputSchema)
    .output(sessionEventSchema.array())
    .query(async ({ ctx, input }) => {
      const ownedSession = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!ownedSession) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }

      const items = await db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, input.sessionId),
            input.afterSequence !== undefined
              ? gt(sessionEvents.sequence, input.afterSequence)
              : undefined,
          ),
        )
        .orderBy(asc(sessionEvents.sequence));

      return sessionEventSchema.array().parse(items);
    }),

  subscribe: protectedProcedure
    .input(sessionHistoryInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      const ownedSession = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!ownedSession) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }

      const missedEvents = await db
        .select()
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, input.sessionId),
            input.afterSequence !== undefined
              ? gt(sessionEvents.sequence, input.afterSequence)
              : undefined,
          ),
        )
        .orderBy(asc(sessionEvents.sequence));

      for (const event of missedEvents) {
        yield sessionEventSchema.parse(event);
      }

      for await (const event of subscribeToSessionEvents(input.sessionId, signal)) {
        yield sessionEventSchema.parse(event);
      }
    }),

  createToken: protectedProcedure
    .input(sessionIdInputSchema)
    .output(
      z.object({
        token: z.string(),
        expiresAt: z.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await db.query.sessions.findFirst({
        where: and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      const expiresAt = new Date(Date.now() + CLI_TOKEN_LIFETIME_MS);
      const token = await signSessionToken(session.id, expiresAt, ctx.session.user.id);

      return { token, expiresAt };
    }),

  toggleSolution: protectedProcedure
    .input(toggleSolutionInputSchema)
    .output(sessionSchema)
    .mutation(async ({ ctx, input }) => {
      const [session] = await db
        .update(sessions)
        .set({ solutionEnabled: input.enabled })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, ctx.session.user.id)))
        .returning();

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      if (input.enabled) {
        const latestFinalEvent = await db.query.sessionEvents.findFirst({
          where: and(
            eq(sessionEvents.sessionId, input.sessionId),
            eq(sessionEvents.type, "transcript.final"),
          ),
          orderBy: desc(sessionEvents.sequence),
          columns: { sequence: true },
        });

        if (latestFinalEvent) {
          scheduleSessionSolutionGeneration(input.sessionId, latestFinalEvent.sequence);
        }
      }

      return sessionSchema.parse(session);
    }),

});
