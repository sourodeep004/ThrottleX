
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const resultsDirectory = join(scriptDirectory, "results");

// Keep comparison outputs outside results/ so the existing benchmark
// validator does not mistake them for raw benchmark reports.
const outputDirectory = scriptDirectory;

const HIGH_LIMIT_TYPES = new Set([
  "high-limit-algorithm-overhead",
]);

const OVERLOAD_TYPES = new Set([
  "overload-protection",
  "repeatable-overload-test",
]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values) {
  const valid = values
    .filter(isFiniteNumber)
    .sort((a, b) => a - b);

  if (valid.length === 0) return null;

  const middle = Math.floor(valid.length / 2);

  return valid.length % 2 === 0
    ? (valid[middle - 1] + valid[middle]) / 2
    : valid[middle];
}

function sumKnown(values) {
  const valid = values.filter(isFiniteNumber);

  return valid.length === 0
    ? null
    : valid.reduce((total, value) => total + value, 0);
}

function sumStatusCounts(statusCounts, predicate) {
  if (
    !statusCounts ||
    typeof statusCounts !== "object" ||
    Array.isArray(statusCounts)
  ) {
    return null;
  }

  const matchingEntries = Object.entries(statusCounts).filter(
    ([status]) => predicate(status)
  );

  return matchingEntries.reduce(
    (total, [, count]) =>
      total + (isFiniteNumber(count) ? count : 0),
    0
  );
}

function firstNumber(...values) {
  return values.find(isFiniteNumber) ?? null;
}

function getLatency(item) {
  return item?.latencyMs ?? item?.latency ?? null;
}

function normalizeResult(item, fallbackAlgorithm = "Unknown") {
  const statusCounts = item?.statusCounts ?? null;
  const latency = getLatency(item);

  const algorithm =
    item?.algorithm ??
    item?.name ??
    item?.limiter ??
    fallbackAlgorithm;

  return {
    algorithm,
    endpoint: item?.endpoint ?? null,

    requestsPerSecond: firstNumber(
      item?.requestsPerSecond,
      item?.medianRequestsPerSecond,
      item?.throughput?.requestsPerSecond,
      item?.requests?.average
    ),

    totalRequests: firstNumber(
      item?.totalRequests,
      item?.countedResponses,
      item?.requests?.total
    ),

    latencyMs: {
      average: firstNumber(latency?.average),
      p50: firstNumber(latency?.p50),
      p97_5: firstNumber(
        latency?.p97_5,
        latency?.p97_5Ms,
        latency?.["p97.5"]
      ),
      p99: firstNumber(latency?.p99),
      max: firstNumber(latency?.max),
    },

    statusCounts,

    total2xx: firstNumber(
      item?.total2xx,
      item?.successfulResponses,
      sumStatusCounts(statusCounts, (status) =>
        status.startsWith("2")
      )
    ),

    total429: firstNumber(
      item?.total429,
      statusCounts?.["429"]
    ),

    total5xx: firstNumber(
      item?.total5xx,
      sumStatusCounts(statusCounts, (status) =>
        status.startsWith("5")
      )
    ),

    errors: firstNumber(item?.errors, item?.totalErrors),
    timeouts: firstNumber(item?.timeouts, item?.totalTimeouts),
    round: item?.round ?? null,
    configuration: item?.configuration ?? null,
  };
}

function getArrayAt(object, key) {
  return Array.isArray(object?.[key]) ? object[key] : null;
}

