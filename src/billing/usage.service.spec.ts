import { ConfigService } from '@nestjs/config';
import { UsageService } from './usage.service';
import type { Subscription } from '../database/schema/subscriptions';

type SubFixture = Pick<
  Subscription,
  'plan' | 'status' | 'betaAccessExpiresAt'
> | null;

const DAY_MS = 86_400_000;
const DAILY_LIMIT = 10;

function makeService(sub: SubFixture, initialCount = 0) {
  const state = { count: initialCount };

  const subRow = () =>
    sub
      ? [
          {
            ...sub,
            id: 'sub-1',
            userId: 'user-1',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      : [];

  const db = {
    select: (projection?: unknown) => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(projection ? [{ count: state.count }] : subRow()),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            state.count += 1;
            return Promise.resolve([{ count: state.count }]);
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          state.count -= 1;
          return Promise.resolve();
        },
      }),
    }),
  };

  const config = {
    getOrThrow: (key: string) => {
      if (key === 'FREE_TIER_DAILY_MESSAGE_LIMIT') return DAILY_LIMIT;
      throw new Error(`unexpected config key: ${key}`);
    },
  };

  const svc = new UsageService(db as any, config as unknown as ConfigService);
  return { svc, state };
}

describe('UsageService.recordAndCheckMessage — free + newsletter model', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows beyond daily limit during active beta', async () => {
    const { svc } = makeService(
      {
        plan: 'free',
        status: 'none',
        betaAccessExpiresAt: new Date(Date.now() + 5 * DAY_MS),
      },
      DAILY_LIMIT,
    );
    const result = await svc.recordAndCheckMessage('user-1');
    expect(result.isPaid).toBe(true);
    expect(result.usageToday).toBe(DAILY_LIMIT + 1);
  });

  it('still allows beyond the legacy daily limit after beta has expired', async () => {
    const { svc } = makeService(
      {
        plan: 'free',
        status: 'none',
        betaAccessExpiresAt: new Date(Date.now() - DAY_MS),
      },
      DAILY_LIMIT,
    );
    const result = await svc.recordAndCheckMessage('user-1');
    expect(result.isPaid).toBe(true);
    expect(result.usageToday).toBe(DAILY_LIMIT + 1);
  });

  it('still allows when beta_access_expires_at is null (legacy users)', async () => {
    const { svc } = makeService(
      { plan: 'free', status: 'none', betaAccessExpiresAt: null },
      DAILY_LIMIT,
    );
    const result = await svc.recordAndCheckMessage('user-1');
    expect(result.isPaid).toBe(true);
  });
});

describe('UsageService.snapshot', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes betaAccessExpiresAt during active beta', async () => {
    const expires = new Date(Date.now() + 10 * DAY_MS);
    const { svc } = makeService(
      { plan: 'free', status: 'none', betaAccessExpiresAt: expires },
      3,
    );
    const snap = await svc.snapshot('user-1');
    expect(snap.isPaid).toBe(true);
    expect(snap.betaAccessExpiresAt).toBe(expires.toISOString());
    expect(snap.remainingToday).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports unlimited even after beta expiry', async () => {
    const { svc } = makeService(
      {
        plan: 'free',
        status: 'none',
        betaAccessExpiresAt: new Date(Date.now() - DAY_MS),
      },
      4,
    );
    const snap = await svc.snapshot('user-1');
    expect(snap.isPaid).toBe(true);
    expect(snap.remainingToday).toBe(Number.POSITIVE_INFINITY);
  });
});
