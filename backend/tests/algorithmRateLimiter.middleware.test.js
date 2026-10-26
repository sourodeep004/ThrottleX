import express from "express";
import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { algorithmRateLimiter } from "../src/middleware/algorithmRateLimiter.js";

function createTestApp({
  algorithm = vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterMs: 0,
  }),
  keyGenerator = () => "test-client",
  limit = 5,
  resetWindowMs = 60_000,
} = {}) {
  const app = express();

  app.get(
    "/test",
    algorithmRateLimiter({
      algorithm,
      keyPrefix: "throttlex:test",
      keyGenerator,
      limit,
      resetWindowMs,
    }),
    (_req, res) => {
      res.status(200).json({
        success: true,
        message: "Request accepted",
      });
    }
  );

  return { app, algorithm };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("algorithmRateLimiter middleware", () => {
  it("allows requests within the limit and sets rate-limit headers", async () => {
    const { app, algorithm } = createTestApp();

    const response = await request(app).get("/test");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.headers["ratelimit-limit"]).toBe("5");
    expect(response.headers["ratelimit-remaining"]).toBe("4");
    expect(response.headers["ratelimit-reset"]).toBe("60");

    expect(algorithm).toHaveBeenCalledWith({
      key: "throttlex:test:test-client",
    });
  });

  it("returns 429 and retry headers when the limit is exceeded", async () => {
    const { app } = createTestApp({
      algorithm: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfterMs: 1_500,
      }),
    });

    const response = await request(app).get("/test");

    expect(response.status).toBe(429);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(response.body.retryAfterSeconds).toBe(2);

    expect(response.headers["ratelimit-limit"]).toBe("5");
    expect(response.headers["ratelimit-remaining"]).toBe("0");
    expect(response.headers["ratelimit-reset"]).toBe("2");
    expect(response.headers["retry-after"]).toBe("2");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns 400 when the client identity is invalid", async () => {
    const algorithm = vi.fn();

    const { app } = createTestApp({
      algorithm,
      keyGenerator: () => "",
    });

    const response = await request(app).get("/test");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_CLIENT_ID");
    expect(algorithm).not.toHaveBeenCalled();
  });

  it("returns 503 when the algorithm throws an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { app } = createTestApp({
      algorithm: vi.fn().mockRejectedValue(
        new Error("Redis connection failed")
      ),
    });

    const response = await request(app).get("/test");

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RATE_LIMITER_UNAVAILABLE"
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("returns 503 when the algorithm returns an invalid result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { app } = createTestApp({
      algorithm: vi.fn().mockResolvedValue({
        allowed: "yes",
        remaining: -1,
        retryAfterMs: NaN,
      }),
    });

    const response = await request(app).get("/test");

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RATE_LIMITER_UNAVAILABLE"
    );
  });

  it("trims client identities before building the rate-limit key", async () => {
    const algorithm = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 3,
      retryAfterMs: 0,
    });

    const { app } = createTestApp({
      algorithm,
      keyGenerator: () => "  client-123  ",
    });

    const response = await request(app).get("/test");

    expect(response.status).toBe(200);
    expect(algorithm).toHaveBeenCalledWith({
      key: "throttlex:test:client-123",
    });
  });

  it("rejects invalid middleware configuration", () => {
    expect(() =>
      algorithmRateLimiter({
        algorithm: vi.fn(),
        keyPrefix: "test",
        limit: 0,
      })
    ).toThrow("limit must be a positive integer");

    expect(() =>
      algorithmRateLimiter({
        algorithm: vi.fn(),
        keyPrefix: "test",
        limit: 5,
        resetWindowMs: 0,
      })
    ).toThrow("resetWindowMs must be a positive integer");

    expect(() =>
      algorithmRateLimiter({
        algorithm: "not-a-function",
        keyPrefix: "test",
        limit: 5,
      })
    ).toThrow("algorithm must be a function");
  });
});
