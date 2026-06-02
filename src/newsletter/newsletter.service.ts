import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const KIT_API_BASE = 'https://api.kit.com/v4';
const REQUEST_TIMEOUT_MS = 5_000;

export type KitSubscriberState =
  | 'active'
  | 'inactive'
  | 'bounced'
  | 'complained'
  | 'cancelled';

export type SubscribeResult =
  | {
      ok: true;
      subscriberId: number;
      state: KitSubscriberState;
      alreadyOnForm: boolean;
      tagged: boolean;
    }
  | { ok: false; error: string };

export type LookupResult =
  | { ok: true; found: false }
  | {
      ok: true;
      found: true;
      subscriberId: number;
      state: KitSubscriberState;
    }
  | { ok: false; error: string };

type CreateSubscriberOk = {
  ok: true;
  subscriberId: number;
  state: KitSubscriberState;
  alreadyOnForm: boolean;
};

type CreateSubscriberErr = { ok: false; error: string };

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(private readonly config: ConfigService) {}

  private credentials(): { apiKey: string; tagId: string } | null {
    const apiKey = this.config.get<string>('CONVERTKIT_API_SECRET');
    const tagId = this.config.get<string>('CONVERTKIT_TAG_ID');
    if (!apiKey || !tagId) return null;
    return { apiKey, tagId };
  }

  /**
   * Two-step Kit v4 flow because Kit v4 has no single "subscribe to tag by
   * email" endpoint:
   *   1. POST /v4/subscribers      → upsert subscriber, get subscriber.id
   *   2. POST /v4/tags/{id}/subscribers/{subscriber_id} → tag them
   * Step 2 is best-effort: if it fails, we still consider the subscribe a
   * success because the subscriber is in Kit (Jason can add the tag manually
   * or via a Kit automation). The reconciler refreshes state separately.
   */
  async subscribeToForm(
    email: string,
    firstName?: string | null,
  ): Promise<SubscribeResult> {
    const creds = this.credentials();
    if (!creds) {
      this.logger.warn(
        { email },
        'Kit credentials missing — skipping newsletter subscribe',
      );
      return { ok: false, error: 'missing_credentials' };
    }

    const created = await this.createSubscriber(creds.apiKey, email, firstName);
    if (!created.ok) return created;

    const tagged = await this.tagSubscriber(
      creds.apiKey,
      creds.tagId,
      created.subscriberId,
      email,
    );

    // The tag response carries the freshest subscriber.state; prefer it when
    // the tag step succeeded and returned one.
    const finalState: KitSubscriberState =
      tagged.ok && tagged.state ? tagged.state : created.state;

    return {
      ok: true,
      subscriberId: created.subscriberId,
      state: finalState,
      alreadyOnForm: created.alreadyOnForm,
      tagged: tagged.ok,
    };
  }

  async getSubscriberByEmail(email: string): Promise<LookupResult> {
    const creds = this.credentials();
    if (!creds) return { ok: false, error: 'missing_credentials' };

    try {
      const url = new URL(`${KIT_API_BASE}/subscribers`);
      url.searchParams.set('email_address', email);
      // Kit v4 defaults status=active — must opt into 'all' or we'll miss
      // inactive/cancelled/bounced/complained and falsely report "not found".
      url.searchParams.set('status', 'all');

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'X-Kit-Api-Key': creds.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await safeReadBody(response);
        this.logger.warn(
          { email, status: response.status, body },
          'Kit subscriber lookup returned non-2xx',
        );
        return { ok: false, error: `http_${response.status}` };
      }

      const parsed = (await response.json()) as {
        subscribers?: Array<{ id?: number; state?: KitSubscriberState }>;
      };
      const first = parsed?.subscribers?.[0];
      if (!first?.id || !first.state) return { ok: true, found: false };
      return {
        ok: true,
        found: true,
        subscriberId: first.id,
        state: first.state,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ email, err: message }, 'Kit subscriber lookup failed');
      return { ok: false, error: message };
    }
  }

  private async createSubscriber(
    apiKey: string,
    email: string,
    firstName?: string | null,
  ): Promise<CreateSubscriberOk | CreateSubscriberErr> {
    const url = `${KIT_API_BASE}/subscribers`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Kit-Api-Key': apiKey,
        },
        body: JSON.stringify({
          email_address: email,
          first_name: firstName ?? undefined,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const alreadyOnForm = response.status === 200;
      const newlyAdded = response.status === 201;

      if (!alreadyOnForm && !newlyAdded) {
        const body = await safeReadBody(response);
        this.logger.warn(
          { email, url, status: response.status, body },
          'Kit create subscriber returned non-2xx',
        );
        return { ok: false, error: `http_${response.status}` };
      }

      const parsed = (await response.json()) as {
        subscriber?: { id?: number; state?: KitSubscriberState };
      };
      const subscriberId = parsed?.subscriber?.id;
      const state = parsed?.subscriber?.state;
      if (typeof subscriberId !== 'number' || !state) {
        this.logger.warn(
          { email, parsed },
          'Kit create subscriber response missing id or state',
        );
        return { ok: false, error: 'malformed_response' };
      }

      return { ok: true, subscriberId, state, alreadyOnForm };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ email, err: message }, 'Kit create subscriber failed');
      return { ok: false, error: message };
    }
  }

  private async tagSubscriber(
    apiKey: string,
    tagId: string,
    subscriberId: number,
    email: string,
  ): Promise<{ ok: true; state: KitSubscriberState | null } | { ok: false }> {
    const url = `${KIT_API_BASE}/tags/${tagId}/subscribers/${subscriberId}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'X-Kit-Api-Key': apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await safeReadBody(response);
        this.logger.warn(
          {
            email,
            subscriberId,
            tagId,
            url,
            status: response.status,
            body,
          },
          'Kit tag-subscriber returned non-2xx (subscriber created, but not tagged)',
        );
        return { ok: false };
      }

      // Refresh state from the tag response if Kit returned it.
      const parsed = (await response.json().catch(() => ({}))) as {
        subscriber?: { state?: KitSubscriberState };
      };
      return { ok: true, state: parsed?.subscriber?.state ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { email, subscriberId, tagId, err: message },
        'Kit tag-subscriber failed (subscriber created, but not tagged)',
      );
      return { ok: false };
    }
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
