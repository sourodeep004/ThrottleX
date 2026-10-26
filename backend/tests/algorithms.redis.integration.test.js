
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/config/redis.js";

import { consumeSlidingWindow } from "../src/algorithms/slidingWindow.js";
import { consumeTokenBucket } from "../src/algorithms/tokenBucket.js";

const testKeys = new Set();

function createTestKey(algorithm) {
  const key = `throttlex:test:${algorithm}:${randomUUID()}`;
  testKeys.add(key);
  return key;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ThrottleX Redis algorithm integration", () => {
  beforeAll(async () => {
    await connectRedis();
  });

  afterEach(async () => {
    if (testKeys.size > 0 && redisClient.isReady) {
      await redisClient.del([...testKeys]);
    }

    testKeys.clear();
  });

  afterAll(async () => {
    await disconnectRedis();
  });

  describe("Sliding Window", () => {
    it("allows requests up to the configured limit", async () => {
      const key = createTestKey("sliding");
      const options = { key, windowMs: 60_000, limit: 3 };

      const results = await Promise.all([
        consumeSlidingWindow(options),
        consumeSlidingWindow(options),
        consumeSlidingWindow(options),
      ]);

      expect(results.every((result) => result.allowed)).toBe(true);
      expect(results.map((result) => result.count).sort()).toEqual([
        1, 2, 3,
      ]);
    });

    it("rejects requests beyond the configured limit", async () => {
      const key = createTestKey("sliding");
      const options = { key, windowMs: 60_000, limit: 3 };

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          consumeSlidingWindow(options)
        )
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      expect(results.filter((result) => !result.allowed)).toHaveLength(7);

      for (const result of results.filter((item) => !item.allowed)) {
        expect(result.remaining).toBe(0);
        expect(result.retryAfterMs).toBeGreaterThan(0);
      }
    });

    it("keeps different client keys isolated", async () => {
      const keyA = createTestKey("sliding");
      const keyB = createTestKey("sliding");
      const options = { windowMs: 60_000, limit: 1 };

      const firstA = await consumeSlidingWindow({
        ...options,
        key: keyA,
      });

      const secondA = await consumeSlidingWindow({
        ...options,
        key: keyA,
      });

      const firstB = await consumeSlidingWindow({
        ...options,
        key: keyB,
      });

      expect(firstA.allowed).toBe(true);
      expect(secondA.allowed).toBe(false);
      expect(firstB.allowed).toBe(true);
    });

    it("rejects invalid limits before accessing Redis", async () => {
      await expect(
        consumeSlidingWindow({
          key: createTestKey("sliding"),
          limit: 0,
        })
      ).rejects.toThrow("limit must be a positive safe integer");
    });

    it("allows a request again after the sliding window expires", async () => {
      const key = createTestKey("sliding");
      const options = {
        key,
        windowMs: 200,
        limit: 1,
      };

      const first = await consumeSlidingWindow(options);
      expect(first.allowed).toBe(true);

      const rejected = await consumeSlidingWindow(options);
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfterMs).toBeGreaterThan(0);

      // Wait beyond the original request's sliding window.
      await wait(300);

      const afterExpiry = await consumeSlidingWindow(options);
      expect(afterExpiry.allowed).toBe(true);
      expect(afterExpiry.count).toBe(1);
    });
  });

  describe("Token Bucket", () => {
    it("allows requests up to the bucket capacity", async () => {
      const key = createTestKey("bucket");
      const options = {
        key,
        capacity: 3,
        refillTokens: 3,
        refillIntervalMs: 60_000,
      };

      const results = await Promise.all([
        consumeTokenBucket(options),
        consumeTokenBucket(options),
        consumeTokenBucket(options),
      ]);

      expect(results.every((result) => result.allowed)).toBe(true);
    });

    it("rejects requests beyond the bucket capacity", async () => {
      const key = createTestKey("bucket");
      const options = {
        key,
        capacity: 3,
        refillTokens: 3,
        refillIntervalMs: 60_000,
      };

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          consumeTokenBucket(options)
        )
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      expect(results.filter((result) => !result.allowed)).toHaveLength(7);

      for (const result of results.filter((item) => !item.allowed)) {
        expect(result.remaining).toBe(0);
        expect(result.retryAfterMs).toBeGreaterThan(0);
      }
    });

    it("keeps different client keys isolated", async () => {
      const keyA = createTestKey("bucket");
      const keyB = createTestKey("bucket");

      const options = {
        capacity: 1,
        refillTokens: 1,
        refillIntervalMs: 60_000,
      };

      const firstA = await consumeTokenBucket({
        ...options,
        key: keyA,
      });

      const secondA = await consumeTokenBucket({
        ...options,
        key: keyA,
      });

      const firstB = await consumeTokenBucket({
        ...options,
        key: keyB,
      });

      expect(firstA.allowed).toBe(true);
      expect(secondA.allowed).toBe(false);
      expect(firstB.allowed).toBe(true);
    });

    it("rejects a cost greater than the bucket capacity", async () => {
      await expect(
        consumeTokenBucket({
          key: createTestKey("bucket"),
          capacity: 2,
          refillTokens: 2,
          refillIntervalMs: 60_000,
          cost: 3,
        })
      ).rejects.toThrow("cost cannot exceed bucket capacity");
    });

    it("allows a request again after the bucket refills", async () => {
      const key = createTestKey("bucket");
      const options = {
        key,
        capacity: 1,
        refillTokens: 1,
        refillIntervalMs: 150,
      };

      const first = await consumeTokenBucket(options);
      expect(first.allowed).toBe(true);

      const rejected = await consumeTokenBucket(options);
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfterMs).toBeGreaterThan(0);

      // Allow enough time for at least one token to refill.
      await wait(250);

      const afterRefill = await consumeTokenBucket(options);
      expect(afterRefill.allowed).toBe(true);
    });
  });
});
