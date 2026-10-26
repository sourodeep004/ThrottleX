import { Router } from "express";
import { spawn } from "node:child_process";
import { env } from "../config/env.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTrafficMetrics } from "../middleware/requestLogger.js";

const router = Router();

/**
 * GET /api/metrics/traffic?range=15m
 *
 * Returns live HTTP traffic recorded by requestLogger.js.
 * Supported ranges: 15m, 30m, 1h.
 */
router.get("/traffic", (req, res) => {
  sendNoStoreHeaders(res);

  const supportedRanges = {
    "15m": 15,
    "30m": 30,
    "1h": 60,
  };

  const requestedRange =
    typeof req.query.range === "string"
      ? req.query.range
      : "15m";

  const range = supportedRanges[requestedRange]
    ? requestedRange
    : "15m";

  const metrics = getTrafficMetrics();

  const series = metrics.history
    .slice(-supportedRanges[range])
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      // The frontend chart uses `time` for its x-axis labels.
      time: new Date(bucket.timestamp).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      incoming: bucket.incomingRequests,
      limited: bucket.limitedRequests,
    }));

  return res.status(200).json({
    success: true,
    source: metrics.source,
    range,
    generatedAt: metrics.generatedAt,
    totals: metrics.totals,
    series,
  });
});

const backendRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultsDirectory = fileURLToPath(
  new URL("../../benchmarks/results/", import.meta.url)
);

const MAX_OUTPUT_LINES = 80;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

const VALID_RANGES = new Set(["24h", "7d", "30d", "all"]);
const VALID_ALGORITHMS = new Set([
  "all",
  "sliding window",
  "token bucket",
]);

let benchmarkJob = {
  id: null,
  running: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  output: [],
};

let benchmarkProcess = null;

function appendOutput(chunk) {
  const lines = String(chunk)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return;

  benchmarkJob.output = [
    ...benchmarkJob.output,
    ...lines,
  ].slice(-MAX_OUTPUT_LINES);
}

