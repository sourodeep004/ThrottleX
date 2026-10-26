
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/config/redis.js";

import { consumeSlidingWindow } from "../src/algorithms/slidingWindow.js";
import { consumeTokenBucket } from "../src/algorithms/tokenBucket.js";

const testPrefix = `throttlex:test:enforcement:${randomUUID()}`;

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  try {
    let cursor = "0";

    do {
      const result = await redisClient.scan(cursor, {
        MATCH: `${testPrefix}:*`,
        COUNT: 100,
      });

      cursor = result.cursor;

      if (result.keys.length > 0) {
        await redisClient.del(result.keys);
      }
    } while (cursor !== "0");
  } finally {
    await disconnectRedis();
  }
});

describe("ThrottleX rate-limit enforcement", () => {
  describe("Sliding Window", () => {
    it("never accepts more than the limit under concurrent requests", async () => {
      const key = `${testPrefix}:sliding:concurrent`;
      const limit = 5;

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          consumeSlidingWindow({
            key,
            windowMs: 60_000,
            limit,
          })
        )
      );

      const accepted = results.filter((result) => result.allowed);
      const rejected = results.filter((result) => !result.allowed);

      expect(accepted).toHaveLength(limit);
      expect(rejected).toHaveLength(15);
      expect(accepted.every((result) => result.remaining >= 0)).toBe(true);
      expect(rejected.every((result) => result.retryAfterMs > 0)).toBe(true);
    });

    it("keeps separate client keys isolated", async () => {
      const clientA = `${testPrefix}:sliding:client-a`;
      const clientB = `${testPrefix}:sliding:client-b`;

      for (let i = 0; i < 5; i++) {
        const result = await consumeSlidingWindow({
          key: clientA,
          windowMs: 60_000,
          limit: 5,
        });

        expect(result.allowed).toBe(true);
      }

      const blockedA = await consumeSlidingWindow({
        key: clientA,
        windowMs: 60_000,
        limit: 5,
      });

      const allowedB = await consumeSlidingWindow({
        key: clientB,
        windowMs: 60_000,
        limit: 5,
      });

      expect(blockedA.allowed).toBe(false);
      expect(allowedB.allowed).toBe(true);
    });
  });

  describe("Token Bucket", () => {
    it("never accepts more requests than its initial capacity", async () => {
      const key = `${testPrefix}:bucket:concurrent`;
      const capacity = 5;

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          consumeTokenBucket({
            key,
            capacity,
            refillTokens: 1,
            refillIntervalMs: 60_000,
          })
        )
      );

      const accepted = results.filter((result) => result.allowed);
      const rejected = results.filter((result) => !result.allowed);

      expect(accepted).toHaveLength(capacity);
      expect(rejected).toHaveLength(15);
      expect(rejected.every((result) => result.retryAfterMs > 0)).toBe(true);
    });

    it("keeps separate client buckets isolated", async () => {
      const clientA = `${testPrefix}:bucket:client-a`;
      const clientB = `${testPrefix}:bucket:client-b`;

      for (let i = 0; i < 5; i++) {
        const result = await consumeTokenBucket({
          key: clientA,
          capacity: 5,
          refillTokens: 1,
          refillIntervalMs: 60_000,
        });

        expect(result.allowed).toBe(true);
      }

      const blockedA = await consumeTokenBucket({
        key: clientA,
        capacity: 5,
        refillTokens: 1,
        refillIntervalMs: 60_000,
      });

      const allowedB = await consumeTokenBucket({
        key: clientB,
        capacity: 5,
        refillTokens: 1,
        refillIntervalMs: 60_000,
      });

      expect(blockedA.allowed).toBe(false);
      expect(allowedB.allowed).toBe(true);
    });
  });
});
