
import { Router } from "express";
import mongoose from "mongoose";
import { redisClient } from "../config/redis.js";

const router = Router();

/**
 * Check the current status of required dependencies.
 */
function getDependencyStatus() {
  return {
    mongodb:
      mongoose.connection.readyState === 1
        ? "connected"
        : "unavailable",
    redis: redisClient.isReady ? "connected" : "unavailable",
  };
}

/**
 * Determine whether all required dependencies are ready.
 */
function dependenciesAreReady(dependencies) {
  return (
    dependencies.mongodb === "connected" &&
    dependencies.redis === "connected"
  );
}

/**
 * GET /api/health/live
 *
 * Liveness check:
 * Confirms that the API process is running and responding.
 * Returns HTTP 200 even if a dependency is unavailable.
 */
router.get("/live", (_req, res) => {
  return res.status(200).json({
    success: true,
    service: "ThrottleX API",
    status: "alive",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/**
 * Shared readiness handler.
 */
function readinessHandler(_req, res) {
  const dependencies = getDependencyStatus();
  const ready = dependenciesAreReady(dependencies);

  return res.status(ready ? 200 : 503).json({
    success: ready,
    service: "ThrottleX API",
    status: ready ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    dependencies,
  });
}

/**
 * GET /api/health/ready
 *
 * Readiness check:
 * Returns HTTP 200 only when Redis and MongoDB are connected.
 * Returns HTTP 503 when either dependency is unavailable.
 */
router.get("/ready", readinessHandler);

/**
 * GET /api/health
 *
 * Backward-compatible health endpoint.
 * Uses the same dependency checks as the readiness endpoint.
 */
router.get("/", readinessHandler);

export default router;
