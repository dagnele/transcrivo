import { z } from "zod";

import {
  sessionEventTypeSchema,
  transcriptEventPayloadSchema,
} from "@/lib/contracts/event";

export const cliOutboundMessageTypeSchema = z.enum([
  "session.start",
  "transcript.partial",
  "transcript.final",
  "session.stop",
]);

export const cliInboundMessageTypeSchema = z.enum(["session.ready", "session.error"]);

const sessionStartPayloadSchema = z.object({
  platform: z.string().min(1),
  started_at: z.string().datetime(),
  mic_device_id: z.string().min(1).optional(),
  system_device_id: z.string().min(1).optional(),
});

const sessionStopPayloadSchema = z.object({
  created_at: z.string().datetime(),
  reason: z.string().min(1).optional(),
});

const sessionReadyPayloadSchema = z.object({
  status: z.string().min(1).default("ok"),
});

const sessionErrorPayloadSchema = z.object({
  message: z.string().min(1),
  code: z.string().min(1).optional(),
});

const cliTranscriptPayloadSchema = z.object({
  event_id: z.string().min(1),
  utterance_id: z.string().min(1).optional(),
  source: z.enum(["mic", "system"]),
  speaker: z.string().min(1),
  text: z.string().min(1),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  confidence: z.number().min(0).max(1).optional(),
  language: z.string().min(1).optional(),
  device_id: z.string().min(1).optional(),
  chunk_id: z.string().min(1).optional(),
  is_overlap: z.boolean().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const cliMessageEnvelopeSchema = z.object({
  type: z.union([cliOutboundMessageTypeSchema, cliInboundMessageTypeSchema]),
  sequence: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});

export const cliOutboundEnvelopeSchema = cliMessageEnvelopeSchema.superRefine(
  (value, ctx) => {
    if (!cliOutboundMessageTypeSchema.safeParse(value.type).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unsupported outbound message type.",
      });
      return;
    }

    const payloadSchema =
      value.type === "session.start"
        ? sessionStartPayloadSchema
        : value.type === "session.stop"
          ? sessionStopPayloadSchema
          : cliTranscriptPayloadSchema;

    const payloadResult = payloadSchema.safeParse(value.payload);
    if (!payloadResult.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: payloadResult.error.issues.map((issue) => issue.message).join("; "),
      });
    }
  },
);

export function createSessionReadyEnvelope() {
  return {
    type: "session.ready" as const,
    sequence: 1,
    payload: sessionReadyPayloadSchema.parse({ status: "ok" }),
  };
}

export function createSessionErrorEnvelope(message: string, code?: string) {
  return {
    type: "session.error" as const,
    sequence: 1,
    payload: sessionErrorPayloadSchema.parse({ message, code }),
  };
}

export function toInternalSessionEvent(
  envelope: z.infer<typeof cliOutboundEnvelopeSchema>,
  sessionId: string,
) {
  if (envelope.type === "session.start") {
    return {
      sessionId,
      type: "session.started" as const,
      payload: {
        reason: "cli-session-start",
        meta: envelope.payload,
      },
    };
  }

  if (envelope.type === "session.stop") {
    return {
      sessionId,
      type: "session.ended" as const,
      payload: {
        reason:
          typeof envelope.payload.reason === "string"
            ? envelope.payload.reason
            : "cli-session-stop",
        meta: envelope.payload,
      },
    };
  }

  const payload = cliTranscriptPayloadSchema.parse(envelope.payload);

  return {
    sessionId,
    type: sessionEventTypeSchema.parse(envelope.type),
    payload: transcriptEventPayloadSchema.parse({
      eventId: payload.event_id,
      utteranceId:
        payload.utterance_id ?? payload.chunk_id ?? `${payload.source}:${payload.start_ms}:${payload.end_ms}`,
      source: payload.source,
      speaker: payload.speaker,
      text: payload.text,
      startMs: payload.start_ms,
      endMs: payload.end_ms,
      createdAt: payload.created_at,
      confidence: payload.confidence,
      language: payload.language,
      deviceId: payload.device_id,
      chunkId: payload.chunk_id,
      meta: {
        ...(payload.meta ?? {}),
        isOverlap: payload.is_overlap,
      },
    }),
  };
}

export type CliOutboundEnvelope = z.infer<typeof cliOutboundEnvelopeSchema>;
