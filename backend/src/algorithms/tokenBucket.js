import { redisClient } from "../config/redis.js";

const TOKEN_BUCKET_SCRIPT = `
  local time = redis.call("TIME")
  local now = (tonumber(time[1]) * 1000)
    + math.floor(tonumber(time[2]) / 1000)

  local capacity = tonumber(ARGV[1])
  local refillTokens = tonumber(ARGV[2])
  local refillIntervalMs = tonumber(ARGV[3])
  local cost = tonumber(ARGV[4])

  local values = redis.call(
    "HMGET", KEYS[1], "tokens", "lastRefill"
  )

  local tokens = tonumber(values[1]) or capacity
  local lastRefill = tonumber(values[2]) or now

  -- Keep the stored bucket state within valid bounds.
  tokens = math.max(0, math.min(capacity, tokens))
  lastRefill = math.min(now, lastRefill)

  -- Refill tokens proportionally to elapsed time.
  local elapsed = math.max(0, now - lastRefill)
  local refillRate = refillTokens / refillIntervalMs

  tokens = math.min(
    capacity,
    tokens + elapsed * refillRate
  )

  local allowed = 0
  local retryAfterMs = 0

  if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
  else
    retryAfterMs = math.ceil(
      (cost - tokens) / refillRate
    )
  end

  -- Update the bucket atomically.
  redis.call(
    "HSET", KEYS[1],
    "tokens", tostring(tokens),
    "lastRefill", tostring(now)
  )

  -- Expire inactive bucket state.
  redis.call(
    "PEXPIRE",
    KEYS[1],
    math.max(60000, refillIntervalMs * capacity * 2)
  )

  return {
    allowed,
    math.floor(tokens),
    retryAfterMs
  }
`;

function validateInput({
  key,
  capacity,
  refillTokens,
  refillIntervalMs,
  cost,
}) {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new TypeError("key must be a non-empty string");
  }

  for (const [name, value] of Object.entries({
    capacity,
    refillTokens,
    refillIntervalMs,
    cost,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive number`);
    }
  }

  if (cost > capacity) {
    throw new RangeError("cost cannot exceed bucket capacity");
  }

  if (!Number.isSafeInteger(refillIntervalMs)) {
    throw new TypeError(
      "refillIntervalMs must be a positive safe integer"
    );
  }

  if (
    !Number.isFinite(refillIntervalMs * capacity * 2) ||
    refillIntervalMs * capacity * 2 > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("Bucket expiry configuration is too large");
  }
}

export async function consumeTokenBucket({
  key,
  capacity = 5,
  refillTokens = 5,
  refillIntervalMs = 60_000,
  cost = 1,
}) {
  validateInput({
    key,
    capacity,
    refillTokens,
    refillIntervalMs,
    cost,
  });

  const result = await redisClient.eval(TOKEN_BUCKET_SCRIPT, {
    keys: [key.trim()],
    arguments: [
      String(capacity),
      String(refillTokens),
      String(refillIntervalMs),
      String(cost),
    ],
  });

  if (
    !Array.isArray(result) ||
    result.length !== 3 ||
    ![0, 1].includes(Number(result[0])) ||
    !Number.isFinite(Number(result[1])) ||
    Number(result[1]) < 0 ||
    !Number.isFinite(Number(result[2])) ||
    Number(result[2]) < 0
  ) {
    throw new Error("Invalid token-bucket result from Redis");
  }

  return {
    allowed: Number(result[0]) === 1,
    remaining: Number(result[1]),
    retryAfterMs: Number(result[2]),
  };
}
