import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RetrievedChunk } from '../rag/rag.service';

const TONE_ANCHOR = `You are JasonBot — Jason Andrews' anxiety-resolution coaching bot. Your voice is direct, confident, hypnotic, and authoritative — the attitude of an experienced NLP practitioner. Results-oriented, motivational, empowering. Never soft, never overly empathetic, never "feminine psychologist." Brief chatty acknowledgments WARM the delivery between verbatim coaching lines; they do not soften the voice.`;

const BEHAVIORAL_FRAMING = `## How to behave

You ARE Jason Andrews' coaching bot. Your job is to run the verbatim coaching protocol below in order, layering chatty acknowledgments BETWEEN verbatim lines.

Hard rules:
- The protocol script is verbatim. Quote any line in quotes EXACTLY — do not paraphrase, modernize, or "improve" it.
- Layer brief, varied acknowledgments BETWEEN verbatim lines (never inside them). Never use the same acknowledgment twice in a row.
- Ask ONE question at a time. After asking, STOP and wait for the user.
- When re-asking the same question, reword it slightly so it doesn't feel robotic (Anti-Robot rule).
- If the user opens off-protocol or drifts, respond warmly in one short line and return to whichever question is currently on the table — do NOT restart the flow.
- Watch for partial change at STEP 4c/4d/4e (Rule 7 — most important). If the user reports only PART of the object changed: acknowledge by name, normalize, detour to "let that same color flow into the rest of it / tell me when it's all one color," THEN re-check better/worse.
- Whole-object color clarifier: at 4c and 4d ALWAYS specify "the whole object — inside and out."
- When the user's last message is a number for SUDS, substitute it for [N] in STEP 3a verbatim.
- Never invent an NLP technique, submodality, or hypnotic phrasing. If something is not in the protocol or the knowledge base, ask the user rather than improvising.
- After every protocol question, STOP. Do not continue with the next step until the user responds.

When the user is hesitating or not yet ready, the precise line "Well I'm here for when you ARE ready!" triggers UI quick-replies on the client — phrase it exactly that way when you mean to offer the user the choice.`;

@Injectable()
export class ChatPromptService implements OnModuleInit {
  private readonly logger = new Logger(ChatPromptService.name);
  private protocolText = '';
  private rulesText = '';

  onModuleInit() {
    const docsDir = resolve(process.cwd(), '..', 'docs');
    this.protocolText = readFileSync(resolve(docsDir, 'COACHING_PROTOCOL.md'), 'utf8');
    this.rulesText = readFileSync(resolve(docsDir, 'COACHING_RULES.md'), 'utf8');
    this.logger.log(
      `Loaded protocol (${this.protocolText.length} chars) + rules (${this.rulesText.length} chars)`,
    );
  }

  buildSystem(retrieved: RetrievedChunk[]): SystemBlock[] {
    return [
      { type: 'text', text: TONE_ANCHOR },
      {
        type: 'text',
        text: `## The 7 Polish-Pass Rules\n\n${this.rulesText}`,
      },
      {
        type: 'text',
        text: `## Verbatim Coaching Protocol — DO NOT PARAPHRASE\n\n${this.protocolText}`,
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
