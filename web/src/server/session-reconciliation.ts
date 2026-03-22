type ReconcileExpiredSessionsDependencies<TSession> = {
  listExpiredLiveSessions: (now: Date) => Promise<TSession[]>;
  expireSession: (session: TSession, now: Date) => Promise<TSession>;
};

export function createExpiredSessionReconciler<TSession>({
  listExpiredLiveSessions,
  expireSession,
}: ReconcileExpiredSessionsDependencies<TSession>) {
  return async function reconcileExpiredSessions(now: Date = new Date()) {
    const sessionsToExpire = await listExpiredLiveSessions(now);

    await Promise.all(sessionsToExpire.map((session) => expireSession(session, now)));

    return sessionsToExpire.length;
  };
}