function extractOverloadResults(report) {
  // Current overload report format.
  const results = getArrayAt(report, "results");

  if (results?.length) {
    return {
      results,
      source: "results",
    };
  }

  // Possible legacy formats. Only arrays containing objects are used.
  const candidates = [
    "rawResults",
    "runs",
    "rounds",
    "measurements",
    "benchmarkResults",
    "algorithmResults",
  ];

  for (const key of candidates) {
    const candidate = getArrayAt(report, key);

    if (
      candidate?.length &&
      candidate.some(
        (item) => item && typeof item === "object"
      )
    ) {
      return {
        results: candidate,
        source: key,
      };
    }
  }

  // Some reports store algorithm results inside a summary object.
  if (
    report.summary &&
    typeof report.summary === "object" &&
    !Array.isArray(report.summary)
  ) {
    for (const key of candidates) {
      const candidate = getArrayAt(report.summary, key);

      if (
        candidate?.length &&
        candidate.some(
          (item) => item && typeof item === "object"
        )
      ) {
        return {
          results: candidate,
          source: `summary.${key}`,
        };
      }
    }
  }

  // Some legacy summaries are arrays rather than objects.
  const summaryArray = getArrayAt(report, "summary");

  if (summaryArray?.length) {
    return {
      results: summaryArray,
      source: "summary",
    };
  }

  return {
    results: [],
    source: null,
  };
}

function normalizeHighLimit(report, filename) {
  if (!Array.isArray(report.summary)) {
    return null;
  }

  return {
    sourceFile: filename,
    generatedAt: report.generatedAt ?? null,
    environment: report.environment ?? null,

    algorithms: report.summary.map((item) =>
      normalizeResult(item)
    ),
  };
}

function normalizeOverload(report, filename) {
  const extracted = extractOverloadResults(report);

  if (extracted.results.length === 0) {
    return {
      normalized: null,
      warning:
        "No supported result array found; report was not included in the algorithm overview.",
    };
  }

  return {
    normalized: {
      sourceFile: filename,
      generatedAt: report.generatedAt ?? null,
      environment: report.environment ?? null,
      resultsSource: extracted.source,

      algorithms: extracted.results.map((item) =>
        normalizeResult(item)
      ),
    },
    warning:
      extracted.source === "results"
        ? null
        : `Legacy result data extracted from "${extracted.source}". Verify its schema before relying on comparisons.`,
  };
}

function groupAlgorithms(reports) {
  const grouped = new Map();

  for (const report of reports) {
    for (const item of report.algorithms) {
      const key = item.algorithm;

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }

      grouped.get(key).push(item);
    }
  }

  return grouped;
}

function createOverview(reports) {
  const grouped = groupAlgorithms(reports);

  return [...grouped.entries()].map(([algorithm, items]) => ({
    algorithm,
    reportEntries: items.length,

    medianRequestsPerSecond: median(
      items.map((item) => item.requestsPerSecond)
    ),

    medianP50Ms: median(
      items.map((item) => item.latencyMs?.p50)
    ),

    medianP97_5Ms: median(
      items.map((item) => item.latencyMs?.p97_5)
    ),

    medianP99Ms: median(
      items.map((item) => item.latencyMs?.p99)
    ),

    total2xx: sumKnown(items.map((item) => item.total2xx)),
    total429: sumKnown(items.map((item) => item.total429)),
    total5xx: sumKnown(items.map((item) => item.total5xx)),
    totalErrors: sumKnown(items.map((item) => item.errors)),
    totalTimeouts: sumKnown(items.map((item) => item.timeouts)),
  }));
}

