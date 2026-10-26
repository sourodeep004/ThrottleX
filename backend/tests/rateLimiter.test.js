
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/config/redis.js";

const testKey = "throttlex:demo:127.0.0.1";

beforeAll(async () => {
  await connectRedis();
});

beforeEach(async () => {
  await redisClient.del(testKey);
});

afterAll(async () => {
  await disconnectRedis();
});

describe("ThrottleX fixed-window rate limiter", () => {
  it("allows requests within the configured limit", async () => {
    const response = await request(app).get("/api/demo");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.headers["ratelimit-limit"]).toBe("5");
    expect(response.headers["ratelimit-remaining"]).toBe("4");
  });

  it("rejects requests exceeding the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await request(app).get("/api/demo");
      expect(response.status).toBe(200);
    }

    const blocked = await request(app).get("/api/demo");

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["ratelimit-remaining"]).toBe("0");
  });

  it("resets the counter when a new test starts", async () => {
    const response = await request(app).get("/api/demo");

    expect(response.status).toBe(200);
    expect(response.headers["ratelimit-remaining"]).toBe("4");
  });
});
