
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";

const { dependencyState } = vi.hoisted(() => ({
  dependencyState: {
    mongoReadyState: 0,
    redisReady: false,
  },
}));

vi.mock("mongoose", () => ({
  default: {
    connection: {
      get readyState() {
        return dependencyState.mongoReadyState;
      },
    },
  },
}));

vi.mock("../src/config/redis.js", () => ({
  redisClient: {
    get isReady() {
      return dependencyState.redisReady;
    },
  },
}));

import healthRoutes from "../src/routes/health.routes.js";

const app = express();
app.use("/api/health", healthRoutes);

beforeEach(() => {
  dependencyState.mongoReadyState = 1;
  dependencyState.redisReady = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ThrottleX health endpoints", () => {
  it("returns alive even when dependencies are unavailable", async () => {
    dependencyState.mongoReadyState = 0;
    dependencyState.redisReady = false;

    const response = await request(app).get("/api/health/live");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("alive");
    expect(response.body.uptimeSeconds).toEqual(
      expect.any(Number)
    );
  });

  it("returns ready when Redis and MongoDB are connected", async () => {
    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("ready");
    expect(response.body.dependencies).toEqual({
      mongodb: "connected",
      redis: "connected",
    });
  });

  it("returns 503 when Redis is unavailable", async () => {
    dependencyState.redisReady = false;

    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.status).toBe("not_ready");
    expect(response.body.dependencies.redis).toBe("unavailable");
  });

  it("returns 503 when MongoDB is unavailable", async () => {
    dependencyState.mongoReadyState = 0;

    const response = await request(app).get("/api/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.dependencies.mongodb).toBe("unavailable");
  });

  it("preserves the existing /api/health endpoint", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ready");
  });
});