async function loadReports() {
  await mkdir(resultsDirectory, { recursive: true });

  const filenames = (await readdir(resultsDirectory))
    .filter((filename) => filename.endsWith(".json"))
    .filter(
      (filename) =>
        !filename.startsWith("benchmark-comparison-")
    )
    .sort();

  const highLimitReports = [];
  const overloadReports = [];
  const skippedFiles = [];
  const warnings = [];

  for (const filename of filenames) {
    const fullPath = join(resultsDirectory, filename);

    let report;

    try {
      report = JSON.parse(await readFile(fullPath, "utf8"));
    } catch (error) {
      skippedFiles.push({
        filename,
        reason: `Invalid JSON: ${error.message}`,
      });
      continue;
    }

    if (HIGH_LIMIT_TYPES.has(report.benchmarkType)) {
      const normalized = normalizeHighLimit(report, filename);

      if (!normalized || normalized.algorithms.length === 0) {
        skippedFiles.push({
          filename,
          reason:
            "High-limit report is missing a non-empty summary array.",
        });
        continue;
      }

      highLimitReports.push(normalized);
      continue;
    }

    if (OVERLOAD_TYPES.has(report.benchmarkType)) {
      const result = normalizeOverload(report, filename);

      if (!result.normalized) {
        skippedFiles.push({
          filename,
          reason: result.warning,
        });
        continue;
      }

      overloadReports.push(result.normalized);

      if (result.warning) {
        warnings.push({
          filename,
          warning: result.warning,
        });
      }

      continue;
    }

    skippedFiles.push({
      filename,
      reason: `Unsupported or missing benchmarkType: ${
        report.benchmarkType ?? "(missing)"
      }`,
    });
  }

  return {
    highLimitReports,
    overloadReports,
    skippedFiles,
    warnings,
  };
}

async function main() {
  const {
    highLimitReports,
    overloadReports,
    skippedFiles,
    warnings,
  } = await loadReports();

  const generatedAt = new Date().toISOString();

  const outputFilename =
    `benchmark-comparison-${generatedAt.replace(/[:.]/g, "-")}.json`;

  const comparison = {
    project: "ThrottleX",
    benchmarkType: "benchmark-comparison",
    baseUrl: process.env.BENCH_URL ?? "http://localhost:5000",
    generatedAt,
    complete: true,

    methodology: {
      highLimit:
        "High-limit algorithm overhead is summarized separately from overload protection.",
      overloadProtection:
        "Overload results describe behavior under the configured rate limits.",
      aggregation:
        "Latency and throughput use medians of available report-level values. Response counts are summed only when the source values are available.",
      caveats: [
        "Results may come from different environments and configurations.",
        "Legacy report schemas may expose different metrics.",
        "Missing metrics remain null and are not assumed to be zero.",
        "High-limit and overload results must not be combined into a single performance ranking.",
        "This comparison script does not independently validate source report correctness.",
      ],
    },

    sourceReportCounts: {
      highLimit: highLimitReports.length,
      overloadProtection: overloadReports.length,
      skipped: skippedFiles.length,
      legacyWarnings: warnings.length,
    },

    highLimit: {
      reports: highLimitReports,
      overview: createOverview(highLimitReports),
    },

    overloadProtection: {
      reports: overloadReports,
      overview: createOverview(overloadReports),
    },

    warnings,
    skippedFiles,
  };

  // Save beside this script, not inside results/. This keeps the comparison
  // separate from raw benchmark artifacts consumed by validate-reports.js.
  const outputPath = join(outputDirectory, outputFilename);

  await writeFile(
    outputPath,
    JSON.stringify(comparison, null, 2),
    "utf8"
  );

  console.log("\nThrottleX — Benchmark Comparison");
  console.log("================================");
  console.log(`High-limit reports: ${highLimitReports.length}`);
  console.log(`Overload reports:   ${overloadReports.length}`);
  console.log(`Skipped reports:    ${skippedFiles.length}`);
  console.log(`Legacy warnings:    ${warnings.length}`);

  console.log("\nHigh-limit overview:");
  console.table(comparison.highLimit.overview);

  console.log("\nOverload-protection overview:");
  console.table(comparison.overloadProtection.overview);

  if (warnings.length > 0) {
    console.log("\nLegacy warnings:");
    console.table(warnings);
  }

  if (skippedFiles.length > 0) {
    console.log("\nSkipped reports:");
    console.table(skippedFiles);
  }

  console.log(`\nComparison saved to:\n${outputPath}`);
}

main().catch((error) => {
  console.error("\nComparison generation failed:", error);
  process.exitCode = 1;
});
