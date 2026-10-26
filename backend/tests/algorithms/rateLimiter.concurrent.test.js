import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { randomUUID } from "node:crypto";

import {
  redisClient,
  connectRedis,
  disconnectRedis,
} from "../../src/config/redis.js";

import { consumeSlidingWindow } from "../../src/algorithms/slidingWindow.js";
import { consumeTokenBucket } from "../../src/algorithms/tokenBucket.js";

const testKeys = new Set();
let testOpenedRedisConnection = false;

function createTestKey(name) {
  const key = `throttlex:test:${name}:${randomUUID()}`;
  testKeys.add(key);
  return key;
}

beforeAll(async () => {
  testOpenedRedisConnection = !redisClient.isOpen;
  await connectRedis();
});

afterAll(async () => {
  try {
    if (redisClient.isReady && testKeys.size > 0) {
      await redisClient.del([...testKeys]);
    }
  } finally {
    if (testOpenedRedisConnection) {
      await disconnectRedis();
    }
  }
});

describe("ThrottleX concurrency tests", () => {
  it("enforces the sliding-window limit under concurrent requests", async () => {
    const key = createTestKey("sliding");
    const limit = 5;

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        consumeSlidingWindow({
          key,
          windowMs: 60_000,
          limit,
        })
      )
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(45);
  });

  it("enforces token-bucket capacity under concurrent requests", async () => {
    const key = createTestKey("bucket");
    const capacity = 5;

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        consumeTokenBucket({
          key,
          capacity,
          refillTokens: 5,
          refillIntervalMs: 60_000,
          cost: 1,
        })
      )
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(45);
  });

  it("keeps independent sliding-window keys separate", async () => {
    const keyA = createTestKey("client-a");
    const keyB = createTestKey("client-b");

    const results = await Promise.all([
      ...Array.from({ length: 5 }, () =>
        consumeSlidingWindow({
          key: keyA,
          windowMs: 60_000,
          limit: 5,
        })
      ),
      ...Array.from({ length: 5 }, () =>
        consumeSlidingWindow({
          key: keyB,
          windowMs: 60_000,
          limit: 5,
        })
      ),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(10);
  });
});
