
import express from "express";
import request from "supertest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { spawnMock, envMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  envMock: { NODE_ENV: "development", PORT: 5000 },
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../src/config/env.js", () => ({
  env: envMock,
}));

import metricsRoutes from "../src/routes/metrics.routes.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/metrics", metricsRoutes);
  return app;
}

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("ThrottleX metrics routes integration", () => {
  let app;
  let child;

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NODE_ENV = "development";
    envMock.PORT = 5000;

    child = createFakeChild();
    spawnMock.mockReturnValue(child);

    app = createApp();
  });

  afterEach(() => {
    // Complete any simulated child process so module state
    // does not remain marked as running between tests.
    child?.emit("close", 0, null);
  });

  it("returns an idle benchmark status initially", async () => {
    const response = await request(app)
      .get("/api/metrics/run/status");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.job).toMatchObject({
      running: false,
      id: null,
    });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("blocks benchmark execution in production", async () => {
    envMock.NODE_ENV = "production";

    const response = await request(app)
      .post("/api/metrics/run");

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BENCHMARK_DISABLED");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("starts a benchmark and returns HTTP 202", async () => {
    const response = await request(app)
      .post("/api/metrics/run");

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.job.running).toBe(true);
    expect(response.body.job.id).toBeTruthy();
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("rejects a second benchmark while one is running", async () => {
    const first = await request(app)
      .post("/api/metrics/run");

    expect(first.status).toBe(202);

    const second = await request(app)
      .post("/api/metrics/run");

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("BENCHMARK_RUNNING");
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("records benchmark output and completion", async () => {
    const started = await request(app)
      .post("/api/metrics/run");

    expect(started.status).toBe(202);

    child.stdout.write("Round 1 completed\n");
    child.emit("close", 0, null);

    const status = await request(app)
      .get("/api/metrics/run/status");

    expect(status.status).toBe(200);
    expect(status.body.job.running).toBe(false);
    expect(status.body.job.exitCode).toBe(0);
    expect(status.body.job.error).toBeNull();
    expect(status.body.job.output).toContain("Round 1 completed");
    expect(status.body.job.output).toContain(
      "Benchmark completed successfully."
    );
  });

  it("records a non-zero benchmark exit as a failure", async () => {
    const started = await request(app)
      .post("/api/metrics/run");

    expect(started.status).toBe(202);

    child.stderr.write("Benchmark encountered an error\n");
    child.emit("close", 1, null);

    const status = await request(app)
      .get("/api/metrics/run/status");

    expect(status.status).toBe(200);
    expect(status.body.job.running).toBe(false);
    expect(status.body.job.exitCode).toBe(1);
    expect(status.body.job.error).toContain(
      "Benchmark process exited with code 1"
    );
  });
});