function getTimestamp(value) {
  if (!value) return 0;

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getReportTimestamp(entry) {
  return (
    getTimestamp(entry.report.generatedAt) ||
    entry.modifiedAt
  );
}

function getAlgorithmSummary(report) {
  if (!Array.isArray(report?.summary)) return [];

  return report.summary.map((item) => ({
    name: item.algorithm ?? "Unknown",
    rounds: item.rounds ?? null,
    requestsPerSecond: item.medianRequestsPerSecond ?? null,
    p50LatencyMs: item.medianLatencyMs?.p50 ?? null,
    p975LatencyMs: item.medianLatencyMs?.p97_5 ?? null,
    p99LatencyMs: item.medianLatencyMs?.p99 ?? null,
    accepted2xx: item.total2xx ?? null,
    rejected429: item.total429 ?? null,
    serverErrors5xx: item.total5xx ?? null,
    errors: item.totalErrors ?? null,
    timeouts: item.totalTimeouts ?? null,
  }));
}

/**
 * Strictly validates a saved ThrottleX benchmark report.
 *
 * A report is accepted only when it is marked complete, has a valid
 * generatedAt timestamp, and contains exactly one well-formed summary
 * and the full set of raw rounds for every required algorithm.
 */
function isValidReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.project !== "ThrottleX" ||
    report.complete !== true ||
    typeof report.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(report.generatedAt)) ||
    !Array.isArray(report.summary) ||
    !Array.isArray(report.rawResults) ||
    !report.configuration ||
    !Number.isInteger(report.configuration.rounds) ||
    report.configuration.rounds < 1
  ) {
    return false;
  }

  const requiredAlgorithms = [
    "Sliding Window",
    "Token Bucket",
  ];

  for (const algorithm of requiredAlgorithms) {
    const matchingSummaries = report.summary.filter(
      (item) => item?.algorithm === algorithm
    );

    if (matchingSummaries.length !== 1) {
      return false;
    }

    const summary = matchingSummaries[0];
    const latency = summary.medianLatencyMs;

    const summaryCounters = [
      summary.total2xx,
      summary.total429,
      summary.total5xx,
      summary.totalErrors,
      summary.totalTimeouts,
    ];

    if (
      summary.rounds !== report.configuration.rounds ||
      !Number.isFinite(summary.medianRequestsPerSecond) ||
      summary.medianRequestsPerSecond < 0 ||
      !latency ||
      !Number.isFinite(latency.p50) ||
      !Number.isFinite(latency.p97_5) ||
      !Number.isFinite(latency.p99) ||
      summaryCounters.some(
        (value) => !Number.isFinite(value) || value < 0
      )
    ) {
      return false;
    }

    const runs = report.rawResults.filter(
      (run) => run?.algorithm === algorithm
    );

    const roundNumbers = new Set();

    for (const run of runs) {
      if (
        !Number.isInteger(run.round) ||
        run.round < 1 ||
        run.round > report.configuration.rounds ||
        roundNumbers.has(run.round) ||
        !Number.isFinite(run.requestsPerSecond) ||
        run.requestsPerSecond < 0 ||
        !Number.isFinite(run.totalRequests) ||
        run.totalRequests < 0 ||
        !run.latencyMs ||
        !Number.isFinite(run.latencyMs.p50) ||
        !Number.isFinite(run.latencyMs.p97_5) ||
        !Number.isFinite(run.latencyMs.p99) ||
        !Number.isFinite(run.errors) ||
        run.errors < 0 ||
        !Number.isFinite(run.timeouts) ||
        run.timeouts < 0 ||
        !run.statusCounts ||
        typeof run.statusCounts !== "object" ||
        Array.isArray(run.statusCounts)
      ) {
        return false;
      }

      roundNumbers.add(run.round);
    }

    if (runs.length !== report.configuration.rounds) {
      return false;
    }
  }

  return true;
}

/**
 * Load valid benchmark reports newest-first.
 *
 * The report's generatedAt timestamp is the primary sort key so copying
 * or touching an older report file cannot make it appear newer.
 *
 * File modification time and filename provide deterministic fallbacks.
 */
