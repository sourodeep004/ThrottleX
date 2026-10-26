
import app from "./app.js";
import { env } from "./config/env.js";
import {
  connectDatabase,
  disconnectDatabase,
} from "./config/database.js";
import {
  connectRedis,
  disconnectRedis,
} from "./config/redis.js";

let server = null;
let shuttingDown = false;
let cleanupPromise = null;

async function cleanup() {
  if (cleanupPromise) {
    return cleanupPromise;
  }

  cleanupPromise = (async () => {
    const operations = [
      ["Redis", disconnectRedis],
      ["MongoDB", disconnectDatabase],
    ];

    for (const [service, disconnect] of operations) {
      try {
        await disconnect();
        console.log(`${service} disconnected successfully`);
      } catch (error) {
        console.error(
          `Failed to disconnect ${service}:`,
          error instanceof Error ? error.message : error
        );
        process.exitCode = 1;
      }
    }
  })();

  return cleanupPromise;
}

async function startServer() {
  try {
    console.log("Starting ThrottleX API...");

    await connectDatabase();
    console.log("MongoDB connected successfully");

    await connectRedis();
    console.log("Redis connection verified");

    server = app.listen(env.PORT);

    server.on("listening", () => {
      console.log("------------------------------------");
      console.log("ThrottleX API started successfully");
      console.log(`Environment: ${env.NODE_ENV ?? "development"}`);
      console.log(`Port: ${env.PORT}`);
      console.log(`Health: http://localhost:${env.PORT}/api/health`);
      console.log("------------------------------------");
    });

    server.on("error", (error) => {
      console.error("HTTP server error:", error.message);
      process.exitCode = 1;

      if (!shuttingDown) {
        void shutdown("SERVER_ERROR");
      }
    });
  } catch (error) {
    console.error(
      "Failed to start ThrottleX:",
      error instanceof Error ? error.message : error
    );

    process.exitCode = 1;

    await cleanup();
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received. Shutting down gracefully...`);

  const timeoutMs = Number(env.SHUTDOWN_TIMEOUT_MS) || 10000;

  const forceExitTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, timeoutMs);

  forceExitTimer.unref();

  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });

        // Close idle keep-alive connections when supported.
        server.closeIdleConnections?.();
      });

      console.log("HTTP server closed successfully");
    }

    await cleanup();
    console.log("ThrottleX shutdown complete");
  } catch (error) {
    console.error(
      "Shutdown error:",
      error instanceof Error ? error.message : error
    );

    process.exitCode = 1;
  } finally {
    clearTimeout(forceExitTimer);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await startServer();
