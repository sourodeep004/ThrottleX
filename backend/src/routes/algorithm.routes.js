
import { Router } from "express";

import { consumeSlidingWindow } from "../algorithms/slidingWindow.js";
import { consumeTokenBucket } from "../algorithms/tokenBucket.js";
import { algorithmRateLimiter } from "../middleware/algorithmRateLimiter.js";

const router = Router();

// Existing demo limits — unchanged.
const slidingWindowLimit = 5;
const tokenBucketCapacity = 5;

// Demo window and refill configuration.
const demoWindowMs = 60_000;
const tokenRefillTokens = 5;
const tokenRefillIntervalMs = 60_000;

// Dedicated benchmark configuration.
// Both algorithms start with a high limit so ordinary benchmark
// traffic should not exhaust their allowance.
const benchmarkLimit = 1_000_000;
const benchmarkWindowMs = 60_000;

// Existing sliding-window demo endpoint.
router.get(
  "/sliding-window",
  algorithmRateLimiter({
    algorithm: (options) =>
      consumeSlidingWindow({
        ...options,
        windowMs: demoWindowMs,
        limit: slidingWindowLimit,
      }),
    keyPrefix: "throttlex:sliding",
    limit: slidingWindowLimit,
    resetWindowMs: demoWindowMs,
  }),
  (_req, res) => {
    res.json({
      success: true,
      algorithm: "sliding-window",
      message: "Request accepted",
    });
  }
);

// Existing token-bucket demo endpoint.
router.get(
  "/token-bucket",
  algorithmRateLimiter({
    algorithm: (options) =>
      consumeTokenBucket({
        ...options,
        capacity: tokenBucketCapacity,
        refillTokens: tokenRefillTokens,
        refillIntervalMs: tokenRefillIntervalMs,
      }),
    keyPrefix: "throttlex:bucket",
    limit: tokenBucketCapacity,
    resetWindowMs: tokenRefillIntervalMs,
  }),
  (_req, res) => {
    res.json({
      success: true,
      algorithm: "token-bucket",
      message: "Request accepted",
    });
  }
);

// Benchmark-only sliding-window endpoint.
router.get(
  "/benchmark/sliding-window",
  algorithmRateLimiter({
    algorithm: (options) =>
      consumeSlidingWindow({
        ...options,
        windowMs: benchmarkWindowMs,
        limit: benchmarkLimit,
      }),
    keyPrefix: "throttlex:bench:sliding",
    limit: benchmarkLimit,
    resetWindowMs: benchmarkWindowMs,
  }),
  (_req, res) => {
    res.json({
      success: true,
      algorithm: "sliding-window",
      mode: "benchmark",
    });
  }
);

// Benchmark-only token-bucket endpoint.
router.get(
  "/benchmark/token-bucket",
  algorithmRateLimiter({
    algorithm: (options) =>
      consumeTokenBucket({
        ...options,
        capacity: benchmarkLimit,
        refillTokens: benchmarkLimit,
        refillIntervalMs: benchmarkWindowMs,
      }),
    keyPrefix: "throttlex:bench:bucket",
    limit: benchmarkLimit,
    resetWindowMs: benchmarkWindowMs,
  }),
  (_req, res) => {
    res.json({
      success: true,
      algorithm: "token-bucket",
      mode: "benchmark",
    });
  }
);

export default router;
