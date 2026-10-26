
import { redisClient } from "../config/redis.js";

const FIXED_WINDOW_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  local ttl = redis.call("PTTL", KEYS[1])

  if count == 1 or ttl < 0 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end

  return { count, ttl }
`;

export function rateLimiter({
  windowMs = 60_000,
  limit = 5,
  keyPrefix = "throttlex:rate",
  keyGenerator = (req) => req.ip,
} = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("windowMs must be a positive integer");
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const identity = keyGenerator(req);

      if (typeof identity !== "string" || identity.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_CLIENT_ID",
            message: "Unable to identify the client",
          },
        });
      }

      const key = `${keyPrefix}:${identity}`;
      const result = await redisClient.eval(FIXED_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [String(windowMs)],
      });

      const count = Number(result[0]);
      const ttlMs = Math.max(0, Number(result[1]));
      const remaining = Math.max(0, limit - count);
      const resetSeconds = Math.ceil(ttlMs / 1000);

      res.set({
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": String(remaining),
        "RateLimit-Reset": String(resetSeconds),
      });

      if (count > limit) {
        res.set("Retry-After", String(Math.max(1, resetSeconds)));

        return res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
          },
          retryAfterSeconds: Math.max(1, resetSeconds),
        });
      }

      return next();
    } catch (error) {
      console.error("Rate limiter error:", error.message);

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
