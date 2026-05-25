import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { sessions } from '../database/schema/sessions';
import { PROTOCOL_KEYS, type ProtocolKey } from './chat.prompt.service';

export type SelectedIssue = 'anxiety' | 'past_mistreatment';

// Order matches the rotation Jason specifies in INTRO_AND_ISSUE_SELECTION.md STEP 4c.
// First session of a given issue runs submodality_shift, second runs tentacles, etc.
// After 4, it loops.
const ROTATION: readonly ProtocolKey[] = PROTOCOL_KEYS;

/**
 * Detect an issue selection in a user's free-text message.
 *
 * Conservative regex match — we'd rather miss a selection (and re-ask) than
 * misroute someone who said something tangential. Falls through to `null`
 * if neither bucket matches.
 */
export function parseIssueFromMessage(content: string): SelectedIssue | null {
  const text = content.toLowerCase();
  // Anxiety: "anxiety", "reduce anxiety", "anxious"
  if (/\banxi(?:ety|ous)\b/.test(text)) {
    return 'anxiety';
  }
  // Past mistreatment / painful experiences from the past
  if (
    /\b(?:past[\s-]?mistreatment|mistreatment|past[\s-]?pain|painful[\s-]?experiences?|past[\s-]?(?:trauma|hurt|abuse))\b/.test(
      text,
    )
  ) {
    return 'past_mistreatment';
  }
  return null;
}

/**
 * Resolve the next protocol in the rotation for this user + issue.
 *
 * Counts the user's prior sessions where they picked this same issue AND got
 * assigned a protocol, then returns the next protocol in the rotation
 * (modulo cycle length). First-ever session for this issue → submodality_shift.
 */
export async function nextProtocolKey(
  db: Database,
  userId: string,
  issue: SelectedIssue,
): Promise<ProtocolKey> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.selectedIssue, issue),
        isNotNull(sessions.activeProtocolKey),
      ),
    );
  const completed = row?.count ?? 0;
  return ROTATION[completed % ROTATION.length];
}
