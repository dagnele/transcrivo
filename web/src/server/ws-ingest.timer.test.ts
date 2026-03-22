import { describe, expect, it } from "bun:test";

class SessionStateError extends Error {
  constructor(
    message: string,
    readonly code: "session_expired" | "session_closed",
  ) {
    super(message);
    this.name = "SessionStateError";
  }
}

type SessionRecord = {
  id: string;
  status: string;
  expiresAt: Date | null;
  endedAt: Date | null;
};

function createSession(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    status: "live",
    expiresAt: null,
    endedAt: null,
    ...partial,
  };
}

function createSessionErrorEnvelope(message: string, code?: string) {
  return {
    type: "session.error" as const,
    sequence: 1,
    payload: { message, code },
  };
}

function createTimerHarness() {
  const messages: Array<{ message: string; code?: string }> = [];
  let closed = false;
  let expirationTimer: ReturnType<typeof setTimeout> | null = null;
  let authenticatedSession: SessionRecord | null = null;

  const clearExpirationTimer = () => {
    if (expirationTimer !== null) {
      clearTimeout(expirationTimer);
      expirationTimer = null;
    }
  };

  const closeSocketWithError = (message: string, code?: string) => {
    if (closed) {
      return;
    }

    const envelope = createSessionErrorEnvelope(message, code);
    messages.push({
      message: String(envelope.payload.message),
      code: envelope.payload.code,
    });
    closed = true;
  };

  const armExpirationTimer = (
    expiresAt: Date | null,
    expireSessionIfNeeded: (session: SessionRecord, now: Date) => Promise<SessionRecord>,
  ) => {
    clearExpirationTimer();

    if (!expiresAt) {
      return;
    }

    const delayMs = expiresAt.getTime() - Date.now();
    const triggerClose = async () => {
      if (!authenticatedSession || closed) {
        return;
      }

      try {
        authenticatedSession = await expireSessionIfNeeded(authenticatedSession, new Date());
      } catch {
        // Fall through and still close the socket with the intended session error.
      }

      closeSocketWithError("Session has expired.", "session_expired");
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

  return {
    messages,
    get closed() {
      return closed;
    },
    setSession(session: SessionRecord | null) {
      authenticatedSession = session;
    },
    clearExpirationTimer,
    armExpirationTimer,
  };
}

describe("CLI websocket expiration timer behavior", () => {
  it("closes an idle connection when expiresAt is reached", async () => {
    const harness = createTimerHarness();
    const now = Date.now();
    harness.setSession(createSession({ expiresAt: new Date(now + 20) }));

    let expireCalls = 0;
    harness.armExpirationTimer(new Date(now + 20), async (session) => {
      expireCalls += 1;
      return {
        ...session,
        status: "expired",
        endedAt: new Date(),
      };
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(expireCalls).toBe(1);
    expect(harness.closed).toBe(true);
    expect(harness.messages).toEqual([
      { message: "Session has expired.", code: "session_expired" },
    ]);
  });

  it("still closes with session_expired when expiry persistence throws", async () => {
    const harness = createTimerHarness();
    harness.setSession(createSession({ expiresAt: new Date(Date.now() + 10) }));

    harness.armExpirationTimer(new Date(Date.now() + 10), async () => {
      throw new Error("db offline");
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(harness.closed).toBe(true);
    expect(harness.messages).toEqual([
      { message: "Session has expired.", code: "session_expired" },
    ]);
  });
});

describe("session error code propagation", () => {
  it("keeps the underlying session_expired code instead of protocol_error", () => {
    const error = new SessionStateError("Session has expired.", "session_expired");
    const code = error instanceof SessionStateError ? error.code : "protocol_error";
    const envelope = createSessionErrorEnvelope(error.message, code);

    expect(envelope.payload.code).toBe("session_expired");
    expect(envelope.payload.message).toBe("Session has expired.");
  });
});
