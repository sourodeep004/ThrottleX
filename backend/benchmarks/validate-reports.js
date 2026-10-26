
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const resultsDirectory = join(scriptDirectory, "results");

const SUPPORTED_TYPES = new Set([
  "high-limit-algorithm-overhead",
  "overload-protection",
  "repeatable-benchmark",
  "repeatable",
  "repeatable-overload-test",
]);

const OVERLOAD_ALGORITHMS = [
  "Fixed Window",
  "Sliding Window",
  "Token Bucket",
];

const HIGH_LIMIT_ALGORITHMS = [
  "Sliding Window",
  "Token Bucket",
];

const LEGACY_REPEATABLE_TYPES = new Set([
  "repeatable-overload",
  "repeatable-overload-test",
  "repeatable",
  "repeatable-benchmark",
]);

const isObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value);

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const isNonNegativeNumber = (value) =>
  isFiniteNumber(value) && value >= 0;

const isNonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0;

const isPositiveInteger = (value) =>
  Number.isInteger(value) && value > 0;

function detectBenchmarkType(report) {
  const declaredType = report.benchmarkType;

  if (
    typeof declaredType === "string" &&
    SUPPORTED_TYPES.has(declaredType)
  ) {
    return declaredType;
  }

  // Older high-limit reports use summary and rawResults.
  if (
    Array.isArray(report.summary) &&
    Array.isArray(report.rawResults)
  ) {
    return "high-limit-algorithm-overhead";
  }

  const results = Array.isArray(report.results)
    ? report.results
    : [];

  // Older overload reports contain the three rate-limit algorithms.
  if (
    results.some((item) =>
      OVERLOAD_ALGORITHMS.includes(item?.algorithm)
    )
  ) {
    return "overload-protection";
  }

  // Recognize repeatable reports even when their old type name
  // is no longer part of the supported current schema.
  if (
    LEGACY_REPEATABLE_TYPES.has(declaredType) ||
    results.length > 0 ||
    Array.isArray(report.runs) ||
    report.repeats !== undefined ||
    report.repeatCount !== undefined
  ) {
    return "repeatable-overload-test";
  }

  return null;
}

