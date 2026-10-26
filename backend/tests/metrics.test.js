
import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import metricsRouter from "../src/routes/metrics.routes.js";
const app = express();

app.use(express.json());
app.use("/api/metrics", metricsRouter);

app.use((error, _req, res, _next) => {
  res.status(500).json({
    success: false,
    message: error.message,
  });
});

describe("ThrottleX Metrics API", () => {
  describe("GET /api/metrics", () => {
    it("returns a valid metrics response", async () => {
      const response = await request(app)
        .get("/api/metrics")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect([
        "saved-benchmark",
        "no-benchmark",
      ]).toContain(response.body.source);
    });

    it("disables caching for metrics responses", async () => {
      const response = await request(app)
        .get("/api/metrics")
        .expect(200);

      expect(response.headers["cache-control"]).toContain(
        "no-store"
      );
    });

    it("returns the expected response structure", async () => {
      const response = await request(app)
        .get("/api/metrics")
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("source");
      expect(response.body).toHaveProperty("metrics");
      expect(response.body).toHaveProperty("algorithms");
      expect(response.body).toHaveProperty("reportFile");
      expect(response.body).toHaveProperty(
        "availableAlgorithms"
      );

      expect(
        response.body.availableAlgorithms
      ).toHaveProperty("slidingWindow");

      expect(
        response.body.availableAlgorithms
      ).toHaveProperty("tokenBucket");

      expect(Array.isArray(response.body.algorithms)).toBe(
        true
      );
    });

    it("returns benchmark algorithm metrics when reports exist", async () => {
      const response = await request(app)
        .get("/api/metrics")
        .expect(200);

      if (response.body.source === "saved-benchmark") {
        expect(response.body.reportFile).toEqual(
          expect.stringMatching(/\.json$/i)
        );

        expect(response.body.generatedAt).toBeTruthy();

        expect(response.body.algorithms.length).toBeGreaterThan(
          0
        );

        for (const algorithm of response.body.algorithms) {
          expect(algorithm).toHaveProperty("name");
          expect(algorithm).toHaveProperty(
            "requestsPerSecond"
          );
          expect(algorithm).toHaveProperty("p50LatencyMs");
          expect(algorithm).toHaveProperty("errors");
          expect(algorithm).toHaveProperty("timeouts");
        }
      } else {
        expect(response.body.reportFile).toBeNull();
        expect(response.body.algorithms).toEqual([]);
      }
    });
  });

  describe("GET /api/metrics/history", () => {
    it("returns benchmark history in the expected format", async () => {
      const response = await request(app)
        .get("/api/metrics/history")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty("count");
      expect(response.body).toHaveProperty("totalReports");
      expect(Array.isArray(response.body.history)).toBe(true);

      expect(response.body.count).toBe(
        response.body.history.length
      );

      expect(response.body.count).toBeLessThanOrEqual(20);
    });

    it("respects the requested history limit", async () => {
      const response = await request(app)
        .get("/api/metrics/history?limit=2")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.history.length).toBeLessThanOrEqual(
        2
      );
      expect(response.body.count).toBe(
        response.body.history.length
      );
    });

    it("clamps the history limit to the supported maximum", async () => {
      const response = await request(app)
        .get("/api/metrics/history?limit=500")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.history.length).toBeLessThanOrEqual(
        100
      );
    });

    it("returns newest reports before older reports", async () => {
      const response = await request(app)
        .get("/api/metrics/history?limit=20")
        .expect(200);

      const timestamps = response.body.history.map(
        (entry) => new Date(entry.generatedAt).getTime()
      );

      for (let index = 1; index < timestamps.length; index += 1) {
        expect(timestamps[index - 1]).toBeGreaterThanOrEqual(
          timestamps[index]
        );
      }
    });

    it("includes algorithm summaries in history entries", async () => {
      const response = await request(app)
        .get("/api/metrics/history?limit=1")
        .expect(200);

      if (response.body.history.length > 0) {
        const entry = response.body.history[0];

        expect(entry).toHaveProperty("reportFile");
        expect(entry).toHaveProperty("generatedAt");
        expect(entry).toHaveProperty("benchmarkType");
        expect(entry).toHaveProperty("algorithms");

        expect(Array.isArray(entry.algorithms)).toBe(true);
      }
    });

    it("disables caching for history responses", async () => {
      const response = await request(app)
        .get("/api/metrics/history")
        .expect(200);

      expect(response.headers["cache-control"]).toContain(
        "no-store"
      );
    });
  });

  describe("GET /api/metrics/run/status", () => {
    it("returns the benchmark job status", async () => {
      const response = await request(app)
        .get("/api/metrics/run/status")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.job).toBeDefined();

      expect(response.body.job).toHaveProperty("running");
      expect(response.body.job).toHaveProperty("startedAt");
      expect(response.body.job).toHaveProperty("finishedAt");
      expect(response.body.job).toHaveProperty("output");

      expect(Array.isArray(response.body.job.output)).toBe(true);
    });

    it("disables caching for benchmark status responses", async () => {
      const response = await request(app)
        .get("/api/metrics/run/status")
        .expect(200);

      expect(response.headers["cache-control"]).toContain(
        "no-store"
      );
    });
  });
});
