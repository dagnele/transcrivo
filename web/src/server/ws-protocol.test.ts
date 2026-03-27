import { describe, expect, it } from "bun:test";

import { cliOutboundEnvelopeSchema, toInternalSessionEvent } from "@/server/ws-protocol";

describe("cli websocket protocol", () => {
  it("accepts cli_version in session.start payloads", () => {
    const envelope = cliOutboundEnvelopeSchema.parse({
      type: "session.start",
      sequence: 1,
      payload: {
        cli_version: "0.1.3",
        platform: "linux",
        started_at: "2026-03-17T00:00:00.000Z",
        mic_device_id: "mic-1",
        system_device_id: "sys-1",
        transcription_backend: "whisper-rs",
        model: "small.en",
      },
    });

    const event = toInternalSessionEvent(envelope, "session-1");

    expect(event.type).toBe("session.started");
    expect("meta" in event.payload ? event.payload.meta : undefined).toMatchObject({
      cli_version: "0.1.3",
      platform: "linux",
      transcription_backend: "whisper-rs",
      model: "small.en",
    });
  });

  it("requires utterance_id in transcript payloads", () => {
    expect(() =>
      cliOutboundEnvelopeSchema.parse({
        type: "transcript.final",
        sequence: 2,
        payload: {
          event_id: "evt_1",
          source: "mic",
          text: "hello world",
          start_ms: 0,
          end_ms: 1000,
          created_at: "2026-03-17T00:00:01.000Z",
        },
      }),
    ).toThrow();
  });

  it("maps the simplified transcript payload", () => {
    const envelope = cliOutboundEnvelopeSchema.parse({
      type: "transcript.final",
      sequence: 2,
      payload: {
        event_id: "evt_1",
        utterance_id: "utt_1",
        source: "mic",
        text: "hello world",
        start_ms: 0,
        end_ms: 1000,
        created_at: "2026-03-17T00:00:01.000Z",
      },
    });

    const event = toInternalSessionEvent(envelope, "session-1");

    expect(event.type).toBe("transcript.final");
    expect(event.payload).toEqual({
      eventId: "evt_1",
      utteranceId: "utt_1",
      source: "mic",
      text: "hello world",
      startMs: 0,
      endMs: 1000,
      createdAt: "2026-03-17T00:00:01.000Z",
    });
  });
});
