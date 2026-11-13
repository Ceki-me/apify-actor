/**
 * Session acquisition: reuse a live session for the target browser if one
 * exists, otherwise rent a fresh one.
 *
 * Why not just `rent()` every time? The relay's rent path has a 5-minute
 * staleness window (`renterRouter.ts`, `5 * 60_000`): a session older than
 * that is treated as stale and replaced, which throws away the warmed profile.
 * `resume()` has no such age check — it only verifies ownership and that the
 * session has not ended. So we look the session up first and resume it, which
 * is what preserves the profile across runs.
 */
import type { Browser, Client } from '@ceki/sdk';

export interface AcquiredSession {
  browser: Browser;
  scheduleId: number;
  sessionId: string;
  resumed: boolean;
}

/**
 * Find a live session for `scheduleId` belonging to us, newest first.
 * Returns null when there is nothing to resume.
 */
export async function findLiveSession(
  client: Client,
  scheduleId: number,
): Promise<string | null> {
  let sessions;
  try {
    sessions = await client.listSessions({ active: true, limit: 50 });
  } catch {
    // Listing is an optimisation — failing to list should not fail the run.
    // Fall through to a fresh rent.
    return null;
  }

  const candidates = sessions
    .filter((s) => Number(s.schedule_id) === scheduleId && !s.ended_at)
    // Newest first: the most recently started session has the warmest profile.
    .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));

  const [newest] = candidates;
  return newest !== undefined ? String(newest.id) : null;
}

/**
 * Resume the live session when there is one, else rent.
 *
 * Resume failure is not fatal: the session may have ended between the listing
 * and the resume call (provider went offline, budget exhausted, user stopped
 * it). In that case we fall back to a fresh rent rather than surfacing an
 * error the caller cannot act on.
 */
export async function acquireSession(
  client: Client,
  scheduleId: number,
): Promise<AcquiredSession> {
  const existing = await findLiveSession(client, scheduleId);

  if (existing !== null) {
    try {
      const browser = await client.resume(existing);
      return { browser, scheduleId, sessionId: browser.sessionId, resumed: true };
    } catch {
      // Ended or lost between list and resume — rent a fresh one below.
    }
  }

  const browser = await client.rent(scheduleId);
  return { browser, scheduleId, sessionId: browser.sessionId, resumed: false };
}
