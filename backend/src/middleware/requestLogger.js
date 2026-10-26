import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;
const MAX_BUCKETS = 60;
const BUCKET_DURATION_MS = 60_000;

// In-memory traffic history: one-minute buckets, up to 60 minutes.
const trafficBuckets = new Map();

function getCurrentBucket(timestamp = Date.now()) {
  return Math.floor(timestamp / BUCKET_DURATION_MS) * BUCKET_DURATION_MS;
}

function pruneOldBuckets(currentBucket) {
  const oldestAllowed =
    currentBucket - (MAX_BUCKETS - 1) * BUCKET_DURATION_MS;

  for (const bucket of trafficBuckets.keys()) {
    if (bucket < oldestAllowed) {
      trafficBuckets.delete(bucket);
    }
  }
}

function recordCompletedRequest({ timestamp, statusCode, durationMs }) {
  const bucket = getCurrentBucket(timestamp);
  pruneOldBuckets(bucket);

  if (!trafficBuckets.has(bucket)) {
    trafficBuckets.set(bucket, {
      timestamp: new Date(bucket).toISOString(),
      incomingRequests: 0,
      limitedRequests: 0,
      errors4xx: 0,
      errors5xx: 0,
      totalDurationMs: 0,
      completedRequests: 0,
    });
  }

  const metrics = trafficBuckets.get(bucket);

  metrics.incomingRequests += 1;
  metrics.completedRequests += 1;
  metrics.totalDurationMs += durationMs;

  if (statusCode === 429) metrics.limitedRequests += 1;
  if (statusCode >= 400 && statusCode < 500) metrics.errors4xx += 1;
  if (statusCode >= 500) metrics.errors5xx += 1;
}

// Read-only snapshot consumed by the live traffic API.
export function getTrafficMetrics() {
  const currentBucket = getCurrentBucket();
  pruneOldBuckets(currentBucket);

  const history = [];

  for (let offset = MAX_BUCKETS - 1; offset >= 0; offset -= 1) {
    const bucketTimestamp =
      currentBucket - offset * BUCKET_DURATION_MS;

    const existing = trafficBuckets.get(bucketTimestamp);

    history.push(
      existing
        ? { ...existing }
        : {
            timestamp: new Date(bucketTimestamp).toISOString(),
            incomingRequests: 0,
            limitedRequests: 0,
            errors4xx: 0,
            errors5xx: 0,
            totalDurationMs: 0,
            completedRequests: 0,
          },
    );
  }

  const totals = history.reduce(
    (result, bucket) => ({
      incomingRequests:
        result.incomingRequests + bucket.incomingRequests,
      limitedRequests:
        result.limitedRequests + bucket.limitedRequests,
      errors4xx: result.errors4xx + bucket.errors4xx,
      errors5xx: result.errors5xx + bucket.errors5xx,
      completedRequests:
        result.completedRequests + bucket.completedRequests,
      totalDurationMs:
        result.totalDurationMs + bucket.totalDurationMs,
    }),
    {
      incomingRequests: 0,
      limitedRequests: 0,
      errors4xx: 0,
      errors5xx: 0,
      completedRequests: 0,
      totalDurationMs: 0,
    },
  );

  return {
    success: true,
    source: "live-http-traffic",
    windowMinutes: MAX_BUCKETS,
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      averageDurationMs: totals.completedRequests
        ? Number(
            (
              totals.totalDurationMs / totals.completedRequests
            ).toFixed(2),
          )
        : 0,
    },
    history: history.map(
      ({ totalDurationMs, completedRequests, ...bucket }) => ({
        ...bucket,
        averageDurationMs: completedRequests
          ? Number(
              (totalDurationMs / completedRequests).toFixed(2),
            )
          : 0,
      }),
    ),
  };
}

function writeLog(level, event, fields = {}) {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const serialized = JSON.stringify(entry);

  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function requestLogger(req, res, next) {
  const startedAt = performance.now();
  const incomingRequestId = req.get("x-request-id");

  const requestId =
    incomingRequestId && REQUEST_ID_PATTERN.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  res.once("finish", () => {
    const durationMs = Number(
      (performance.now() - startedAt).toFixed(2),
    );

    const statusCode = res.statusCode;
    const timestamp = Date.now();

    // Do not count the traffic endpoint's own polling requests.
    const requestPath = req.originalUrl.split("?")[0];

    if (requestPath !== "/api/metrics/traffic") {
      recordCompletedRequest({
        timestamp,
        statusCode,
        durationMs,
      });
    }

    const level =
      statusCode >= 500
        ? "error"
        : statusCode >= 400
          ? "warn"
          : "info";

    writeLog(level, "http_request_completed", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode,
      durationMs,
      contentLength: res.getHeader("content-length") ?? null,
    });
  });

  next();
}

export function logRequestError(error, req) {
  writeLog("error", "http_request_error", {
    requestId: req.requestId ?? null,
    method: req.method,
    path: req.path,
    errorName: error.name ?? "Error",
    errorMessage: error.message ?? "Unknown error",
  });
}