
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";

import { requestLogger, logRequestError } from "./middleware/requestLogger.js";

import healthRoutes from "./routes/health.routes.js";
import demoRoutes from "./routes/demo.routes.js";
import algorithmRoutes from "./routes/algorithm.routes.js";
import metricsRoutes from "./routes/metrics.routes.js";

const app = express();

app.disable("x-powered-by");

// Log every request before it reaches a route.
app.use(requestLogger);

// Security headers.
app.use(helmet());

// Allowed frontend origins.
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  env.CLIENT_URL,
].filter(Boolean);

// CORS configuration.
app.use(
  cors({
    origin(origin, callback) {
      // Allow requests from curl, Postman, and other clients
      // that do not send an Origin header.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Client-ID",
      "X-Request-ID",
    ],
    exposedHeaders: ["X-Request-ID"],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// Parse JSON request bodies.
app.use(express.json({ limit: "100kb" }));

// Root endpoint.
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    name: "ThrottleX",
    description: "API traffic control and rate-limiting platform",
    version: "1.0.0",
    health: "/api/health",
    endpoints: {
      health: "/api/health",
      fixedWindow: "/api/demo",
      slidingWindow: "/api/sliding-window",
      tokenBucket: "/api/token-bucket",
      metrics: "/api/metrics",
    },
  });
});

// Health endpoints.
app.use("/api/health", healthRoutes);

// Fixed-window rate limiter demo.
app.use("/api/demo", demoRoutes);

// Sliding-window and token-bucket algorithms.
app.use("/api", algorithmRoutes);

// Saved benchmark metrics and benchmark execution.
app.use("/api/metrics", metricsRoutes);

// Handle unknown routes.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "The requested endpoint does not exist",
      requestId: req.requestId,
    },
  });
});

// Global error handler.
app.use((error, req, res, _next) => {
  logRequestError(error, req);

  if (res.headersSent) {
    return;
  }

  const statusCode =
    error.status === 400
      ? 400
      : error.message === "Origin not allowed by CORS"
        ? 403
        : 500;

  const errorCode =
    statusCode === 400
      ? "BAD_REQUEST"
      : statusCode === 403
        ? "CORS_ORIGIN_DENIED"
        : "INTERNAL_ERROR";

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message:
        env.NODE_ENV === "production"
          ? statusCode === 403
            ? "The request origin is not allowed"
            : "An unexpected error occurred"
          : error.message,
      requestId: req.requestId,
    },
  });
});

export default app;
