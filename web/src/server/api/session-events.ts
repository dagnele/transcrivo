import type { SessionEvent } from "@/lib/contracts/event";
import type { SessionSolutionEvent } from "@/lib/contracts/solution";

type SessionEventListener = (event: SessionEvent) => void;
type SessionSolutionEventListener = (event: SessionSolutionEvent) => void;

const globalSessionEvents = globalThis as typeof globalThis & {
  __transcrivoSessionListeners__?: Map<string, Set<SessionEventListener>>;
  __transcrivoSessionSequences__?: Map<string, number>;
  __transcrivoSessionSolutionListeners__?: Map<
    string,
    Set<SessionSolutionEventListener>
  >;
  __transcrivoSessionSolutionVersions__?: Map<string, number>;
};

const sessionListeners =
  globalSessionEvents.__transcrivoSessionListeners__ ??
  (globalSessionEvents.__transcrivoSessionListeners__ = new Map<string, Set<SessionEventListener>>());

const sessionSequences =
  globalSessionEvents.__transcrivoSessionSequences__ ??
  (globalSessionEvents.__transcrivoSessionSequences__ = new Map<string, number>());

const sessionSolutionListeners =
  globalSessionEvents.__transcrivoSessionSolutionListeners__ ??
  (globalSessionEvents.__transcrivoSessionSolutionListeners__ = new Map<
    string,
    Set<SessionSolutionEventListener>
  >());

const sessionSolutionVersions =
  globalSessionEvents.__transcrivoSessionSolutionVersions__ ??
  (globalSessionEvents.__transcrivoSessionSolutionVersions__ = new Map<string, number>());

export function getLastPublishedSessionSequence(sessionId: string) {
  return sessionSequences.get(sessionId) ?? 0;
}

export function publishSessionEvent(event: SessionEvent) {
  sessionSequences.set(
    event.sessionId,
    Math.max(getLastPublishedSessionSequence(event.sessionId), event.sequence),
  );

  const listeners = sessionListeners.get(event.sessionId);

  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
}

export function getLastPublishedSessionSolutionVersion(sessionId: string) {
  return sessionSolutionVersions.get(sessionId) ?? 0;
}

export function publishSessionSolutionEvent(event: SessionSolutionEvent) {
  sessionSolutionVersions.set(
    event.payload.sessionId,
    Math.max(
      getLastPublishedSessionSolutionVersion(event.payload.sessionId),
      event.payload.version,
    ),
  );

  const listeners = sessionSolutionListeners.get(event.payload.sessionId);

  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
}

export async function* subscribeToSessionEvents(
  sessionId: string,
  signal?: AbortSignal,
) {
  const queue: SessionEvent[] = [];
  let notify: (() => void) | null = null;

  const listener: SessionEventListener = (event) => {
    queue.push(event);
    notify?.();
    notify = null;
  };

  const listeners = sessionListeners.get(sessionId) ?? new Set<SessionEventListener>();
  listeners.add(listener);
  sessionListeners.set(sessionId, listeners);

  const onAbort = () => {
    notify?.();
    notify = null;
  };

  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }

      while (queue.length > 0) {
        const nextEvent = queue.shift();

        if (nextEvent) {
          yield nextEvent;
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    listeners.delete(listener);

    if (listeners.size === 0) {
      sessionListeners.delete(sessionId);
    }
  }
}

export async function* subscribeToSessionSolutionEvents(
  sessionId: string,
  signal?: AbortSignal,
) {
  const queue: SessionSolutionEvent[] = [];
  let notify: (() => void) | null = null;

  const listener: SessionSolutionEventListener = (event) => {
    queue.push(event);
    notify?.();
    notify = null;
  };

  const listeners =
    sessionSolutionListeners.get(sessionId) ?? new Set<SessionSolutionEventListener>();
  listeners.add(listener);
  sessionSolutionListeners.set(sessionId, listeners);

  const onAbort = () => {
    notify?.();
    notify = null;
  };

  signal?.addEventListener("abort", onAbort);

  try {
    while (!signal?.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }

      while (queue.length > 0) {
        const nextEvent = queue.shift();

        if (nextEvent) {
          yield nextEvent;
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    listeners.delete(listener);

    if (listeners.size === 0) {
      sessionSolutionListeners.delete(sessionId);
    }
  }
}
