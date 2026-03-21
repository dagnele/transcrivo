import type { IncomingMessage } from "http";
import { WebSocketServer, type RawData } from "ws";

import { ingestSessionEvent } from "@/server/api/session-event-ingest";
import {
  cliOutboundEnvelopeSchema,
  createSessionErrorEnvelope,
  createSessionReadyEnvelope,
  toInternalSessionEvent,
} from "@/server/ws-protocol";
import { verifySessionToken, TokenError, type TokenPayload } from "@/server/token";

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

export function attachCliWebSocketHandlers(webSocketServer: WebSocketServer) {
  webSocketServer.on("connection", async (socket, request: IncomingMessage) => {
    const path = request.url ?? "";

    if (!path.startsWith("/ws")) {
      socket.close(1008, "Unsupported websocket path");
      return;
    }

    // Authenticate via Bearer token
    const rawToken = extractBearerToken(request);
    if (!rawToken) {
      sendJson(socket, createSessionErrorEnvelope("Missing Authorization header", "auth_required"));
      socket.close(1008, "Missing Authorization header");
      return;
    }

    let tokenPayload: TokenPayload;
    try {
      tokenPayload = await verifySessionToken(rawToken);
    } catch (error) {
      const message = error instanceof TokenError ? error.message : "Authentication failed";
      sendJson(socket, createSessionErrorEnvelope(message, "auth_failed"));
      socket.close(1008, message);
      return;
    }

    const authenticatedSessionId = tokenPayload.sid;
    let acknowledged = false;

    socket.on("message", async (rawMessage) => {
      try {
        const decoded = JSON.parse(parseRawMessage(rawMessage));
        const envelope = cliOutboundEnvelopeSchema.parse(decoded);

        if (envelope.type === "session.start") {
          acknowledged = true;

          try {
            await ingestSessionEvent(toInternalSessionEvent(envelope, authenticatedSessionId));
            sendJson(socket, createSessionReadyEnvelope());
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unable to start session";

            sendJson(
              socket,
              createSessionErrorEnvelope(message, "session_start_failed"),
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

        await ingestSessionEvent(toInternalSessionEvent(envelope, authenticatedSessionId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid websocket message";

        sendJson(
          socket,
          createSessionErrorEnvelope(message, "protocol_error"),
        );
      }
    });
  });
}
