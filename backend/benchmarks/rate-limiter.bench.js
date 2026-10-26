
import autocannon from "autocannon";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../src/config/redis.js";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const resultsDirectory = join(scriptDirectory, "results");

const BASE_URL = process.env.BENCH_URL ?? "http://localhost:5000";

const ROUNDS = 5;
const DURATION_SECONDS = 10;
const CONNECTIONS = 10;
const PIPELINING = 1;
const WARMUP_DURATION_SECONDS = 3;
const RUN_TIMEOUT_MS = (DURATION_SECONDS + 30) * 1000;

const scenarios = [
  {
    name: "Sliding Window",
    endpoint: "/api/benchmark/sliding-window",
    keyPrefix: "throttlex:bench:sliding:",
  },
  {
    name: "Token Bucket",
    endpoint: "/api/benchmark/token-bucket",
    keyPrefix: "throttlex:bench:bucket:",
  },
];

function median(values) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function shuffle(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function assertNonNegativeNumber(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a finite, non-negative number.`);
  }
}

function validateBenchmarkResult(result, label) {
  if (!result || typeof result !== "object") {
    throw new Error(`${label} returned no valid result object.`);
  }

  assertNonNegativeNumber(
    result.requests?.average,
    `${label} requests per second`
  );

  assertNonNegativeNumber(
    result.requests?.total,
    `${label} total requests`
  );

  for (const key of ["p50", "p97_5", "p99"]) {
    assertNonNegativeNumber(
      result.latency?.[key],
      `${label} latency ${key}`
    );
  }

  for (const key of ["errors", "timeouts", "non2xx"]) {
    assertNonNegativeNumber(
      result[key],
      `${label} ${key}`
    );
  }
}

async function clearScenarioKeys(prefix) {
  let cursor = "0";

  do {
    const result = await redisClient.scan(cursor, {
      MATCH: `${prefix}*`,
      COUNT: 500,
    });

    cursor = result.cursor;

    if (result.keys.length > 0) {
      await redisClient.del(result.keys);
    }
  } while (cursor !== "0");
}

function runBenchmark(
  scenario,
  round,
  {
    durationSeconds = DURATION_SECONDS,
    label = `${scenario.name} - Round ${round}`,
  } = {}
) {
  return new Promise((resolve, reject) => {
    const statusCounts = {};
    let settled = false;
    let timeoutId;
    let instance;

    const runTimeoutMs = (durationSeconds + 30) * 1000;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    const fail = (error) => {
      if (settled) return;

      settled = true;
      cleanup();

      try {
        instance?.stop();
      } catch {
        // Preserve the original error.
      }

      reject(error);
    };

    try {
      instance = autocannon({
        url: `${BASE_URL}${scenario.endpoint}`,
        connections: CONNECTIONS,
        duration: durationSeconds,
        pipelining: PIPELINING,
        method: "GET",
        title: label,
        timeout: durationSeconds + 30,
      });

      timeoutId = setTimeout(() => {
        fail(
          new Error(
            `${label} exceeded the ${runTimeoutMs}ms benchmark watchdog.`
          )
        );
      }, runTimeoutMs);

      timeoutId.unref?.();

      instance.on("response", (_client, statusCode) => {
        const status = String(statusCode);
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      });

      instance.once("error", (error) => {
        fail(
          new Error(`${label} failed: ${error.message}`, {
            cause: error,
          })
        );
      });

      instance.once("done", (result) => {
        if (settled) return;

        settled = true;
        cleanup();

        try {
          validateBenchmarkResult(result, label);
        } catch (error) {
          reject(error);
          return;
        }

        const latency = result.latency;

        resolve({
          algorithm: scenario.name,
          endpoint: scenario.endpoint,
          round,
          configuration: {
            durationSeconds,
            connections: CONNECTIONS,
            pipelining: PIPELINING,
          },
          requestsPerSecond: result.requests.average,
          totalRequests: result.requests.total,
          latencyMs: {
            average: latency.average,
            p50: latency.p50,
            p97_5: latency.p97_5,
            p99: latency.p99,
            max: latency.max,
          },
          statusCounts,
          countedResponses: Object.values(statusCounts).reduce(
            (sum, count) => sum + count,
            0
          ),
          non2xx: result.non2xx,
          errors: result.errors,
          timeouts: result.timeouts,
        });
      });
    } catch (error) {
      fail(error);
    }
  });
}

function summarize(results) {
  return scenarios.map((scenario) => {
    const runs = results.filter(
      (result) => result.algorithm === scenario.name
    );

    return {
      algorithm: scenario.name,
      rounds: runs.length,

      medianRequestsPerSecond: median(
        runs.map((run) => run.requestsPerSecond)
      ),

      medianTotalRequests: median(
        runs.map((run) => run.totalRequests)
      ),

      medianLatencyMs: {
        average: median(
          runs.map((run) => run.latencyMs.average)
        ),
        p50: median(
          runs.map((run) => run.latencyMs.p50)
        ),
        p97_5: median(
          runs.map((run) => run.latencyMs.p97_5)
        ),
        p99: median(
          runs.map((run) => run.latencyMs.p99)
        ),
      },

      total2xx: runs.reduce(
        (sum, run) =>
          sum +
          Object.entries(run.statusCounts).reduce(
            (count, [status, value]) =>
              status.startsWith("2") ? count + value : count,
            0
          ),
        0
      ),

      total429: runs.reduce(
        (sum, run) => sum + (run.statusCounts["429"] ?? 0),
        0
      ),

      total5xx: runs.reduce(
        (sum, run) =>
          sum +
          Object.entries(run.statusCounts).reduce(
            (count, [status, value]) =>
              status.startsWith("5") ? count + value : count,
            0
          ),
        0
      ),

      totalErrors: runs.reduce(
        (sum, run) => sum + run.errors,
        0
      ),

      totalTimeouts: runs.reduce(
        (sum, run) => sum + run.timeouts,
        0
      ),
    };
  });
}

async function collectEnvironmentMetadata() {
  let redisVersion = null;
  let redisVersionError = null;

  try {
    const serverInfo = await redisClient.info("server");
    const match = serverInfo.match(/^redis_version:([^\r\n]+)/m);

    redisVersion = match?.[1]?.trim() ?? null;

    if (!redisVersion) {
      redisVersionError =
        "Redis INFO server did not contain redis_version.";
    }
  } catch (error) {
    redisVersionError = error.message;
  }

  const cpuInfo = os.cpus();

  return {
    collectedAt: new Date().toISOString(),
    nodeVersion: process.version,
    nodeEnvironment: process.env.NODE_ENV ?? "not-set",
    platform: process.platform,
    operatingSystem: os.type(),
    operatingSystemRelease: os.release(),
    architecture: process.arch,
    cpu: {
      model: cpuInfo[0]?.model ?? null,
      logicalCores: cpuInfo.length,
    },
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytesAtStart: os.freemem(),
    redisVersion,
    redisVersionError,
  };
}

function validateCompletedRuns(rawResults) {
  const expectedRuns = ROUNDS * scenarios.length;

  if (rawResults.length !== expectedRuns) {
    throw new Error(
      `Incomplete benchmark: expected ${expectedRuns} measured runs, received ${rawResults.length}.`
    );
  }

  for (const scenario of scenarios) {
    const runs = rawResults.filter(
      (result) => result.algorithm === scenario.name
    );

    if (runs.length !== ROUNDS) {
      throw new Error(
        `${scenario.name}: expected ${ROUNDS} measured runs, received ${runs.length}.`
      );
    }

    const roundNumbers = new Set(runs.map((run) => run.round));

    for (let round = 1; round <= ROUNDS; round++) {
      if (!roundNumbers.has(round)) {
        throw new Error(
          `${scenario.name} is missing measured round ${round}.`
        );
      }
    }
  }

  for (const result of rawResults) {
    assertNonNegativeNumber(
      result.requestsPerSecond,
      `${result.algorithm} round ${result.round} throughput`
    );

    assertNonNegativeNumber(
      result.totalRequests,
      `${result.algorithm} round ${result.round} total requests`
    );

    if (
      result.errors > 0 ||
      result.timeouts > 0
    ) {
      console.warn(
        `Warning: ${result.algorithm} round ${result.round} reported ` +
          `${result.errors} errors and ${result.timeouts} timeouts.`
      );
    }
  }
}

async function main() {
  let redisConnected = false;

  try {
    await connectRedis();
    redisConnected = true;

    const environment = await collectEnvironmentMetadata();
    const rawResults = [];

    console.log("\nThrottleX — High-Limit Benchmark");
    console.log(`Target: ${BASE_URL}`);
    console.log(`Rounds per algorithm: ${ROUNDS}`);
    console.log(`Duration per measured run: ${DURATION_SECONDS}s`);
    console.log(
      `Warm-up duration per algorithm: ${WARMUP_DURATION_SECONDS}s`
    );
    console.log(`Concurrent connections: ${CONNECTIONS}`);
    console.log(`Pipelining: ${PIPELINING}`);
    console.log(`Node.js: ${environment.nodeVersion}`);
    console.log(
      `Redis: ${environment.redisVersion ?? "version unavailable"}`
    );
    console.log(
      `Planned measured time: ${
        ROUNDS * scenarios.length * DURATION_SECONDS
      } seconds, excluding warm-up and setup`
    );

    console.log("\n========== WARM-UP PHASE ==========");

    for (const scenario of shuffle(scenarios)) {
      console.log(`\nWarming up ${scenario.name}...`);

      await clearScenarioKeys(scenario.keyPrefix);

      const warmupResult = await runBenchmark(scenario, 0, {
        durationSeconds: WARMUP_DURATION_SECONDS,
        label: `${scenario.name} - Warm-up`,
      });

      console.log(
        `Warm-up complete: ${warmupResult.requestsPerSecond.toFixed(2)} req/s; ` +
          `errors: ${warmupResult.errors}; ` +
          `timeouts: ${warmupResult.timeouts}`
      );

      // Warm-up measurements are deliberately excluded from the report.
      await clearScenarioKeys(scenario.keyPrefix);
    }

    console.log(
      "\nWarm-up complete. Starting measured rounds."
    );

    for (let round = 1; round <= ROUNDS; round++) {
      console.log(
        `\n========== Round ${round}/${ROUNDS} ==========`
      );

      for (const scenario of shuffle(scenarios)) {
        console.log(`\nBenchmarking ${scenario.name}...`);

        await clearScenarioKeys(scenario.keyPrefix);

        const result = await runBenchmark(scenario, round);
        rawResults.push(result);

        const successfulResponses = Object.entries(
          result.statusCounts
        ).reduce(
          (sum, [status, count]) =>
            status.startsWith("2") ? sum + count : sum,
          0
        );

        console.log(
          `Requests/sec: ${result.requestsPerSecond.toFixed(2)} | ` +
            `2xx: ${successfulResponses} | ` +
            `429: ${result.statusCounts["429"] ?? 0} | ` +
            `p97.5: ${result.latencyMs.p97_5} ms | ` +
            `errors: ${result.errors} | ` +
            `timeouts: ${result.timeouts}`
        );
      }
    }

    validateCompletedRuns(rawResults);

    const summary = summarize(rawResults);

    if (
      summary.some(
        (item) => item.rounds !== ROUNDS
      )
    ) {
      throw new Error(
        "Incomplete benchmark: one or more algorithms are missing measured rounds."
      );
    }

    console.log("\n========== MEDIAN SUMMARY ==========");

    console.table(
      summary.map((item) => ({
        Algorithm: item.algorithm,
        "Median req/sec": item.medianRequestsPerSecond,
        "Median p50 ms": item.medianLatencyMs.p50,
        "Median p97.5 ms": item.medianLatencyMs.p97_5,
        "Median p99 ms": item.medianLatencyMs.p99,
        "Total 2xx": item.total2xx,
        "Total 429": item.total429,
        "Total 5xx": item.total5xx,
        Errors: item.totalErrors,
        Timeouts: item.totalTimeouts,
      }))
    );

    await mkdir(resultsDirectory, { recursive: true });

    const generatedAt = new Date().toISOString();
    const timestamp = generatedAt.replace(/[:.]/g, "-");

    const outputFile = join(
      resultsDirectory,
      `rate-limiter-high-limit-${timestamp}.json`
    );

    const report = {
      project: "ThrottleX",
      benchmarkType: "high-limit-algorithm-overhead",
      baseUrl: BASE_URL,
      generatedAt,
      complete: true,

      environment,

      configuration: {
        rounds: ROUNDS,
        durationSeconds: DURATION_SECONDS,
        connections: CONNECTIONS,
        pipelining: PIPELINING,
        randomizedOrder: true,
        runTimeoutMs: RUN_TIMEOUT_MS,
        warmupDurationSeconds: WARMUP_DURATION_SECONDS,
        warmupRunsPerAlgorithm: 1,
        warmupResultsIncludedInSummary: false,
      },

      notes: [
        "This benchmark compares complete endpoint implementations.",
        "Both algorithms use a configured limit of 1000000.",
        "The algorithms have different Redis data structures and operations.",
        "Results describe this environment and are not universal rankings.",
        "Latency summary values are medians of run-level percentiles.",
        "Warm-up runs are excluded from the measured summary and rawResults.",
        "Benchmark-specific Redis keys are cleared before warm-up and each measured run.",
        "A report is saved only when all configured measured runs finish with valid metrics.",
        "Autocannon errors and timeouts are recorded and should be considered when interpreting results.",
        "Redis version is null if it could not be collected; check environment.redisVersionError for the reason.",
      ],

      summary,
      rawResults,
    };

    await writeFile(
      outputFile,
      JSON.stringify(report, null, 2),
      "utf8"
    );

    console.log(`\nReport saved to:\n${outputFile}`);
  } finally {
    if (redisConnected) {
      await disconnectRedis();
    }
  }
}

main().catch((error) => {
  console.error("\nBenchmark failed:", error);
  process.exitCode = 1;
});
