
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/config/redis.js";

import { consumeSlidingWindow } from "../src/algorithms/slidingWindow.js";
import { consumeTokenBucket } from "../src/algorithms/tokenBucket.js";
import { algorithmRateLimiter } from "../src/middleware/algorithmRateLimiter.js";

const testPrefix = `throttlex:test:http:${randomUUID()}`;

const TEST_LIMIT = 3;
const TEST_WINDOW_MS = 60_000;

const app = express();

app.disable("x-powered-by");
app.use(express.json());

/**
 * Gives each simulated client an independent rate-limit identity.
 * This helper is only used by this test application.
 */
function testClientKey(req) {
  return req.get("x-test-client") || "anonymous-test-client";
}

app.get(
  "/sliding-window",
  algorithmRateLimiter({
    algorithm: (options) =>
      consumeSlidingWindow({
        ...options,
        windowMs: TEST_WINDOW_MS,
        limit: TEST_LIMIT,
      }),
    keyPrefix: `${testPrefix}:sliding`,
    keyGenerator: testClientKey,
    limit: TEST_LIMIT,
  }),
  (_req, res) => {
    res.status(200).json({
      success: true,
      algorithm: "sliding-window",
      message: "Request accepted",
    });
  }
);

app.get(
  "/token-bucket",
  algorithmRateLimiter({
    algorithm: (options) =>
      consumeTokenBucket({
        ...options,
        capacity: TEST_LIMIT,
        refillTokens: 1,
        refillIntervalMs: TEST_WINDOW_MS,
      }),
    keyPrefix: `${testPrefix}:bucket`,
    keyGenerator: testClientKey,
    limit: TEST_LIMIT,
  }),
  (_req, res) => {
    res.status(200).json({
      success: true,
      algorithm: "token-bucket",
      message: "Request accepted",
    });
  }
);

/**
 * Removes only the Redis keys created by this test file.
 */
async function clearTestKeys() {
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
}

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  try {
    await clearTestKeys();
  } finally {
    await disconnectRedis();
  }
});

describe("ThrottleX HTTP rate-limit enforcement", () => {
  describe("Sliding Window", () => {
    it("accepts requests within the limit and rejects the next request with HTTP 429", async () => {
      const clientId = "sliding-basic";

      for (let i = 0; i < TEST_LIMIT; i++) {
        const response = await request(app)
          .get("/sliding-window")
          .set("X-Test-Client", clientId);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.headers["ratelimit-limit"]).toBe(
          String(TEST_LIMIT)
        );
      }

      const blocked = await request(app)
        .get("/sliding-window")
        .set("X-Test-Client", clientId);

      expect(blocked.status).toBe(429);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(blocked.headers["ratelimit-remaining"]).toBe("0");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("enforces the limit under concurrent HTTP requests", async () => {
      const clientId = "sliding-concurrent";
      const requestCount = 20;

      const responses = await Promise.all(
        Array.from({ length: requestCount }, () =>
          request(app)
            .get("/sliding-window")
            .set("X-Test-Client", clientId)
        )
      );

      const accepted = responses.filter(
        (response) => response.status === 200
      );

      const rejected = responses.filter(
        (response) => response.status === 429
      );

      expect(accepted).toHaveLength(TEST_LIMIT);
      expect(rejected).toHaveLength(requestCount - TEST_LIMIT);

      for (const response of rejected) {
        expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(response.headers["retry-after"]).toBeDefined();
      }
    });

    it("isolates rate limits between different clients", async () => {
      const clientA = "sliding-isolation-a";
      const clientB = "sliding-isolation-b";

      // Exhaust client A's allowance.
      for (let i = 0; i < TEST_LIMIT; i++) {
        const response = await request(app)
          .get("/sliding-window")
          .set("X-Test-Client", clientA);

        expect(response.status).toBe(200);
      }

      const blockedA = await request(app)
        .get("/sliding-window")
        .set("X-Test-Client", clientA);

      expect(blockedA.status).toBe(429);

      // Client B should retain its own independent allowance.
      const responseB = await request(app)
        .get("/sliding-window")
        .set("X-Test-Client", clientB);

      expect(responseB.status).toBe(200);
      expect(responseB.headers["ratelimit-remaining"]).toBe(
        String(TEST_LIMIT - 1)
      );
    });
  });

  describe("Token Bucket", () => {
    it("accepts requests within bucket capacity and rejects the next request with HTTP 429", async () => {
      const clientId = "bucket-basic";

      for (let i = 0; i < TEST_LIMIT; i++) {
        const response = await request(app)
          .get("/token-bucket")
          .set("X-Test-Client", clientId);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.headers["ratelimit-limit"]).toBe(
          String(TEST_LIMIT)
        );
      }

      const blocked = await request(app)
        .get("/token-bucket")
        .set("X-Test-Client", clientId);

      expect(blocked.status).toBe(429);
      expect(blocked.body.success).toBe(false);
      expect(blocked.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(blocked.headers["ratelimit-remaining"]).toBe("0");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("enforces bucket capacity under concurrent HTTP requests", async () => {
      const clientId = "bucket-concurrent";
      const requestCount = 20;

      const responses = await Promise.all(
        Array.from({ length: requestCount }, () =>
          request(app)
            .get("/token-bucket")
            .set("X-Test-Client", clientId)
        )
      );

      const accepted = responses.filter(
        (response) => response.status === 200
      );

      const rejected = responses.filter(
        (response) => response.status === 429
      );

      expect(accepted).toHaveLength(TEST_LIMIT);
      expect(rejected).toHaveLength(requestCount - TEST_LIMIT);

      for (const response of rejected) {
        expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(response.headers["retry-after"]).toBeDefined();
      }
    });

    it("isolates token-bucket capacity between different clients", async () => {
      const clientA = "bucket-isolation-a";
      const clientB = "bucket-isolation-b";

      for (let i = 0; i < TEST_LIMIT; i++) {
        const response = await request(app)
          .get("/token-bucket")
          .set("X-Test-Client", clientA);

        expect(response.status).toBe(200);
      }

      const blockedA = await request(app)
        .get("/token-bucket")
        .set("X-Test-Client", clientA);

      expect(blockedA.status).toBe(429);

      const responseB = await request(app)
        .get("/token-bucket")
        .set("X-Test-Client", clientB);

      expect(responseB.status).toBe(200);
      expect(responseB.headers["ratelimit-remaining"]).toBe(
        String(TEST_LIMIT - 1)
      );
    });

    it("returns consistent rate-limit headers when a request is rejected", async () => {
      const clientId = "bucket-headers";

      for (let i = 0; i < TEST_LIMIT; i++) {
        await request(app)
          .get("/token-bucket")
          .set("X-Test-Client", clientId);
      }

      const response = await request(app)
        .get("/token-bucket")
        .set("X-Test-Client", clientId);

      expect(response.status).toBe(429);
      expect(response.headers["ratelimit-limit"]).toBe(String(TEST_LIMIT));
      expect(response.headers["ratelimit-remaining"]).toBe("0");
      expect(response.headers["retry-after"]).toBeDefined();
      expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
      expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(response.body.retryAfterSeconds).toBeGreaterThan(0);
    });
  });
});
