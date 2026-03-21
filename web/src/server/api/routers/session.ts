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
} from "@/lib/contracts/solution";
import {
  createSessionInputSchema,
  listSessionsInputSchema,
  paginatedSessionsSchema,
  sessionIdInputSchema,
  sessionSchema,
  updateSessionInputSchema,
} from "@/lib/contracts/session";
import {
  subscribeToSessionEvents,
  subscribeToSessionSolutionEvents,
} from "@/server/api/session-events";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { db } from "@/server/db/client";
import { sessionEvents, sessionSolutions, sessions } from "@/server/db/schema";
import { generateSessionId } from "@/lib/ids";
import { signSessionToken } from "@/server/token";

export const sessionRouter = createTRPCRouter({
  create: publicProcedure
    .input(createSessionInputSchema)
    .output(sessionSchema)
    .mutation(async ({ input }) => {
      const [session] = await db
        .insert(sessions)
        .values({
          id: generateSessionId(),
          title: input.title,
          type: input.type,
          language: input.language,
          status: "draft",
        })
        .returning();

      return sessionSchema.parse(session);
    }),

  update: publicProcedure
    .input(updateSessionInputSchema)
    .output(sessionSchema)
    .mutation(async ({ input }) => {
      const [session] = await db
        .update(sessions)
        .set({ title: input.title, type: input.type, language: input.language })
        .where(eq(sessions.id, input.sessionId))
        .returning();

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      return sessionSchema.parse(session);
    }),

  delete: publicProcedure
    .input(sessionIdInputSchema)
    .mutation(async ({ input }) => {
      const [deleted] = await db
        .delete(sessions)
        .where(eq(sessions.id, input.sessionId))
        .returning({ id: sessions.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      return { success: true };
    }),

  list: publicProcedure
    .input(listSessionsInputSchema)
    .output(paginatedSessionsSchema)
    .query(async ({ input }) => {
      const filters = [input.status ? eq(sessions.status, input.status) : undefined];

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

  byId: publicProcedure
    .input(sessionIdInputSchema)
    .output(sessionSchema)
    .query(async ({ input }) => {
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      return sessionSchema.parse(session);
    }),

  solution: publicProcedure
    .input(sessionSolutionInputSchema)
    .output(sessionSolutionSchema.nullable())
    .query(async ({ input }) => {
      const solution = await db.query.sessionSolutions.findFirst({
        where: eq(sessionSolutions.sessionId, input.sessionId),
        orderBy: [desc(sessionSolutions.version), desc(sessionSolutions.createdAt)],
      });

      return solution ? sessionSolutionSchema.parse(solution) : null;
    }),

  solutionHistory: publicProcedure
    .input(sessionSolutionHistoryInputSchema)
    .output(sessionSolutionSchema.array())
    .query(async ({ input }) => {
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

      return sessionSolutionSchema.array().parse(items);
    }),

  solutionSubscribe: publicProcedure
    .input(sessionSolutionHistoryInputSchema)
    .subscription(async function* ({ input, signal }) {
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

  history: publicProcedure
    .input(sessionHistoryInputSchema)
    .output(sessionEventSchema.array())
    .query(async ({ input }) => {
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

  subscribe: publicProcedure
    .input(sessionHistoryInputSchema)
    .subscription(async function* ({ input, signal }) {
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

  createToken: publicProcedure
    .input(sessionIdInputSchema)
    .output(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found.",
        });
      }

      // userId is null until the user model is implemented
      const token = await signSessionToken(session.id, null);

      return { token };
    }),

});
