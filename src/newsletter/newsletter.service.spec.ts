import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const env: Record<string, unknown> = {
    CONVERTKIT_API_SECRET: 'kit_v4_key_abc',
    CONVERTKIT_TAG_ID: 'tag_123',
    ...overrides,
  };
  return new NewsletterService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

const subscriberPayload = (overrides: Record<string, unknown> = {}) => ({
  subscriber: {
    id: 42,
    email_address: 'user@example.com',
    state: 'active',
    first_name: 'Friend',
    ...overrides,
  },
});

const taggedPayload = (state = 'active') => ({
  subscriber: {
    id: 42,
    email_address: 'user@example.com',
    state,
    tagged_at: '2026-06-02T20:00:00Z',
  },
});

/**
 * Two-step flow:
 *   1. POST /v4/subscribers          → create or fetch subscriber, get id
 *   2. POST /v4/tags/{tag_id}/subscribers/{subscriber_id} → tag
 * The fetch mock returns these in sequence.
 */
function mockFetchSequence(...responses: Response[]) {
  let i = 0;
  return jest.fn().mockImplementation(() => {
    const r = responses[i] ?? new Response('exhausted', { status: 500 });
    i += 1;
    return Promise.resolve(r);
  });
}

describe('NewsletterService.subscribeToForm — two-step create + tag', () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it('creates (201) then tags — returns tagged: true with state from tag response', async () => {
    global.fetch = mockFetchSequence(
      new Response(JSON.stringify(subscriberPayload()), { status: 201 }),
      new Response(JSON.stringify(taggedPayload('active')), { status: 201 }),
    );
    const result = await makeService().subscribeToForm(
      'user@example.com',
      'Friend',
    );
    expect(result).toEqual({
      ok: true,
      subscriberId: 42,
      state: 'active',
      alreadyOnForm: false,
      tagged: true,
    });
  });

  it('flags alreadyOnForm when create returns 200', async () => {
    global.fetch = mockFetchSequence(
      new Response(JSON.stringify(subscriberPayload({ state: 'inactive' })), {
        status: 200,
      }),
      new Response(JSON.stringify(taggedPayload('inactive')), { status: 201 }),
    );
    const result = await makeService().subscribeToForm('user@example.com');
    expect(result).toEqual({
      ok: true,
      subscriberId: 42,
      state: 'inactive',
      alreadyOnForm: true,
      tagged: true,
    });
  });

  it('hits the correct URLs and headers in order', async () => {
    const fetchMock = mockFetchSequence(
      new Response(JSON.stringify(subscriberPayload()), { status: 201 }),
      new Response(JSON.stringify(taggedPayload()), { status: 201 }),
    );
    global.fetch = fetchMock;
    await makeService().subscribeToForm('user@example.com', 'Friend');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [createUrl, createInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(createUrl).toBe('https://api.kit.com/v4/subscribers');
    expect(createInit.method).toBe('POST');
    expect(createInit.headers).toMatchObject({
      'X-Kit-Api-Key': 'kit_v4_key_abc',
    });
    expect(JSON.parse(createInit.body as string)).toEqual({
      email_address: 'user@example.com',
      first_name: 'Friend',
    });

    const [tagUrl, tagInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(tagUrl).toBe('https://api.kit.com/v4/tags/tag_123/subscribers/42');
    expect(tagInit.method).toBe('POST');
    expect(tagInit.headers).toMatchObject({
      'X-Kit-Api-Key': 'kit_v4_key_abc',
    });
  });

  it('returns ok:true with tagged:false when create succeeds but tag fails', async () => {
    global.fetch = mockFetchSequence(
      new Response(JSON.stringify(subscriberPayload()), { status: 201 }),
      new Response('{"errors":["Not Found"]}', { status: 404 }),
    );
    const result = await makeService().subscribeToForm('user@example.com');
    expect(result).toEqual({
      ok: true,
      subscriberId: 42,
      state: 'active',
      alreadyOnForm: false,
      tagged: false,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns ok:false on a 422 create failure and does NOT call tag', async () => {
    const fetchMock = mockFetchSequence(
      new Response('{"errors":["email required"]}', { status: 422 }),
    );
    global.fetch = fetchMock;
    const result = await makeService().subscribeToForm('');
    expect(result).toEqual({ ok: false, error: 'http_422' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns ok:false when create throws — never bubbles', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await makeService().subscribeToForm('user@example.com');
    expect(result.ok).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns ok:false without calling fetch when credentials are missing', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const result = await makeService({
      CONVERTKIT_API_SECRET: undefined,
    }).subscribeToForm('user@example.com');
    expect(result).toEqual({ ok: false, error: 'missing_credentials' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns malformed_response when create body lacks subscriber.id', async () => {
    global.fetch = mockFetchSequence(
      new Response(JSON.stringify({ subscriber: {} }), { status: 201 }),
    );
    const result = await makeService().subscribeToForm('user@example.com');
    expect(result).toEqual({ ok: false, error: 'malformed_response' });
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('NewsletterService.getSubscriberByEmail', () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it('passes status=all so inactive/cancelled subscribers are visible', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ subscribers: [{ id: 7, state: 'inactive' }] }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock;
    const result = await makeService().getSubscriberByEmail('user@example.com');
    expect(result).toEqual({
      ok: true,
      found: true,
      subscriberId: 7,
      state: 'inactive',
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(calledUrl)).toContain('status=all');
    expect(String(calledUrl)).toContain('email_address=user%40example.com');
  });

  it('returns found:false on an empty subscribers array', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{"subscribers":[]}', { status: 200 }));
    const result =
      await makeService().getSubscriberByEmail('nobody@example.com');
    expect(result).toEqual({ ok: true, found: false });
  });

  it('returns ok:false on non-2xx', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 }));
    const result = await makeService().getSubscriberByEmail('user@example.com');
    expect(result).toEqual({ ok: false, error: 'http_500' });
    expect(warnSpy).toHaveBeenCalled();
  });
});
