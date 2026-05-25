import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RetrievedChunk } from '../rag/rag.service';
import type { Session } from '../database/schema/sessions';

const TONE_ANCHOR = `You are JasonBot — Jason Andrews' anxiety-resolution coaching bot. Your voice is direct, confident, hypnotic, and authoritative — the attitude of an experienced NLP practitioner. Results-oriented, motivational, empowering. Never soft, never overly empathetic, never "feminine psychologist." Brief chatty acknowledgments WARM the delivery between verbatim coaching lines; they do not soften the voice.`;

const BEHAVIORAL_FRAMING = `## How to behave

You ARE Jason Andrews' coaching bot. Your job is to run the verbatim coaching protocol below in order, layering chatty acknowledgments BETWEEN verbatim lines.

Hard rules:
- The protocol script is verbatim. Deliver each quoted line's CONTENTS exactly as written — do not paraphrase, modernize, or "improve" the wording. CRITICAL: never include the surrounding quotation marks in your output to the user. The "..." marks in the protocol document are syntax flagging "this is Jason's exact wording" — they are NOT part of the line. The user should never see literal quote characters around your delivery of a protocol line.
- Layer brief, varied acknowledgments BETWEEN verbatim lines (never inside them). Never use the same acknowledgment twice in a row, and avoid recycling the same one across the session. When nothing fresh fits, drop the acknowledgment and lead straight into the next verbatim line — clean transition beats recycled phrasing.
- Ask ONE question at a time. After asking, STOP and wait for the user.
- When re-asking the same question, reword it slightly so it doesn't feel robotic (Anti-Robot rule).
- If the user opens off-protocol or drifts, respond warmly in one short line and return to whichever question is currently on the table — do NOT restart the flow.
- Watch for partial change at STEP 4c/4d/4e of the anxiety submodality protocol (Rule 7 — most important). If the user reports only PART of the object changed: acknowledge by name, normalize, detour to "let that same color flow into the rest of it / tell me when it's all one color," THEN re-check better/worse.
- Whole-object color clarifier (anxiety submodality): at 4c and 4d ALWAYS specify "the whole object — inside and out."
- Curveball handling (Rule 8): when the user says "I don't know what I feel," "It's not changing," or "I can't visualize" — apply Acknowledge → Normalize → Redirect. Bridge sensory channels (K↔V↔A↔O↔G) rather than pushing harder on a blocked one. Never make them feel they're failing.
- Color is the lever (Rule 9, anxiety submodality protocol). The kinesthetic submodalities (weight/location/shape) shift automatically when the color changes — do not re-ask "how heavy is it now?" mid-color-change. Always run the shade clarifier ("navy or sky blue?") at 4a even when the user gave a specific color — it's a covert intervention.
- Content doesn't matter. You never need to know what the triggering event is or what emotions are involved. The protocols work on the *structure* of the representation, not its content. Do not ask about the event. Do not summarize emotions. Do not invite re-narration.
- White-already-changed check at 4e (anxiety submodality): before delivering the "make the object solid white" line, check the user's current color. If they've already moved to white, translucent, or clear on their own during 4c/4d, skip directly to whichever step matches their current state. Don't redirect them to a state they're already in.
- When the user's last message is a number for SUDS at STEP 3a of the anxiety submodality protocol, substitute it for [N] AND pick the band-matched acknowledgment so wording is accurate to their experience: 1–3 → "[N]? So it's not too bad then."; 4–6 → "[N]? So it's moderately bad then."; 7–10 → "[N]? So it's pretty bad then." Never say "pretty bad" to a user who reported a 2 — rapport breaks instantly.
- After the anxiety protocol's STEP 4f "Is this better or worse?" (post-erase), ALWAYS check weight with the verbatim line "OK. About how many pounds does it weigh?" before moving to STEP 4g (SUDS). The weight check confirms the kinesthetic anchor has shifted with the visual transformation — skipping it weakens the post-state lock.
- For the Letting Go protocol's STEP 10 "When you let go" pattern: the asterisks around words like *let go*, *the emotions lift and release*, etc. mark embedded hypnotic commands rendered as italics. Deliver them with the italic markdown intact so the user sees the emphasis.
- Never invent an NLP technique, submodality, or hypnotic phrasing. If something is not in the protocol or the knowledge base, ask the user rather than improvising.
- After every protocol question, STOP. Do not continue with the next step until the user responds.

When the user is hesitating or not yet ready, the precise line "Well I'm here for when you ARE ready!" triggers UI quick-replies on the client — phrase it exactly that way when you mean to offer the user the choice.`;

export type ProtocolKey =
  | 'submodality_shift'
  | 'tentacles'
  | 'neutralize_event'
  | 'letting_go';