function validateLatency(latency, label, errors) {
  if (!isObject(latency)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  for (const key of ["p50", "p97_5", "p99"]) {
    if (!isNonNegativeNumber(latency[key])) {
      errors.push(
        `${label}.${key} must be a non-negative number.`
      );
    }
  }

  const { p50, p97_5, p99 } = latency;

  if (
    isNonNegativeNumber(p50) &&
    isNonNegativeNumber(p97_5) &&
    isNonNegativeNumber(p99) &&
    (p50 > p97_5 || p97_5 > p99)
  ) {
    errors.push(
      `${label} percentiles must satisfy p50 <= p97_5 <= p99.`
    );
  }
}

function validateStatusCounts(statusCounts, label, errors) {
  if (!isObject(statusCounts)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  for (const [status, count] of Object.entries(statusCounts)) {
    if (!/^\d{3}$/.test(status)) {
      errors.push(
        `${label} contains invalid HTTP status "${status}".`
      );
    }

    if (!isNonNegativeInteger(count)) {
      errors.push(
        `${label}.${status} must be a non-negative integer.`
      );
    }
  }
}

function validateConfiguration(configuration, label, errors) {
  if (!isObject(configuration)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  for (const key of [
    "durationSeconds",
    "connections",
    "pipelining",
  ]) {
    if (!isPositiveInteger(configuration[key])) {
      errors.push(
        `${label}.${key} must be a positive integer.`
      );
    }
  }
}

function validateRun(run, index, errors, options = {}) {
  const { allowLegacyFields = false } = options;
  const label = `result[${index}]`;

  if (!isObject(run)) {
    errors.push(`${label} must be an object.`);
    return;
  }

  if (
    typeof run.algorithm !== "string" ||
    run.algorithm.trim() === ""
  ) {
    errors.push(`${label}.algorithm is missing.`);
  }

  if (
    typeof run.endpoint !== "string" ||
    !run.endpoint.startsWith("/")
  ) {
    if (!(allowLegacyFields && run.endpoint === undefined)) {
      errors.push(`${label}.endpoint must start with "/".`);
    }
  }

  if (!isNonNegativeNumber(run.requestsPerSecond)) {
    if (
      !(allowLegacyFields && run.requestsPerSecond === undefined)
    ) {
      errors.push(`${label}.requestsPerSecond is invalid.`);
    }
  }

  if (!isNonNegativeNumber(run.totalRequests)) {
    if (
      !(allowLegacyFields && run.totalRequests === undefined)
    ) {
      errors.push(`${label}.totalRequests is invalid.`);
    }
  }

  if (run.latencyMs === undefined && allowLegacyFields) {
    // Older reports may not have run-level latency measurements.
  } else {
    validateLatency(
      run.latencyMs,
      `${label}.latencyMs`,
      errors
    );
  }

  if (run.statusCounts === undefined && allowLegacyFields) {
    // Older reports may not contain HTTP status counts.
  } else {
    validateStatusCounts(
      run.statusCounts,
      `${label}.statusCounts`,
      errors
    );
  }

  for (const key of ["errors", "timeouts", "non2xx"]) {
    if (
      run[key] !== undefined &&
      !isNonNegativeNumber(run[key])
    ) {
      errors.push(`${label}.${key} must be non-negative.`);
    }
  }

  if (run.configuration !== undefined) {
    validateConfiguration(
      run.configuration,
      `${label}.configuration`,
      errors
    );
  }

  if (
    run.countedResponses !== undefined &&
    !isNonNegativeInteger(run.countedResponses)
  ) {
    errors.push(
      `${label}.countedResponses must be a non-negative integer.`
    );
  }
}

function validateEnvironment(report, warnings) {
  if (!isObject(report.environment)) {
    warnings.push(
      "Environment metadata is missing; regenerate this report with the updated benchmark runner."
    );
    return;
  }

  for (const key of [
    "nodeVersion",
    "platform",
    "redisVersion",
  ]) {
    if (
      typeof report.environment[key] !== "string" ||
      report.environment[key].trim() === ""
    ) {
      warnings.push(
        `Environment metadata "${key}" is missing.`
      );
    }
  }
}

function validateCommonFields(report, errors, warnings) {
  if (report.project !== "ThrottleX") {
    errors.push('project must be "ThrottleX".');
  }

  if (
    typeof report.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(report.generatedAt))
  ) {
    errors.push("generatedAt must be a valid date string.");
  }

  if (
    typeof report.baseUrl !== "string" ||
    report.baseUrl.trim() === ""
  ) {
    errors.push("baseUrl is missing.");
  }

  validateEnvironment(report, warnings);
}

function validateCompletionFlag(report, errors, warnings) {
  if (report.complete === false) {
    errors.push("Report is explicitly marked incomplete.");
  } else if (report.complete !== true) {
    warnings.push(
      "Legacy report: the complete flag is missing. Completion cannot be independently confirmed."
    );
  }
}

function validateHighLimit(report, errors, warnings) {
  if (
    !Array.isArray(report.summary) ||
    !Array.isArray(report.rawResults)
  ) {
    errors.push(
      "High-limit reports require summary and rawResults arrays."
    );
    return;
  }

  if (!isObject(report.configuration)) {
    errors.push("configuration must be an object.");
    return;
  }

  const rounds = report.configuration.rounds;

  if (!isPositiveInteger(rounds)) {
    errors.push(
      "configuration.rounds must be a positive integer."
    );
  }

  validateCompletionFlag(report, errors, warnings);

  for (const key of [
    "durationSeconds",
    "connections",
    "pipelining",
  ]) {
    if (!isPositiveInteger(report.configuration[key])) {
      errors.push(
        `configuration.${key} must be a positive integer.`
      );
    }
  }

  for (const algorithm of HIGH_LIMIT_ALGORITHMS) {
    const summaries = report.summary.filter(
      (item) => item?.algorithm === algorithm
    );

    if (summaries.length !== 1) {
      errors.push(
        `Expected exactly one summary for ${algorithm}.`
      );
      continue;
    }

    const summary = summaries[0];

    if (
      !isPositiveInteger(summary.rounds) ||
      (
        isPositiveInteger(rounds) &&
        summary.rounds !== rounds
      )
    ) {
      errors.push(
        `${algorithm} must have exactly ${rounds} completed rounds.`
      );
    }

    if (
      !isNonNegativeNumber(summary.medianRequestsPerSecond)
    ) {
      errors.push(
        `${algorithm} has invalid median throughput.`
      );
    }

    validateLatency(
      summary.medianLatencyMs,
      `${algorithm}.medianLatencyMs`,
      errors
    );

    for (const key of [
      "total2xx",
      "total429",
      "total5xx",
      "totalErrors",
      "totalTimeouts",
    ]) {
      if (!isNonNegativeNumber(summary[key])) {
        errors.push(`${algorithm}.${key} is invalid.`);
      }
    }
  }

  report.rawResults.forEach((run, index) => {
    validateRun(run, index, errors);

    if (
      isObject(run) &&
      !HIGH_LIMIT_ALGORITHMS.includes(run.algorithm)
    ) {
      errors.push(
        `rawResults[${index}].algorithm is not a recognized high-limit algorithm.`
      );
    }
  });

  if (!isPositiveInteger(rounds)) {
    return;
  }

  for (const algorithm of HIGH_LIMIT_ALGORITHMS) {
    const runs = report.rawResults.filter(
      (run) => run?.algorithm === algorithm
    );

    if (runs.length !== rounds) {
      errors.push(
        `${algorithm} has ${runs.length} raw runs; expected ${rounds}.`
      );
    }

    const seenRounds = new Set();

    for (const run of runs) {
      if (
        !Number.isInteger(run.round) ||
        run.round < 1 ||
        run.round > rounds
      ) {
        errors.push(
          `${algorithm} contains an invalid round number.`
        );
        continue;
      }

      if (seenRounds.has(run.round)) {
        errors.push(
          `${algorithm} contains duplicate round ${run.round}.`
        );
      }

      seenRounds.add(run.round);
    }
  }
}

function validateResultsFormat(report, errors, warnings, type) {
  const hasResults =
    Array.isArray(report.results) &&
    report.results.length > 0;

  const legacyRepeatable =
    type === "repeatable-overload-test" &&
    !hasResults;

  if (legacyRepeatable) {
    warnings.push(
      "Legacy repeatable report has no non-empty results array; run-level metrics could not be fully validated."
    );

    if (!isObject(report.configuration)) {
      warnings.push(
        "Repeatable report has no top-level configuration object."
      );
    }

    if (
      report.repeats !== undefined &&
      !isPositiveInteger(report.repeats)
    ) {
      errors.push(
        "repeats must be a positive integer when present."
      );
    }

    if (
      report.repeatCount !== undefined &&
      !isPositiveInteger(report.repeatCount)
    ) {
      errors.push(
        "repeatCount must be a positive integer when present."
      );
    }

    validateCompletionFlag(report, errors, warnings);
    return;
  }

  if (!hasResults) {
    errors.push("results must be a non-empty array.");
    return;
  }

  const isLegacy =
    report.benchmarkType === undefined ||
    LEGACY_REPEATABLE_TYPES.has(report.benchmarkType);

  report.results.forEach((run, index) =>
    validateRun(run, index, errors, {
      allowLegacyFields: isLegacy,
    })
  );

  const names = new Set(
    report.results
      .filter((run) => typeof run?.algorithm === "string")
      .map((run) => run.algorithm)
  );

  if (type === "overload-protection") {
    for (const algorithm of OVERLOAD_ALGORITHMS) {
      if (!names.has(algorithm)) {
        errors.push(
          `Overload-protection report is missing ${algorithm}.`
        );
      }
    }
  }

  if (
    type === "repeatable-overload-test" ||
    type === "repeatable-benchmark" ||
    type === "repeatable"
  ) {
    warnings.push(
      "Repeatable benchmark report detected. Confirm its workload and repeat metadata before comparing results."
    );

    if (!isObject(report.configuration)) {
      warnings.push(
        "Repeatable report has no top-level configuration object."
      );
    }

    if (
      report.repeats !== undefined &&
      !isPositiveInteger(report.repeats)
    ) {
      errors.push(
        "repeats must be a positive integer when present."
      );
    }

    if (
      report.repeatCount !== undefined &&
      !isPositiveInteger(report.repeatCount)
    ) {
      errors.push(
        "repeatCount must be a positive integer when present."
      );
    }
  }

  validateCompletionFlag(report, errors, warnings);
}

function validateReport(report) {
  const errors = [];
  const warnings = [];

  if (!isObject(report)) {
    return {
      valid: false,
      errors: ["Report must contain a JSON object."],
      warnings,
      benchmarkType: null,
    };
  }

  validateCommonFields(report, errors, warnings);

  const type = detectBenchmarkType(report);

  if (!type || !SUPPORTED_TYPES.has(type)) {
    errors.push(
      `Unknown or missing benchmarkType "${report.benchmarkType ?? ""}".`
    );
  } else if (type === "high-limit-algorithm-overhead") {
    validateHighLimit(report, errors, warnings);
  } else {
    validateResultsFormat(report, errors, warnings, type);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    benchmarkType: type,
  };
}

async function main() {
  let files;

  try {
    files = (await readdir(resultsDirectory))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (error) {
    throw new Error(
      `Unable to read benchmark results directory: ${error.message}`,
      { cause: error }
    );
  }

  if (files.length === 0) {
    console.log("No benchmark JSON reports found.");
    return;
  }

  let passed = 0;
  let failed = 0;
  let warningCount = 0;

  for (const file of files) {
    const fullPath = join(resultsDirectory, file);

    try {
      const contents = await readFile(fullPath, "utf8");
      const report = JSON.parse(contents);
      const result = validateReport(report);

      warningCount += result.warnings.length;

      console.log(
        `\n${result.valid ? "PASS" : "FAIL"}  ${file}`
      );

      if (result.benchmarkType) {
        console.log(`  Type: ${result.benchmarkType}`);
      }

      for (const error of result.errors) {
        console.error(`  ERROR: ${error}`);
      }

      for (const warning of result.warnings) {
        console.warn(`  WARNING: ${warning}`);
      }

      if (result.valid) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
      console.error(`\nFAIL  ${file}`);
      console.error(`  ERROR: ${error.message}`);
    }
  }

  console.log(
    "\n========== VALIDATION SUMMARY =========="
  );
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Warnings: ${warningCount}`);

  if (failed > 0) {
    console.error(
      "\nSome benchmark reports failed validation."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\nAll benchmark reports passed validation."
    );
  }
}

main().catch((error) => {
  console.error(
    "\nReport validation failed unexpectedly:",
    error
  );
  process.exitCode = 1;
});
