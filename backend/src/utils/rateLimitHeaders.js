
/**
 * Standard rate-limit response headers for ThrottleX.
 *
 * @param {import("express").Response} res
 * @param {{
 *   limit: number,
 *   remaining: number,
 *   resetAt: number
 * }} options
 */
export function setRateLimitHeaders(
  res,
  { limit, remaining, resetAt }
) {
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const safeRemaining = Math.min(
    safeLimit,
    Math.max(0, Math.floor(Number(remaining) || 0))
  );

  const safeResetAt = Number.isFinite(Number(resetAt))
    ? Number(resetAt)
    : Date.now();

  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((safeResetAt - Date.now()) / 1000)
  );

  res.setHeader("RateLimit-Limit", String(safeLimit));
  res.setHeader("RateLimit-Remaining", String(safeRemaining));
  res.setHeader(
    "RateLimit-Reset",
    String(Math.ceil(safeResetAt / 1000))
  );

  if (safeRemaining === 0) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
  }
}
