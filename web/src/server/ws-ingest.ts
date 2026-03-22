import type { IncomingMessage } from "http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { ingestSessionEvent } from "@/server/api/session-event-ingest";
import {
  cliOutboundEnvelopeSchema,
  createSessionErrorEnvelope,
  createSessionReadyEnvelope,
  toInternalSessionEvent,
} from "@/server/ws-protocol";
import { db } from "@/server/db/client";
import { sessions, type Session } from "@/server/db/schema";
import {
  assertSessionAcceptsCliTraffic,
  expireSessionIfNeeded,
  SessionStateError,
} from "@/server/session-lifecycle";
import { verifySessionToken, TokenError, type TokenPayload } from "@/server/token";
import { and, eq } from "drizzle-orm";

function sendJson(socket: import("ws").WebSocket, payload: object) {
  socket.send(JSON.stringify(payload));
}

const textDecoder = new TextDecoder();

function parseRawMessage(rawMessage: RawData) {
  if (typeof rawMessage === "string") {
    return rawMessage;
  }

  if (rawMessage instanceof Buffer) {
    return rawMessage.toString("utf8");
  }

  if (Array.isArray(rawMessage)) {
    return Buffer.concat(rawMessage).toString("utf8");
  }

  return textDecoder.decode(rawMessage);
}

function extractBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function createCliWebSocketServer() {
  return new WebSocketServer({ noServer: true });
}

async function validateCliTokenSessionAccess(tokenPayload: TokenPayload) {
  if (!tokenPayload.uid) {
    throw new TokenError("Token is missing user id", "auth_failed");
  }

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, tokenPayload.sid),
      eq(sessions.userId, tokenPayload.uid),
    ),
  });

  if (!session) {
    throw new TokenError("Token is not valid for this session", "auth_failed");
  }

  try {
    return await assertSessionAcceptsCliTraffic(session);
  } catch (error) {
    if (error instanceof SessionStateError) {
      throw new TokenError(error.message, error.code);
    }

    throw error;
  }
}

function isOpenSocket(socket: WebSocket) {
  return socket.readyState === WebSocket.OPEN;
}

function closeSocketWithError(socket: WebSocket, message: string, code?: string) {
  if (!isOpenSocket(socket)) {
    return;
  }

  sendJson(socket, createSessionErrorEnvelope(message, code));
  socket.close(1008, message);
}

export function attachCliWebSocketHandlers(webSocketServer: WebSocketServer) {
  webSocketServer.on("connection", (socket, request: IncomingMessage) => {
    const path = request.url ?? "";

    if (!path.startsWith("/ws")) {
      socket.close(1008, "Unsupported websocket path");
      return;
    }
    let acknowledged = false;

    let authenticatedSessionId: string | null = null;
    let authenticatedSession: Session | null = null;
    let authCompleted = false;
    let processingMessages = false;
    const queuedMessages: RawData[] = [];
    let expirationTimer: ReturnType<typeof setTimeout> | null = null;

    const clearExpirationTimer = () => {
      if (expirationTimer !== null) {
        clearTimeout(expirationTimer);
        expirationTimer = null;
      }
    };

    const armExpirationTimer = (expiresAt: Date | null) => {
      clearExpirationTimer();

      if (!expiresAt) {
        return;
      }

      const delayMs = expiresAt.getTime() - Date.now();
      const triggerClose = async () => {
        if (!authenticatedSession || !isOpenSocket(socket)) {
          return;
        }

        try {
          authenticatedSession = await expireSessionIfNeeded(authenticatedSession, new Date());
        } catch {
          // Fall through and still close the socket with the intended session error.
        }

        closeSocketWithError(socket, "Session has expired.", "session_expired");
      };

      if (delayMs <= 0) {
        void triggerClose();
        return;
      }

      expirationTimer = setTimeout(() => {
        expirationTimer = null;
        void triggerClose();
      }, delayMs);
    };

    socket.on("close", () => {
      clearExpirationTimer();
    });

    const handleAuthenticatedMessage = async (rawMessage: RawData) => {
      try {
        const sessionId = authenticatedSessionId;
        if (!sessionId) {
          sendJson(
            socket,
            createSessionErrorEnvelope("Authentication failed", "auth_failed"),
          );
          return;
        }

        const decoded = JSON.parse(parseRawMessage(rawMessage));
        const envelope = cliOutboundEnvelopeSchema.parse(decoded);

        if (envelope.type === "session.start") {
          try {
            await ingestSessionEvent(toInternalSessionEvent(envelope, sessionId));
            if (authenticatedSessionId) {
              const refreshedSession = await db.query.sessions.findFirst({
                where: eq(sessions.id, authenticatedSessionId),
              });
              if (refreshedSession) {
                authenticatedSession = refreshedSession;
              }
              armExpirationTimer(authenticatedSession?.expiresAt ?? null);
            }
            acknowledged = true;
            sendJson(socket, createSessionReadyEnvelope());
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unable to start session";
            const code = error instanceof SessionStateError ? error.code : "session_start_failed";

            sendJson(
              socket,
              createSessionErrorEnvelope(message, code),
            );
          }

          return;
        }

        if (!acknowledged) {
          sendJson(
            socket,
            createSessionErrorEnvelope(
              "session.start must be acknowledged before other events",
              "session_not_ready",
            ),
          );
          return;
        }

        await ingestSessionEvent(toInternalSessionEvent(envelope, sessionId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid websocket message";
        const code = error instanceof SessionStateError ? error.code : "protocol_error";

        sendJson(socket, createSessionErrorEnvelope(message, code));

        if (error instanceof SessionStateError && error.code === "session_expired") {
          socket.close(1008, message);
        }
      }
    };

    const processQueuedMessages = async () => {
      if (
        processingMessages ||
        !authCompleted ||
        authenticatedSessionId === null ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      processingMessages = true;

      try {
        while (
          queuedMessages.length > 0 &&
          authenticatedSessionId !== null &&
          socket.readyState === WebSocket.OPEN
        ) {
          const nextMessage = queuedMessages.shift();

          if (nextMessage) {
            await handleAuthenticatedMessage(nextMessage);
          }
        }
      } finally {
        processingMessages = false;
      }
    };

    socket.on("message", (rawMessage) => {
      queuedMessages.push(rawMessage);

      if (authCompleted) {
        void processQueuedMessages();
      }
    });

    void (async () => {
      const rawToken = extractBearerToken(request);
      if (!rawToken) {
        authCompleted = true;
        queuedMessages.length = 0;
        sendJson(
          socket,
          createSessionErrorEnvelope("Missing Authorization header", "auth_required"),
        );
        socket.close(1008, "Missing Authorization header");
        return;
      }

      let tokenPayload: TokenPayload;
      try {
        tokenPayload = await verifySessionToken(rawToken);
        authenticatedSession = await validateCliTokenSessionAccess(tokenPayload);
      } catch (error) {
        authCompleted = true;
        queuedMessages.length = 0;
        const message = error instanceof TokenError ? error.message : "Authentication failed";
        const code = error instanceof TokenError ? error.code ?? "auth_failed" : "auth_failed";
        sendJson(socket, createSessionErrorEnvelope(message, code));
        socket.close(1008, message);
        return;
      }

      authenticatedSessionId = tokenPayload.sid;
      authCompleted = true;
      armExpirationTimer(authenticatedSession?.expiresAt ?? null);
      await processQueuedMessages();
    })();
  });
}