async function getBenchmarkReports() {
  let filenames;

  try {
    filenames = await readdir(resultsDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const jsonFiles = filenames.filter((filename) =>
    filename.toLowerCase().endsWith(".json")
  );

  const entries = await Promise.all(
    jsonFiles.map(async (filename) => {
      const filePath = join(resultsDirectory, filename);

      try {
        const fileStats = await stat(filePath);

        if (!fileStats.isFile()) return null;

        const contents = await readFile(filePath, "utf8");
        const report = JSON.parse(contents);

        if (!isValidReport(report)) return null;

        return {
          filename,
          report,
          modifiedAt: fileStats.mtimeMs,
          generatedAtMs: getTimestamp(report.generatedAt),
        };
      } catch (error) {
        // Ignore incomplete reports and files removed during reading.
        if (
          error instanceof SyntaxError ||
          error.code === "ENOENT" ||
          error.code === "EISDIR"
        ) {
          return null;
        }

        throw error;
      }
    })
  );

  return entries
    .filter(Boolean)
    .sort((a, b) => {
      // Prefer the actual time recorded by the benchmark report.
      // Reports without a valid generatedAt timestamp sort after valid ones.
      if (a.generatedAtMs !== b.generatedAtMs) {
        if (a.generatedAtMs === 0) return 1;
        if (b.generatedAtMs === 0) return -1;

        return b.generatedAtMs - a.generatedAtMs;
      }

      // Fall back to filesystem modification time when generatedAt values
      // are equal or both are unavailable.
      if (a.modifiedAt !== b.modifiedAt) {
        return b.modifiedAt - a.modifiedAt;
      }

      // Keep ordering deterministic if both timestamps match.
      return b.filename.localeCompare(a.filename);
    });
}

function normalizeAlgorithm(value) {
  const normalized = String(value ?? "all")
    .trim()
    .toLowerCase();

  return VALID_ALGORITHMS.has(normalized) ? normalized : null;
}

function getRangeStart(range) {
  const now = Date.now();

  switch (range) {
    case "24h":
      return now - 24 * 60 * 60 * 1000;

    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;

    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;

    case "all":
    default:
      return 0;
  }
}

function filterReports(reports, range) {
  const start = getRangeStart(range);

  if (start === 0) return reports;

  return reports.filter(
    (entry) => getReportTimestamp(entry) >= start
  );
}

function filterAlgorithms(algorithms, algorithm) {
  if (algorithm === "all") return algorithms;

  return algorithms.filter(
    (item) => item.name.toLowerCase() === algorithm
  );
}

function findAlgorithm(report, algorithmName) {
  return (
    report.summary?.find(
      (item) =>
        item.algorithm?.toLowerCase() ===
        algorithmName.toLowerCase()
    ) ?? null
  );
}

function formatMetricsResponse(report, filename) {
  const slidingWindow = findAlgorithm(report, "Sliding Window");
  const tokenBucket = findAlgorithm(report, "Token Bucket");

  return {
    success: true,
    source: "saved-benchmark",
    benchmarkType: report.benchmarkType ?? "unknown",
    generatedAt: report.generatedAt ?? null,
    configuration: report.configuration ?? null,

    metrics: {
      throughput:
        slidingWindow?.medianRequestsPerSecond ?? null,

      p50LatencyMs:
        slidingWindow?.medianLatencyMs?.p50 ?? null,

      p975LatencyMs:
        slidingWindow?.medianLatencyMs?.p97_5 ?? null,

      p99LatencyMs:
        slidingWindow?.medianLatencyMs?.p99 ?? null,

      errors: slidingWindow?.totalErrors ?? null,
      timeouts: slidingWindow?.totalTimeouts ?? null,
      rejected429: slidingWindow?.total429 ?? null,
    },

    algorithms: getAlgorithmSummary(report),
    reportFile: filename,
    notes: report.notes ?? report.limitations ?? [],

    availableAlgorithms: {
      slidingWindow: Boolean(slidingWindow),
      tokenBucket: Boolean(tokenBucket),
    },
  };
}

function sendNoStoreHeaders(res) {
  res.set({
    "Cache-Control":
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
}

function getJobSnapshot() {
  return {
    ...benchmarkJob,
    output: [...benchmarkJob.output],
  };
}

function finishBenchmark(code, error = null) {
  benchmarkJob.running = false;
  benchmarkJob.finishedAt = new Date().toISOString();
  benchmarkJob.exitCode = code;
  benchmarkJob.error = error;

  if (error) {
    appendOutput(`Benchmark failed: ${error}`);
  } else if (code === 0) {
    appendOutput("Benchmark completed successfully.");
  } else {
    appendOutput(`Benchmark process exited with code ${code}.`);
  }

  benchmarkProcess = null;
}

/**
 * GET /api/metrics/run/status
 * Returns the current in-memory benchmark job state.
 */
router.get("/run/status", (_req, res) => {
  sendNoStoreHeaders(res);

  return res.status(200).json({
    success: true,
    job: getJobSnapshot(),
  });
});

/**
 * POST /api/metrics/run
 * Starts the benchmark runner as a child process.
 */
router.post("/run", (_req, res) => {
  if (env.NODE_ENV === "production") {
    return res.status(403).json({
      success: false,
      error: {
        code: "BENCHMARK_DISABLED",
        message: "Benchmark execution is disabled in production.",
      },
    });
  }

  if (benchmarkJob.running || benchmarkProcess) {
    return res.status(409).json({
      success: false,
      error: {
        code: "BENCHMARK_RUNNING",
        message: "A benchmark is already running.",
        job: getJobSnapshot(),
      },
    });
  }

  benchmarkJob = {
    id: `${Date.now()}`,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    output: ["Starting benchmark runner…"],
  };

  try {
    const child = spawn(
      process.execPath,
      ["benchmarks/rate-limiter.bench.js"],
      {
        cwd: backendRoot,

        env: {
          ...process.env,
          BENCH_URL:
            process.env.BENCH_URL || `http://localhost:${env.PORT}`,
        },

        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );

    benchmarkProcess = child;

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);

    child.once("error", (error) => {
      if (benchmarkProcess !== child) return;

      finishBenchmark(
        null,
        `Could not start benchmark process: ${error.message}`
      );
    });

    child.once("close", (code, signal) => {
      if (benchmarkProcess !== child) return;

      if (signal) {
        finishBenchmark(
          code,
          `Benchmark process terminated by signal ${signal}.`
        );
        return;
      }

      finishBenchmark(
        code,
        code === 0
          ? null
          : `Benchmark process exited with code ${code}.`
      );
    });
  } catch (error) {
    finishBenchmark(
      null,
      error instanceof Error ? error.message : String(error)
    );

    return res.status(500).json({
      success: false,
      error: {
        code: "BENCHMARK_START_FAILED",
        message: benchmarkJob.error,
      },
      job: getJobSnapshot(),
    });
  }

  sendNoStoreHeaders(res);

  return res.status(202).json({
    success: true,
    job: getJobSnapshot(),
  });
});

/**
 * GET /api/metrics/history
 *
 * Query parameters:
 *   limit=20
 *   range=24h|7d|30d|all
 *   algorithm=all|Sliding%20Window|Token%20Bucket
 *
 * Returns saved reports newest-first. Each report contains only
 * the selected algorithm when an algorithm filter is supplied.
 */
router.get("/history", async (req, res, next) => {
  try {
    sendNoStoreHeaders(res);

    const parsedLimit = Number.parseInt(req.query.limit, 10);

    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_HISTORY_LIMIT)
      : DEFAULT_HISTORY_LIMIT;

    const range = String(req.query.range ?? "all").toLowerCase();

    if (!VALID_RANGES.has(range)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_RANGE",
          message: "range must be 24h, 7d, 30d, or all.",
        },
      });
    }

    const algorithm = normalizeAlgorithm(req.query.algorithm);

    if (algorithm === null) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_ALGORITHM",
          message:
            "algorithm must be all, Sliding Window, or Token Bucket.",
        },
      });
    }

    const allReports = await getBenchmarkReports();
    const rangedReports = filterReports(allReports, range);

    const history = rangedReports
      .slice(0, limit)
      .map((entry) => ({
        reportFile: entry.filename,

        generatedAt:
          entry.report.generatedAt ??
          new Date(entry.modifiedAt).toISOString(),

        benchmarkType: entry.report.benchmarkType ?? "unknown",
        configuration: entry.report.configuration ?? null,

        algorithms: filterAlgorithms(
          getAlgorithmSummary(entry.report),
          algorithm
        ),
      }));

    return res.status(200).json({
      success: true,

      filters: {
        limit,
        range,

        algorithm:
          algorithm === "all"
            ? "all"
            : algorithm === "sliding window"
              ? "Sliding Window"
              : "Token Bucket",
      },

      count: history.length,
      totalReports: rangedReports.length,
      history,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/metrics/comparison
 *
 * Compares the newest saved report with the previous saved report.
 * Optional query parameter:
 *   algorithm=all|Sliding%20Window|Token%20Bucket
 */
router.get("/comparison", async (req, res, next) => {
  try {
    sendNoStoreHeaders(res);

    const algorithm = normalizeAlgorithm(req.query.algorithm);

    if (algorithm === null) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_ALGORITHM",
          message:
            "algorithm must be all, Sliding Window, or Token Bucket.",
        },
      });
    }

    const reports = await getBenchmarkReports();

    if (reports.length < 2) {
      return res.status(200).json({
        success: true,
        available: false,

        message:
          "At least two saved benchmark reports are required for comparison.",

        latest: reports[0]
          ? {
              reportFile: reports[0].filename,

              generatedAt:
                reports[0].report.generatedAt ??
                new Date(reports[0].modifiedAt).toISOString(),
            }
          : null,

        previous: null,
        comparisons: [],
      });
    }

    const latest = reports[0];
    const previous = reports[1];

    const latestAlgorithms = filterAlgorithms(
      getAlgorithmSummary(latest.report),
      algorithm
    );

    const previousAlgorithms = filterAlgorithms(
      getAlgorithmSummary(previous.report),
      algorithm
    );

    function percentageChange(current, prior) {
      if (
        typeof current !== "number" ||
        typeof prior !== "number" ||
        !Number.isFinite(current) ||
        !Number.isFinite(prior)
      ) {
        return null;
      }

      if (prior === 0) {
        return current === 0 ? 0 : null;
      }

      return Number(
        (((current - prior) / Math.abs(prior)) * 100).toFixed(2)
      );
    }

    const comparisons = latestAlgorithms.map((current) => {
      const prior = previousAlgorithms.find(
        (item) => item.name === current.name
      );

      if (!prior) {
        return {
          algorithm: current.name,
          available: false,
          latest: current,
          previous: null,
          changes: null,
        };
      }

      return {
        algorithm: current.name,
        available: true,
        latest: current,
        previous: prior,

        changes: {
          requestsPerSecondPercent: percentageChange(
            current.requestsPerSecond,
            prior.requestsPerSecond
          ),

          p50LatencyMsPercent: percentageChange(
            current.p50LatencyMs,
            prior.p50LatencyMs
          ),

          p975LatencyMsPercent: percentageChange(
            current.p975LatencyMs,
            prior.p975LatencyMs
          ),

          p99LatencyMsPercent: percentageChange(
            current.p99LatencyMs,
            prior.p99LatencyMs
          ),

          errorsPercent: percentageChange(
            current.errors,
            prior.errors
          ),

          timeoutsPercent: percentageChange(
            current.timeouts,
            prior.timeouts
          ),
        },
      };
    });

    return res.status(200).json({
      success: true,
      available: true,

      latest: {
        reportFile: latest.filename,

        generatedAt:
          latest.report.generatedAt ??
          new Date(latest.modifiedAt).toISOString(),

        benchmarkType: latest.report.benchmarkType ?? "unknown",
      },

      previous: {
        reportFile: previous.filename,

        generatedAt:
          previous.report.generatedAt ??
          new Date(previous.modifiedAt).toISOString(),

        benchmarkType: previous.report.benchmarkType ?? "unknown",
      },

      algorithm:
        algorithm === "all"
          ? "all"
          : algorithm === "sliding window"
            ? "Sliding Window"
            : "Token Bucket",

      comparisons,

      note:
        "Percentage changes compare the newest saved report with the previous saved report. Negative latency changes indicate lower latency; negative throughput changes indicate lower throughput.",
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/metrics
 * Returns the newest valid saved benchmark report.
 */
router.get("/", async (_req, res, next) => {
  try {
    sendNoStoreHeaders(res);

    const reports = await getBenchmarkReports();

    if (reports.length === 0) {
      return res.status(200).json({
        success: true,
        source: "no-benchmark",
        benchmarkType: null,
        generatedAt: null,
        configuration: null,
        metrics: null,
        algorithms: [],
        reportFile: null,
        notes: [],

        availableAlgorithms: {
          slidingWindow: false,
          tokenBucket: false,
        },

        message:
          "No valid benchmark report found. Run a benchmark first.",
      });
    }

    const latest = reports[0];

    return res.status(200).json(
      formatMetricsResponse(latest.report, latest.filename)
    );
  } catch (error) {
    return next(error);
  }
});

export default router;