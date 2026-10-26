
import express from "express";
import request from "supertest";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { consumeSlidingWindow } from "../src/algorithms/slidingWindow.js";
import { consumeTokenBucket } from "../src/algorithms/tokenBucket.js";
import algorithmRoutes from "../src/routes/algorithm.routes.js";

vi.mock("../src/algorithms/slidingWindow.js", () => ({
  consumeSlidingWindow: vi.fn(),
}));

vi.mock("../src/algorithms/tokenBucket.js", () => ({
  consumeTokenBucket: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use("/api", algorithmRoutes);
  return app;
}

describe("ThrottleX algorithm routes integration", () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();

    consumeSlidingWindow.mockResolvedValue({
      allowed: true,
      remaining: 4,
      retryAfterMs: 0,
    });

    consumeTokenBucket.mockResolvedValue({
      allowed: true,
      remaining: 4,
      retryAfterMs: 0,
    });

    app = createApp();
  });

  it("serves the sliding-window demo route", async () => {
    const response = await request(app)
      .get("/api/sliding-window");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      algorithm: "sliding-window",
      message: "Request accepted",
    });

    expect(response.headers["ratelimit-limit"]).toBe("5");
    expect(response.headers["ratelimit-remaining"]).toBe("4");

    expect(consumeSlidingWindow).toHaveBeenCalledWith({
      key: expect.stringMatching(/^throttlex:sliding:/),
      windowMs: 60_000,
      limit: 5,
    });
  });

  it("serves the token-bucket demo route", async () => {
    const response = await request(app)
      .get("/api/token-bucket");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      algorithm: "token-bucket",
      message: "Request accepted",
    });

    expect(response.headers["ratelimit-limit"]).toBe("5");
    expect(response.headers["ratelimit-remaining"]).toBe("4");

    expect(consumeTokenBucket).toHaveBeenCalledWith({
      key: expect.stringMatching(/^throttlex:bucket:/),
      capacity: 5,
      refillTokens: 5,
      refillIntervalMs: 60_000,
    });
  });

  it("serves the benchmark sliding-window route", async () => {
    const response = await request(app)
      .get("/api/benchmark/sliding-window");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      algorithm: "sliding-window",
      mode: "benchmark",
    });

    expect(consumeSlidingWindow).toHaveBeenCalledWith({
      key: expect.stringMatching(/^throttlex:bench:sliding:/),
      windowMs: 60_000,
      limit: 1_000_000,
    });

    expect(response.headers["ratelimit-limit"]).toBe("1000000");
  });

  it("serves the benchmark token-bucket route", async () => {
    const response = await request(app)
      .get("/api/benchmark/token-bucket");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      algorithm: "token-bucket",
      mode: "benchmark",
    });

    expect(consumeTokenBucket).toHaveBeenCalledWith({
      key: expect.stringMatching(/^throttlex:bench:bucket:/),
      capacity: 1_000_000,
      refillTokens: 1_000_000,
      refillIntervalMs: 60_000,
    });

    expect(response.headers["ratelimit-limit"]).toBe("1000000");
  });

  it("returns 429 when the sliding-window algorithm rejects a request", async () => {
    consumeSlidingWindow.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1_500,
    });

    const response = await request(app)
      .get("/api/sliding-window");

    expect(response.status).toBe(429);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(response.body.retryAfterSeconds).toBe(2);
    expect(response.headers["retry-after"]).toBe("2");
  });

  it("returns 429 when the token-bucket algorithm rejects a request", async () => {
    consumeTokenBucket.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2_000,
    });

    const response = await request(app)
      .get("/api/token-bucket");

    expect(response.status).toBe(429);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(response.body.retryAfterSeconds).toBe(2);
    expect(response.headers["retry-after"]).toBe("2");
  });

  it("returns 404 for an unknown algorithm route", async () => {
    const response = await request(app)
      .get("/api/does-not-exist");

    expect(response.status).toBe(404);
  });
});
