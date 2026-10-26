
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { randomUUID } from "node:crypto";
import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/config/redis.js";

import {
  consumeSlidingWindow,
} from "../src/algorithms/slidingWindow.js";

import {
  consumeTokenBucket,
} from "../src/algorithms/tokenBucket.js";

const testKeys = [];

function createTestKey(prefix) {
  const key = `throttlex:test:${prefix}:${randomUUID()}`;
  testKeys.push(key);
  return key;
}

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  if (testKeys.length > 0) {
    await redisClient.del(testKeys);
  }

  await disconnectRedis();
});

describe("Sliding-window algorithm", () => {
  it("allows requests up to the configured limit", async () => {
    const key = createTestKey("sliding-basic");

    for (let i = 0; i < 5; i++) {
      const result = await consumeSlidingWindow({
        key,
        windowMs: 10_000,
        limit: 5,
      });

      expect(result.allowed).toBe(true);
    }
  });

  it("rejects requests beyond the limit", async () => {
    const key = createTestKey("sliding-limit");

    for (let i = 0; i < 5; i++) {
      await consumeSlidingWindow({
        key,
        windowMs: 10_000,
        limit: 5,
      });
    }

    const result = await consumeSlidingWindow({
      key,
      windowMs: 10_000,
      limit: 5,
    });

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(5);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not exceed the limit under concurrent requests", async () => {
    const key = createTestKey("sliding-concurrent");

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeSlidingWindow({
          key,
          windowMs: 10_000,
          limit: 5,
        })
      )
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(15);
  });

  it("allows a new request after the old entry expires", async () => {
    const key = createTestKey("sliding-expiry");

    await consumeSlidingWindow({
      key,
      windowMs: 150,
      limit: 1,
    });

    const blocked = await consumeSlidingWindow({
      key,
      windowMs: 150,
      limit: 1,
    });

    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const allowed = await consumeSlidingWindow({
      key,
      windowMs: 150,
      limit: 1,
    });

    expect(allowed.allowed).toBe(true);
  });
});

describe("Token-bucket algorithm", () => {
  it("allows requests up to bucket capacity", async () => {
    const key = createTestKey("bucket-basic");

    for (let i = 0; i < 5; i++) {
      const result = await consumeTokenBucket({
        key,
        capacity: 5,
        refillTokens: 1,
        refillIntervalMs: 60_000,
      });

      expect(result.allowed).toBe(true);
    }
  });

  it("rejects requests when the bucket is empty", async () => {
    const key = createTestKey("bucket-empty");

    for (let i = 0; i < 5; i++) {
      await consumeTokenBucket({
        key,
        capacity: 5,
        refillTokens: 1,
        refillIntervalMs: 60_000,
      });
    }

    const result = await consumeTokenBucket({
      key,
      capacity: 5,
      refillTokens: 1,
      refillIntervalMs: 60_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("rejects a request cost larger than bucket capacity", async () => {
    await expect(
      consumeTokenBucket({
        key: createTestKey("bucket-invalid"),
        capacity: 5,
        cost: 6,
      })
    ).rejects.toThrow("cost cannot exceed bucket capacity");
  });

  it("rejects invalid configuration", async () => {
    await expect(
      consumeTokenBucket({
        key: createTestKey("bucket-invalid-capacity"),
        capacity: 0,
      })
    ).rejects.toThrow("capacity must be a positive number");
  });
});
