
import { createClient } from "redis";
import { env } from "./env.js";

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY_MS = 100;
const MAX_RECONNECT_DELAY_MS = 3000;

export const redisClient = createClient({
  url: env.REDIS_URL,

  socket: {
    connectTimeout: 5000,

    reconnectStrategy(retries) {
      if (retries > MAX_RECONNECT_ATTEMPTS) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "redis_reconnect_limit_exceeded",
            attempts: retries,
            timestamp: new Date().toISOString(),
          })
        );

        return new Error("Redis reconnection limit exceeded");
      }

      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** retries,
        MAX_RECONNECT_DELAY_MS
      );

      console.warn(
        JSON.stringify({
          level: "warn",
          event: "redis_reconnecting",
          attempt: retries,
          delayMs: delay,
          timestamp: new Date().toISOString(),
        })
      );

      return delay;
    },
  },
});

redisClient.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "redis_client_error",
      errorName: error.name,
      message: error.message,
      timestamp: new Date().toISOString(),
    })
  );
});

redisClient.on("reconnecting", () => {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "redis_reconnecting",
      timestamp: new Date().toISOString(),
    })
  );
});

redisClient.on("ready", () => {
  console.info(
    JSON.stringify({
      level: "info",
      event: "redis_ready",
      timestamp: new Date().toISOString(),
    })
  );
});

redisClient.on("end", () => {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "redis_connection_closed",
      timestamp: new Date().toISOString(),
    })
  );
});

let connectionPromise = null;

/**
 * Connects to Redis if necessary and verifies connectivity with PING.
 * Concurrent callers share the same connection attempt.
 */
export async function connectRedis() {
  if (redisClient.isReady) {
    await redisClient.ping();
    return;
  }

  if (connectionPromise) {
    await connectionPromise;
    await redisClient.ping();
    return;
  }

  connectionPromise = (async () => {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    await redisClient.ping();

    console.info(
      JSON.stringify({
        level: "info",
        event: "redis_connection_verified",
        timestamp: new Date().toISOString(),
      })
    );
  })();

  try {
    await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}

/**
 * Gracefully closes the Redis connection.
 */
export async function disconnectRedis() {
  if (connectionPromise) {
    try {
      await connectionPromise;
    } catch {
      // Continue cleanup even if connection initialization failed.
    }
  }

  if (redisClient.isOpen) {
    await redisClient.quit();

    console.info(
      JSON.stringify({
        level: "info",
        event: "redis_disconnected_cleanly",
        timestamp: new Date().toISOString(),
      })
    );
  }
}