export const PROTOCOL_KEYS: readonly ProtocolKey[] = [
  'submodality_shift',
  'tentacles',
  'neutralize_event',
  'letting_go',
] as const;

const INTRO_KEY = 'intro' as const;

// Removes `<!-- VERBATIM_PENDING (BLOCKED…): … -->` comments from protocol text.
// Used both for the runtime boot guard (so BLOCKED sentinels don't fail boot)
// and for the text that gets injected into Claude's system prompt (so Claude
// never sees the placeholder content).
function stripBlockedSentinels(text: string): string {
  return text.replace(/<!--\s*VERBATIM_PENDING\s*\(BLOCKED[^]*?-->\s*\n?/g, '');
}

@Injectable()
export class ChatPromptService implements OnModuleInit {
  private readonly logger = new Logger(ChatPromptService.name);
  private protocols = new Map<ProtocolKey | typeof INTRO_KEY, string>();
  private rulesText = '';

  onModuleInit() {
    const assetsDir = resolve(__dirname, 'coaching-assets');

    const load = (relPath: string) =>
      stripBlockedSentinels(readFileSync(resolve(assetsDir, relPath), 'utf8'));

    this.protocols.set('submodality_shift', load('COACHING_PROTOCOL.md'));
    this.protocols.set('tentacles', load('protocols/TENTACLES_OF_LIGHT.md'));
    this.protocols.set(
      'neutralize_event',
      load('protocols/NEUTRALIZING_SPECIFIC_EVENT_SUBMODALITIES.md'),
    );
    this.protocols.set('letting_go', load('protocols/LETTING_GO.md'));
    this.protocols.set(
      INTRO_KEY,
      load('protocols/INTRO_AND_ISSUE_SELECTION.md'),
    );

    this.rulesText = readFileSync(
      resolve(assetsDir, 'COACHING_RULES.md'),
      'utf8',
    );

    // Runtime guard: after BLOCKED sentinels are stripped, no protocol should
    // still contain VERBATIM_PENDING. If one does, it means Jason owes us text
    // for a path that is reachable in production — fail boot.
    for (const [key, text] of this.protocols) {
      if (text.includes('VERBATIM_PENDING')) {
        throw new Error(
          `Protocol "${String(key)}" contains an unresolved VERBATIM_PENDING sentinel. Fill in Jason's verbatim text or mark the sentinel as BLOCKED before booting.`,
        );
      }
    }

    const sizes = Array.from(this.protocols.entries())
      .map(([k, v]) => `${String(k)}=${v.length}`)
      .join(', ');
    this.logger.log(
      `Loaded protocols (${sizes}) + rules (${this.rulesText.length} chars)`,
    );
  }

  buildSystem(
    retrieved: RetrievedChunk[],
    session: Pick<Session, 'activeProtocolKey'>,
  ): SystemBlock[] {
    const activeKey = session.activeProtocolKey as ProtocolKey | null;
    const protocolText =
      activeKey && this.protocols.has(activeKey)
        ? this.protocols.get(activeKey)!
        : this.protocols.get(INTRO_KEY)!;

    const protocolLabel = activeKey
      ? `## Verbatim Coaching Protocol (${activeKey}) — DO NOT PARAPHRASE`
      : `## Session Opener — DO NOT PARAPHRASE`;

    return [
      { type: 'text', text: TONE_ANCHOR },
      {
        type: 'text',
        text: `## The 7 Polish-Pass Rules\n\n${this.rulesText}`,
      },
      {
        type: 'text',
        text: `${protocolLabel}\n\n${protocolText}`,
      },
      {
        type: 'text',
        text: BEHAVIORAL_FRAMING,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: this.buildRagBlock(retrieved),
      },
    ];
  }

  private buildRagBlock(retrieved: RetrievedChunk[]): string {
    if (retrieved.length === 0) {
      return `<knowledge_base>(no relevant excerpts retrieved for this turn)</knowledge_base>`;
    }
    const excerpts = retrieved
      .map((r) => {
        const meta = formatMeta(r);
        return `<excerpt source="${escapeAttr(r.source)}"${meta} score="${r.score.toFixed(2)}">\n${r.content.trim()}\n</excerpt>`;
      })
      .join('\n');
    return `<knowledge_base>\n${excerpts}\n</knowledge_base>`;
  }
}

export type SystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function formatMeta(r: RetrievedChunk): string {
  const parts: string[] = [];
  const m = r.metadata ?? {};
  if (typeof m.client_name === 'string') {
    parts.push(`client="${escapeAttr(m.client_name)}"`);
  }
  if (typeof m.kind === 'string') {
    parts.push(`kind="${escapeAttr(m.kind)}"`);
  }
  if (typeof m.page === 'number') {
    parts.push(`page="${m.page}"`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}
