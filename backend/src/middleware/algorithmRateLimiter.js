function logLimiterError(error, req) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "rate_limiter_failure",
      method: req.method,
      path: req.path,
      errorName: error?.name ?? "Error",
      message: error?.message ?? "Unknown rate limiter error",
      timestamp: new Date().toISOString(),
    })
  );
}

function isValidLimiterResult(result) {
  return (
    result !== null &&
    typeof result === "object" &&
    typeof result.allowed === "boolean" &&
    Number.isFinite(result.remaining) &&
    result.remaining >= 0 &&
    Number.isFinite(result.retryAfterMs) &&
    result.retryAfterMs >= 0
  );
}

function setRateLimitHeaders(res, {
  limit,
  remaining,
  retryAfterMs,
  resetWindowMs,
}) {
  const safeRemaining = Math.min(
    limit,
    Math.max(0, Math.floor(remaining))
  );

  const estimatedResetMs =
    retryAfterMs > 0 ? retryAfterMs : resetWindowMs;

  const resetSeconds = Math.max(
    0,
    Math.ceil(estimatedResetMs / 1000)
  );

  res.set({
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(safeRemaining),
    "RateLimit-Reset": String(resetSeconds),
  });

  return {
    remaining: safeRemaining,
    resetSeconds,
  };
}

export function algorithmRateLimiter({
  algorithm,
  keyPrefix,
  keyGenerator = (req) => req.ip,
  limit,
  resetWindowMs = 60_000,
}) {
  if (typeof algorithm !== "function") {
    throw new TypeError("algorithm must be a function");
  }

  if (typeof keyPrefix !== "string" || keyPrefix.trim().length === 0) {
    throw new TypeError("keyPrefix must be a non-empty string");
  }

  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("limit must be a positive integer");
  }

  if (typeof keyGenerator !== "function") {
    throw new TypeError("keyGenerator must be a function");
  }

  if (
    !Number.isSafeInteger(resetWindowMs) ||
    resetWindowMs < 1
  ) {
    throw new TypeError("resetWindowMs must be a positive integer");
  }

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const identity = keyGenerator(req);

      if (
        typeof identity !== "string" ||
        identity.trim().length === 0
      ) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_CLIENT_ID",
            message: "Unable to identify the client",
          },
        });
      }

      const result = await algorithm({
        key: `${keyPrefix}:${identity.trim()}`,
      });

      if (!isValidLimiterResult(result)) {
        const error = new Error(
          "Rate limiter returned an invalid result"
        );

        error.name = "InvalidLimiterResultError";
        throw error;
      }

      const {
        remaining,
        resetSeconds,
      } = setRateLimitHeaders(res, {
        limit,
        remaining: result.remaining,
        retryAfterMs: result.retryAfterMs,
        resetWindowMs,
      });

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(result.retryAfterMs / 1000)
        );

        res.set({
          "Retry-After": String(retryAfterSeconds),
          "Cache-Control": "no-store",
        });

        return res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
          },
          limit,
          remaining,
          retryAfterSeconds,
          resetAfterSeconds: resetSeconds,
        });
      }

      return next();
    } catch (error) {
      logLimiterError(error, req);

      if (res.headersSent) {
        return next(error);
      }

      if (res.destroyed) {
        return;
      }

      return res.status(503).json({
        success: false,
        error: {
          code: "RATE_LIMITER_UNAVAILABLE",
          message: "Request protection is temporarily unavailable",
        },
      });
    }
  };
}
