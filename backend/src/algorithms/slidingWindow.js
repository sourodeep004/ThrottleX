import { randomUUID } from "node:crypto";
import { redisClient } from "../config/redis.js";

const SLIDING_WINDOW_SCRIPT = `
  local time = redis.call("TIME")
  local now = (tonumber(time[1]) * 1000)
    + math.floor(tonumber(time[2]) / 1000)

  local windowMs = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local member = ARGV[3]
  local cutoff = now - windowMs

  -- Remove requests outside the active sliding window.
  redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", cutoff)

  local count = redis.call("ZCARD", KEYS[1])
  local oldest = redis.call(
    "ZRANGE", KEYS[1], 0, 0, "WITHSCORES"
  )

  if count >= limit then
    local retryAfterMs = windowMs

    if oldest[2] then
      retryAfterMs = math.max(
        1,
        tonumber(oldest[2]) + windowMs - now
      )
    end

    redis.call("PEXPIRE", KEYS[1], windowMs)

    return { 0, count, retryAfterMs }
  end

  -- Unique members allow multiple requests in the same millisecond.
  redis.call("ZADD", KEYS[1], now, member)
  redis.call("PEXPIRE", KEYS[1], windowMs)

  return { 1, count + 1, 0 }
`;

function validateInput({ key, windowMs, limit }) {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new TypeError("key must be a non-empty string");
  }

  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError("windowMs must be a positive safe integer");
  }

  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("limit must be a positive safe integer");
  }
}

export async function consumeSlidingWindow({
  key,
  windowMs = 60_000,
  limit = 5,
}) {
  validateInput({ key, windowMs, limit });

  const result = await redisClient.eval(SLIDING_WINDOW_SCRIPT, {
    keys: [key.trim()],
    arguments: [
      String(windowMs),
      String(limit),
      randomUUID(),
    ],
  });

  if (
    !Array.isArray(result) ||
    result.length !== 3 ||
    ![0, 1].includes(Number(result[0])) ||
    !Number.isSafeInteger(Number(result[1])) ||
    Number(result[1]) < 0 ||
    !Number.isFinite(Number(result[2])) ||
    Number(result[2]) < 0
  ) {
    throw new Error("Invalid sliding-window result from Redis");
  }

  const allowed = Number(result[0]) === 1;
  const count = Number(result[1]);
  const retryAfterMs = Number(result[2]);

  return {
    allowed,
    count,
    remaining: Math.max(0, limit - count),
    retryAfterMs,
  };
}
