import { describe, expect, it, vi } from 'vitest';

import { acquireSession, findLiveSession } from '../src/session.js';
import type { Client } from '@ceki/sdk';

/** Minimal Client stub — only the two methods acquireSession touches. */
function stubClient(overrides: {
  sessions?: Array<Record<string, unknown>>;
  listSessionsThrows?: boolean;
  resumeThrows?: boolean;
}): { client: Client; resume: ReturnType<typeof vi.fn>; rent: ReturnType<typeof vi.fn> } {
  const resume = vi.fn(async (sessionId: string) => {
    if (overrides.resumeThrows) throw new Error('resume_failed: not_found');
    return { sessionId };
  });
  const rent = vi.fn(async () => ({ sessionId: 'fresh-session' }));

  const client = {
    listSessions: vi.fn(async () => {
      if (overrides.listSessionsThrows) throw new Error('network down');
      return overrides.sessions ?? [];
    }),
    resume,
    rent,
  } as unknown as Client;

  return { client, resume, rent };
}

describe('findLiveSession', () => {
  it('returns null when no sessions exist', async () => {
    const { client } = stubClient({ sessions: [] });
    expect(await findLiveSession(client, 58164)).toBeNull();
  });

  it('ignores sessions belonging to a different browser', async () => {
    const { client } = stubClient({
      sessions: [{ id: 1, schedule_id: 40693, started_at: '2026-11-13T10:00:00Z', ended_at: null }],
    });
    expect(await findLiveSession(client, 58164)).toBeNull();
  });

  it('ignores ended sessions', async () => {
    const { client } = stubClient({
      sessions: [{ id: 2, schedule_id: 58164, started_at: '2026-11-13T10:00:00Z', ended_at: '2026-11-13T10:05:00Z' }],
    });
    expect(await findLiveSession(client, 58164)).toBeNull();
  });

  it('picks the newest live session for the target browser', async () => {
    const { client } = stubClient({
      sessions: [
        { id: 10, schedule_id: 58164, started_at: '2026-11-13T09:00:00Z', ended_at: null },
        { id: 11, schedule_id: 58164, started_at: '2026-11-13T11:00:00Z', ended_at: null },
        { id: 12, schedule_id: 40693, started_at: '2026-11-13T12:00:00Z', ended_at: null },
      ],
    });
    expect(await findLiveSession(client, 58164)).toBe('11');
  });

  it('returns null instead of throwing when listing fails', async () => {
    const { client } = stubClient({ listSessionsThrows: true });
    expect(await findLiveSession(client, 58164)).toBeNull();
  });
});

describe('acquireSession', () => {
  it('resumes a live session without renting', async () => {
    const { client, resume, rent } = stubClient({
      sessions: [{ id: 11, schedule_id: 58164, started_at: '2026-11-13T11:00:00Z', ended_at: null }],
    });

    const acquired = await acquireSession(client, 58164);

    expect(resume).toHaveBeenCalledWith('11');
    expect(rent).not.toHaveBeenCalled();
    expect(acquired.resumed).toBe(true);
    expect(acquired.sessionId).toBe('11');
  });

  it('rents when there is no live session', async () => {
    const { client, resume, rent } = stubClient({ sessions: [] });

    const acquired = await acquireSession(client, 58164);

    expect(rent).toHaveBeenCalledWith(58164);
    expect(resume).not.toHaveBeenCalled();
    expect(acquired.resumed).toBe(false);
    expect(acquired.sessionId).toBe('fresh-session');
  });

  it('falls back to renting when the session dies between list and resume', async () => {
    const { client, rent } = stubClient({
      sessions: [{ id: 11, schedule_id: 58164, started_at: '2026-11-13T11:00:00Z', ended_at: null }],
      resumeThrows: true,
    });

    const acquired = await acquireSession(client, 58164);

    expect(rent).toHaveBeenCalledWith(58164);
    expect(acquired.resumed).toBe(false);
  });
});
