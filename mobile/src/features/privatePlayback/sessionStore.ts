export interface PrivatePlaybackSession {
  sid: string;
  itemId: string;
  title: string;
  tempUri: string;
  mimeType?: string;
  traceId?: string;
  createdAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions = new Map<string, PrivatePlaybackSession>();

function createSessionId(): string {
  return `pps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function gcExpiredSessions(now: number = Date.now()): void {
  for (const [sid, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(sid);
    }
  }
}

export function createSession(
  payload: Omit<PrivatePlaybackSession, 'sid' | 'createdAt'>
): PrivatePlaybackSession {
  gcExpiredSessions();
  const sid = createSessionId();
  const session: PrivatePlaybackSession = {
    ...payload,
    sid,
    createdAt: Date.now(),
  };
  sessions.set(sid, session);
  return session;
}

export function getSession(sid: string): PrivatePlaybackSession | null {
  if (!sid) return null;
  gcExpiredSessions();
  return sessions.get(sid) ?? null;
}

export function deleteSession(sid: string): void {
  if (!sid) return;
  sessions.delete(sid);
}
