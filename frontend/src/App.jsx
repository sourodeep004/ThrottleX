import { useEffect, useState } from "react";
import {
  Zap,
  Activity,
  GitBranch,
  Gauge,
  Code2,
  ShieldCheck,
  Clock3,
  Layers3,
  Play,
  ChevronDown,
  SlidersHorizontal,
  MoreHorizontal,
  ArrowUpRight,
  CheckCircle2,
  UserRound,
  LoaderCircle,
  History,
  RefreshCw,
  Download,
  GitCompareArrows,
} from "lucide-react";
import "./App.css";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"
).replace(/\/+$/, "");

const algorithms = [
  {
    name: "Sliding Window",
    description: "Accurate rolling-window request control.",
    limit: "100 req / min",
    status: "Active",
    icon: Clock3,
    tone: "purple",
  },
  {
    name: "Token Bucket",
    description: "Allows controlled bursts with token replenishment.",
    limit: "100 tokens",
    status: "Ready",
    icon: Layers3,
    tone: "blue",
  },
  {
    name: "Fixed Window",
    description: "Simple request limits over fixed time intervals.",
    limit: "100 req / min",
    status: "Available",
    icon: Gauge,
    tone: "amber",
  },
];

const navItems = [
  { label: "Overview", icon: Activity },
  { label: "Algorithms", icon: GitBranch },
  { label: "Benchmarks", icon: Gauge },
  { label: "API Playground", icon: Code2 },
];

function formatNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function metricValue(value, suffix = "") {
  return value === null || value === undefined
    ? "—"
    : `${formatNumber(value)}${suffix}`;
}

function MetricCard({ title, value, unit, icon: Icon, tone, detail }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className="metric-label">{title}</span>
        <span className={`icon-box ${tone}`}>
          <Icon size={21} />
        </span>
      </div>

      <div className="metric-value">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>

      <div className="metric-detail">
        <ArrowUpRight size={16} />
        <span>{detail}</span>
      </div>

      <p className="muted small">Latest saved benchmark</p>
    </article>
  );
}

function TrafficChart({ range, traffic = [], loading, error }) {
  const width = 1100;
  const height = 280;
  const left = 58;
  const right = 24;
  const top = 24;
  const bottom = 42;

  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  const safeTraffic = traffic.map((item) => ({
    ...item,
    incoming: Math.max(0, Number(item.incoming) || 0),
    limited: Math.max(0, Number(item.limited) || 0),
  }));

  const maxValue = Math.max(
    10,
    ...safeTraffic.flatMap((item) => [
      item.incoming,
      item.limited,
    ]),
  );

  const niceMax = Math.ceil(maxValue / 5) * 5 || 10;

  const point = (value, index, count) => ({
    x:
      left +
      (index / Math.max(1, count - 1)) * chartWidth,
    y:
      top +
      chartHeight -
      (value / niceMax) * chartHeight,
  });

  const makeLine = (key) =>
    safeTraffic
      .map((item, index) => {
        const p = point(item[key], index, safeTraffic.length);
        return `${p.x},${p.y}`;
      })
      .join(" ");

  const incomingPoints = makeLine("incoming");
  const limitedPoints = makeLine("limited");

  const first = point(
    safeTraffic[0]?.incoming ?? 0,
    0,
    safeTraffic.length,
  );

  const last = point(
    safeTraffic[safeTraffic.length - 1]?.incoming ?? 0,
    safeTraffic.length - 1,
    safeTraffic.length,
  );

  const areaPoints = safeTraffic.length
    ? `${first.x},${top + chartHeight} ${incomingPoints} ${last.x},${top + chartHeight}`
    : "";

  const ticks = Array.from(
    { length: 6 },
    (_, index) => (niceMax / 5) * index,
  );

  const formatAxisValue = (value) => {
    if (value >= 1000) {
      return `${Number((value / 1000).toFixed(1))}k`;
    }

    return Math.round(value).toString();
  };

  const formatTime = (item) => {
    if (!item.timestamp) return item.time || "—";

    const date = new Date(item.timestamp);

    if (Number.isNaN(date.getTime())) {
      return item.time || "—";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getRangeLabel = () => {
    if (range === "15m") return "Last 15 minutes";
    if (range === "30m") return "Last 30 minutes";
    if (range === "24h") return "Last 24 hours";
    return "Last hour";
  };

  const formatTooltipTime = (item) => {
    if (!item.timestamp) return item.time || "Time unavailable";

    const date = new Date(item.timestamp);

    if (Number.isNaN(date.getTime())) {
      return item.time || "Time unavailable";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="traffic-chart">
      <div className="chart-legend">
        <span>
          <i className="legend-dot purple-dot" />
          Incoming requests
        </span>

        <span>
          <i className="legend-dot blue-dot" />
          Rate-limited requests (429)
        </span>
      </div>

      <div className="traffic-chart-summary">
        <div>
          <span className="muted small">Time window</span>
          <strong>{getRangeLabel()}</strong>
        </div>

        <div>
          <span className="muted small">Recorded requests</span>
          <strong>
            {new Intl.NumberFormat("en-IN").format(
              safeTraffic.reduce(
                (total, item) => total + item.incoming,
                0,
              ),
            )}
          </strong>
        </div>

        <div>
          <span className="muted small">Rate-limited</span>
          <strong>
            {new Intl.NumberFormat("en-IN").format(
              safeTraffic.reduce(
                (total, item) => total + item.limited,
                0,
              ),
            )}
          </strong>
        </div>
      </div>

      {loading && (
        <p className="muted small" role="status">
          Loading live API traffic…
        </p>
      )}

      {error && (
        <p className="muted small" role="alert">
          Could not load traffic metrics: {error}
        </p>
      )}

      {!loading &&
        !error &&
        safeTraffic.every(
          (item) => item.incoming === 0 && item.limited === 0,
        ) && (
          <p className="muted small" role="status">
            No API requests recorded for this period yet.
            Send requests through the API Playground to populate
            the chart.
          </p>
        )}

      <div className="traffic-chart-plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="chart-svg"
          role="img"
          aria-label={`Live incoming and rate-limited API requests for ${getRangeLabel()}`}
        >
          {ticks.map((value, index) => {
            const y =
              top +
              chartHeight -
              (value / niceMax) * chartHeight;

            return (
              <g key={`${value}-${index}`}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  className="chart-grid"
                />

                <text
                  x={left - 12}
                  y={y + 4}
                  className="chart-label"
                  textAnchor="end"
                >
                  {formatAxisValue(value)}
                </text>
              </g>
            );
          })}

          {safeTraffic.length > 1 && (
            <polygon
              points={areaPoints}
              className="chart-area"
            />
          )}

          {safeTraffic.length > 1 && (
            <polyline
              points={incomingPoints}
              className="chart-line incoming-line"
            />
          )}

          {safeTraffic.length > 1 && (
            <polyline
              points={limitedPoints}
              className="chart-line limited-line"
            />
          )}

          {safeTraffic.map((item, index) => {
            const incomingPoint = point(
              item.incoming,
              index,
              safeTraffic.length,
            );

            const limitedPoint = point(
              item.limited,
              index,
              safeTraffic.length,
            );

            return (
              <g key={`${item.timestamp || index}`}>
                <circle
                  cx={incomingPoint.x}
                  cy={incomingPoint.y}
                  r={safeTraffic.length > 40 ? 2 : 4}
                  className="traffic-point incoming-point"
                >
                  <title>
                    {`${formatTooltipTime(item)} — Incoming: ${item.incoming}`}
                  </title>
                </circle>

                <circle
                  cx={limitedPoint.x}
                  cy={limitedPoint.y}
                  r={safeTraffic.length > 40 ? 2 : 4}
                  className="traffic-point limited-point"
                >
                  <title>
                    {`${formatTooltipTime(item)} — Rate limited: ${item.limited}`}
                  </title>
                </circle>
              </g>
            );
          })}

          {safeTraffic.map((item, index) => {
            const shouldShowLabel =
              index === 0 ||
              index === safeTraffic.length - 1 ||
              index % Math.max(
                1,
                Math.ceil(safeTraffic.length / 7),
              ) === 0;

            if (!shouldShowLabel) return null;

            const p = point(
              item.incoming,
              index,
              safeTraffic.length,
            );

            return (
              <text
                key={`time-${item.timestamp || index}`}
                x={p.x}
                y={height - 12}
                textAnchor="middle"
                className="chart-label"
              >
                {formatTime(item)}
              </text>
            );
          })}
        </svg>
      </div>

      <p className="muted small">
        Live backend telemetry · Refreshes every 5 seconds ·
        Stored in memory and reset when the backend restarts.
      </p>
    </div>
  );
}

function AlgorithmCard({ algorithm }) {
  const Icon = algorithm.icon;

  return (
    <article className="algorithm-card">
      <div className={`icon-box large ${algorithm.tone}`}>
        <Icon size={24} />
      </div>

      <div className="algorithm-heading">
        <h3>{algorithm.name}</h3>
        <span
          className={`status-pill ${algorithm.status.toLowerCase()}`}
        >
          {algorithm.status}
        </span>
      </div>

      <p className="muted">{algorithm.description}</p>

      <div className="algorithm-stats">
        <div>
          <span className="muted">Configured limit</span>
          <strong>{algorithm.limit}</strong>
        </div>
        <div>
          <span className="muted">Observed benchmark throughput</span>
          <strong>
            {algorithm.measured
              ? `${algorithm.throughput} req/s`
              : "Not measured"}
          </strong>
        </div>
        <div>
          <span className="muted">P97.5 latency</span>
          <strong>{algorithm.measured ? algorithm.p975 : "—"}</strong>
        </div>
      </div>
    </article>
  );
}

function Overview({ setPage, report, metricsLoading, metricsError, trafficRange, setTrafficRange, traffic, trafficLoading, trafficError }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SYSTEM OVERVIEW</span>
          <h1>Rate limiting, at a glance.</h1>
          <p>
            Monitor request traffic, algorithm performance, and enforcement
            health.
          </p>
        </div>

        <button
          className="button secondary"
          type="button"
          onClick={() => setPage("Benchmarks")}
        >
          <Play size={17} />
          View benchmarks
        </button>
      </div>

      <section className="metric-grid">
        <MetricCard
          title="Benchmark throughput"
          value={
            metricsLoading
              ? "…"
              : formatNumber(report?.metrics?.throughput)
          }
          unit="req/s"
          icon={Zap}
          tone="purple"
          detail="Latest saved benchmark"
        />

        <MetricCard
          title="P50 latency"
          value={
            metricsLoading
              ? "…"
              : formatNumber(report?.metrics?.p50LatencyMs)
          }
          unit="ms"
          icon={Clock3}
          tone="blue"
          detail="Median latency"
        />

        <MetricCard
          title="P97.5 latency"
          value={
            metricsLoading
              ? "…"
              : formatNumber(report?.metrics?.p975LatencyMs)
          }
          unit="ms"
          icon={Gauge}
          tone="green"
          detail="P97.5 tail latency"
        />

        <MetricCard
          title="Benchmark errors"
          value={
            metricsLoading
              ? "…"
              : formatNumber(report?.metrics?.errors)
          }
          icon={ShieldCheck}
          tone="amber"
          detail="Errors in saved report"
        />
      </section>

      <p className="muted small" role={metricsError ? "alert" : "status"}>
        {metricsError
          ? `Could not load benchmark metrics: ${metricsError}`
          : report?.generatedAt
            ? `Saved benchmark report · ${new Date(
                report.generatedAt
              ).toLocaleString()}`
            : metricsLoading
              ? "Loading saved benchmark metrics…"
              : "No saved benchmark metrics are available yet."}
      </p>

      <section className="panel traffic-panel">
        <div className="panel-heading">
          <div>
            <h2>Request traffic</h2>
            <p className="muted small">Live API request telemetry</p>
          </div>

          <select className="select-control" value={trafficRange} onChange={(event) => setTrafficRange(event.target.value)} aria-label="Chart time range">
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
          </select>
        </div>

        <TrafficChart range={trafficRange} traffic={traffic} loading={trafficLoading} error={trafficError} />
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Rate-limiting algorithms</h2>
              <p className="muted small">
                Implemented strategies and benchmark status
              </p>
            </div>
            <MoreHorizontal size={20} />
          </div>

          <div className="algorithm-list">
            {algorithms.map((algorithm) => {
              const Icon = algorithm.icon;

              return (
                <div className="algorithm-row" key={algorithm.name}>
                  <span className={`icon-box ${algorithm.tone}`}>
                    <Icon size={20} />
                  </span>
                  <div className="algorithm-row-info">
                    <strong>{algorithm.name}</strong>
                    <span className="muted small">{algorithm.limit}</span>
                  </div>
                  <span
                    className={`status-pill ${algorithm.status.toLowerCase()}`}
                  >
                    {algorithm.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Enforcement checks</h2>
              <p className="muted small">
                Latest local automated test run
              </p>
            </div>
            <CheckCircle2 className="success-icon" size={22} />
          </div>

          <div className="test-summary">
            <strong>15</strong>
            <span className="muted">/ 15 tests passed</span>
          </div>

          <div className="progress-track">
            <div className="progress-fill" />
          </div>

          <ul className="check-list">
            <li>
              <CheckCircle2 size={16} /> 8 algorithm tests
            </li>
            <li>
              <CheckCircle2 size={16} /> 4 enforcement tests
            </li>
            <li>
              <CheckCircle2 size={16} /> 3 rate-limiter tests
            </li>
          </ul>

          <p className="muted small">
            Based on the last test output shared. Run the tests again after
            code changes.
          </p>
        </div>
      </section>
    </>
  );
}

function Algorithms({ report, metricsLoading, metricsError }) {
  const measuredAlgorithms = report?.algorithms || [];
  const reportByName = new Map(
    measuredAlgorithms.map((item) => [
      String(item.name || "").toLowerCase(),
      item,
    ])
  );

  const algorithmCards = algorithms.map((algorithm) => {
    const measured = reportByName.get(algorithm.name.toLowerCase());

    return {
      ...algorithm,
      status: measured ? "Measured" : "Not measured",
      throughput: measured
        ? formatNumber(measured.requestsPerSecond ?? measured.throughput)
        : "—",
      p975:
        measured?.p975LatencyMs == null
          ? "—"
          : `${formatNumber(measured.p975LatencyMs)} ms`,
      measured: Boolean(measured),
    };
  });

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">RATE-LIMITING ENGINE</span>
          <h1>Algorithm library</h1>
          <p>
            Compare the strategies implemented in the ThrottleX backend.
          </p>
        </div>
      </div>

      <p className="muted small" role={metricsError ? "alert" : "status"}>
        {metricsError
          ? `Could not load benchmark metrics: ${metricsError}`
          : report?.generatedAt
            ? `Measured results from ${new Date(
                report.generatedAt
              ).toLocaleString()}`
            : metricsLoading
              ? "Loading saved benchmark metrics…"
              : "No saved benchmark report is available. Results will appear after a benchmark is run."}
      </p>

      <section className="algorithm-grid">
        {algorithmCards.map((algorithm) => (
          <AlgorithmCard key={algorithm.name} algorithm={algorithm} />
        ))}
      </section>

      {measuredAlgorithms.length > 0 && (
        <section className="panel benchmark-panel">
          <div className="panel-heading">
            <div>
              <h2>Enforcement outcomes</h2>
              <p className="muted small">
                Counts from the saved benchmark report
              </p>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>Algorithm</th>
                  <th>Requests/sec</th>
                  <th>Rate limited (429)</th>
                  <th>Errors</th>
                  <th>Timeouts</th>
                </tr>
              </thead>
              <tbody>
                {measuredAlgorithms.map((item, index) => (
                  <tr key={`${item.name || "algorithm"}-${index}`}>
                    <td>{item.name || "Unknown"}</td>
                    <td>
                      {formatNumber(
                        item.requestsPerSecond ?? item.throughput
                      )}
                    </td>
                    <td>{formatNumber(item.rejected429)}</td>
                    <td>{formatNumber(item.errors)}</td>
                    <td>{formatNumber(item.timeouts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted small">
            HTTP 429 responses are expected rate-limit rejections and are
            reported separately from server errors.
          </p>
        </section>
      )}

      <p className="muted small page-note">
        Values come from the latest saved benchmark report. A dash means the
        report did not include a measurement. Results reflect this local test
        environment and are not a guarantee of production performance.
      </p>
    </>
  );
}

function BenchmarkHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState("20");
  const [baselineReportFile, setBaselineReportFile] = useState("");
  const [targetReportFile, setTargetReportFile] = useState("");

  async function loadHistory() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/metrics/history?limit=${limit}`,
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
      const payload = await response.json();

      if (!response.ok || payload?.success === false) {
        throw new Error(
          payload?.error?.message || `History request failed (${response.status})`
        );
      }

      setHistory(Array.isArray(payload.history) ? payload.history : []);
    } catch (err) {
      setError(err.message || "Unable to load benchmark history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();

    // BenchmarkHistory owns its own state, so refreshing the parent metrics
    // does not automatically refresh this chart. Listen for a fresh metrics
    // response after a benchmark completes or the user refreshes results.
    const handleMetricsUpdated = () => {
      loadHistory();
    };

    window.addEventListener("throttlex:metrics-updated", handleMetricsUpdated);
    return () => {
      window.removeEventListener("throttlex:metrics-updated", handleMetricsUpdated);
    };
    // Reload when the requested history window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const chartRuns = [...history].reverse();
  const stableConfigKey = (run) => JSON.stringify({
    benchmarkType: run?.benchmarkType ?? "unknown",
    configuration: run?.configuration ?? null,
  });
  const latestConfigKey = history.length ? stableConfigKey(history[0]) : null;
  const compatibleRuns = latestConfigKey
    ? history.filter((run) => stableConfigKey(run) === latestConfigKey)
    : [];
  const getThroughput = (run, name) => {
    const value = (run.algorithms || []).find((item) => item.name === name)?.requestsPerSecond;
    return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  };
  const calculateStats = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const median = sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    return {
      count: values.length,
      mean,
      median,
      standardDeviation,
      coefficientOfVariation: mean === 0 ? null : (standardDeviation / Math.abs(mean)) * 100,
    };
  };
  const stabilityStats = ["Sliding Window", "Token Bucket"].map((name) => ({
    name,
    stats: calculateStats(
      compatibleRuns.map((run) => getThroughput(run, name)).filter((value) => value != null)
    ),
  }));
  const pairedRuns = compatibleRuns.map((run) => ({
    sliding: getThroughput(run, "Sliding Window"),
    token: getThroughput(run, "Token Bucket"),
  })).filter((run) => run.sliding != null && run.token != null);
  const pairedDeltas = pairedRuns.map((run) => run.token === 0
    ? null
    : ((run.sliding - run.token) / run.token) * 100
  ).filter((value) => value != null && Number.isFinite(value));
  const pairedDeltaStats = calculateStats(pairedDeltas);

  // Compare only reports that share the newest report's benchmark type/configuration.
  const comparisonRuns = compatibleRuns;
  const defaultTarget = comparisonRuns[0] || null;
  const defaultBaseline = comparisonRuns[1] || null;
  const selectedTarget = comparisonRuns.find((run) => run.reportFile === targetReportFile) || defaultTarget;
  const selectedBaseline = comparisonRuns.find((run) => run.reportFile === baselineReportFile) || defaultBaseline;
  const getAlgorithmMetric = (run, algorithmName, metricKey) => {
    const algorithm = (run?.algorithms || []).find((item) => item.name === algorithmName);
    const raw = metricKey === "requestsPerSecond"
      ? algorithm?.requestsPerSecond
      : metricKey === "p50LatencyMs"
        ? algorithm?.p50LatencyMs
        : metricKey === "p975LatencyMs"
          ? algorithm?.p975LatencyMs
          : algorithm?.errors;
    const value = Number(raw);
    return raw == null || raw === "" || !Number.isFinite(value) ? null : value;
  };
  const percentageChange = (baseline, target, lowerIsBetter = false) => {
    if (baseline == null || target == null || baseline === 0) return null;
    const change = ((target - baseline) / Math.abs(baseline)) * 100;
    return lowerIsBetter ? -change : change;
  };
  const comparisonRows = ["Sliding Window", "Token Bucket"].map((name) => ({
    name,
    metrics: [
      { key: "requestsPerSecond", label: "Throughput", unit: " req/s", lowerIsBetter: false },
      { key: "p50LatencyMs", label: "P50 latency", unit: " ms", lowerIsBetter: true },
      { key: "p975LatencyMs", label: "P97.5 latency", unit: " ms", lowerIsBetter: true },
      { key: "errors", label: "Errors", unit: "", lowerIsBetter: true },
    ].map((metric) => {
      const baseline = getAlgorithmMetric(selectedBaseline, name, metric.key);
      const target = getAlgorithmMetric(selectedTarget, name, metric.key);
      return { ...metric, baseline, target, change: percentageChange(baseline, target, metric.lowerIsBetter) };
    }),
  }));
  function exportComparison() {
    if (!selectedBaseline || !selectedTarget || selectedBaseline.reportFile === selectedTarget.reportFile) return;

    const escapeHtml = (value) => String(value ?? "—").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
    const formatMetric = (value, unit = "") => value == null ? "—" : `${formatNumber(value)}${unit}`;
    const baselineDate = selectedBaseline.generatedAt ? new Date(selectedBaseline.generatedAt).toLocaleString() : "Unknown";
    const targetDate = selectedTarget.generatedAt ? new Date(selectedTarget.generatedAt).toLocaleString() : "Unknown";
    const metricRows = comparisonRows.map((row) => `
      <section class="algorithm">
        <h2>${escapeHtml(row.name)}</h2>
        <table><thead><tr><th>Metric</th><th>Baseline</th><th>Comparison</th><th>Change</th><th>Interpretation</th></tr></thead><tbody>
        ${row.metrics.map((metric) => {
          const interpretation = metric.change == null
            ? "Unavailable"
            : metric.change > 0 ? "Improved" : metric.change < 0 ? "Regressed" : "No change";
          const changeText = metric.change == null ? "—" : `${metric.change > 0 ? "+" : ""}${formatNumber(metric.change)}%`;
          const tone = metric.change == null ? "neutral" : metric.change > 0 ? "good" : metric.change < 0 ? "bad" : "neutral";
          return `<tr><td>${escapeHtml(metric.label)}</td><td>${escapeHtml(formatMetric(metric.baseline, metric.unit))}</td><td>${escapeHtml(formatMetric(metric.target, metric.unit))}</td><td class="${tone}">${escapeHtml(changeText)}</td><td>${escapeHtml(interpretation)}</td></tr>`;
        }).join("")}
        </tbody></table>
      </section>`).join("");
    const stabilityRows = stabilityStats.map(({ name, stats }) => `
      <tr><td>${escapeHtml(name)}</td><td>${stats ? escapeHtml(formatMetric(stats.mean, " req/s")) : "—"}</td>
      <td>${stats ? escapeHtml(formatMetric(stats.median, " req/s")) : "—"}</td>
      <td>${stats ? escapeHtml(formatMetric(stats.standardDeviation, " req/s")) : "—"}</td>
      <td>${stats?.coefficientOfVariation == null ? "—" : `${escapeHtml(formatNumber(stats.coefficientOfVariation))}%`}</td>
      <td>${stats?.count ?? 0}</td></tr>`).join("");
    const configuration = selectedTarget.configuration || {};
    const configText = Object.entries(configuration).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Not recorded";
    const reportHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ThrottleX Benchmark Report</title>
<style>
:root{color-scheme:light;--ink:#182033;--muted:#5c667c;--line:#dce2ec;--panel:#f6f8fc;--accent:#7654db;--good:#087f5b;--bad:#c03950}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 Inter,Segoe UI,Arial,sans-serif}.page{max-width:1100px;margin:0 auto;padding:42px 28px 60px}.brand{color:var(--accent);font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:12px}h1{font-size:34px;margin:8px 0}h2{font-size:20px;margin:0 0 14px}h3{font-size:16px;margin:0 0 12px}.muted{color:var(--muted)}.meta,.panel,.algorithm{border:1px solid var(--line);border-radius:14px;padding:20px;margin-top:20px}.meta{background:var(--panel);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.label{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.value{font-weight:650;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}.good{color:var(--good);font-weight:700}.bad{color:var(--bad);font-weight:700}.neutral{color:var(--muted)}.note{background:var(--panel);padding:14px;border-radius:10px;color:var(--muted);font-size:13px}.footer{margin-top:28px;color:var(--muted);font-size:12px}@media(max-width:650px){.page{padding:24px 14px}.meta{grid-template-columns:1fr}h1{font-size:27px}table{font-size:12px}th,td{padding:8px 5px}}@media print{.page{max-width:none;padding:0}.panel,.meta,.algorithm{break-inside:avoid}}
</style></head><body><main class="page">
<div class="brand">ThrottleX · API Control Plane</div><h1>Benchmark Comparison Report</h1><p class="muted">Generated ${escapeHtml(new Date().toLocaleString())}. This report compares two saved benchmark runs and summarizes the currently selected compatible history set.</p>
<div class="meta"><div><span class="label">Benchmark type</span><span class="value">${escapeHtml(selectedTarget.benchmarkType || "Unknown")}</span></div><div><span class="label">Configuration</span><span class="value">${escapeHtml(configText)}</span></div><div><span class="label">Baseline run</span><span class="value">${escapeHtml(baselineDate)}<br>${escapeHtml(selectedBaseline.reportFile)}</span></div><div><span class="label">Comparison run</span><span class="value">${escapeHtml(targetDate)}<br>${escapeHtml(selectedTarget.reportFile)}</span></div></div>
<div class="panel"><h2>Comparison results</h2><p class="muted">Positive change means improvement: higher throughput is better, while lower latency and fewer errors are better.</p>${metricRows}</div>
<div class="panel"><h2>Benchmark stability</h2><p class="muted">Descriptive statistics for compatible saved runs, not only the two selected runs.</p><table><thead><tr><th>Algorithm</th><th>Mean throughput</th><th>Median throughput</th><th>Std. deviation</th><th>CV</th><th>Samples</th></tr></thead><tbody>${stabilityRows}</tbody></table></div>
<div class="panel"><h2>Interpretation and limitations</h2><p class="note">This report provides descriptive comparisons only. Percentage changes are not a statistical-significance test. Benchmark outcomes may vary with machine load, warm-up effects, connection settings, run order, and other environmental factors. Compare runs with matching configurations, and repeat tests before concluding that a change consistently improves or regresses performance.</p></div>
<div class="footer">ThrottleX · Generated locally from saved benchmark report data. No live benchmark was run to create this report.</div>
</main></body></html>`;
    const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "throttlex-benchmark-report.html";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const chartWidth = 1000;
  const chartHeight = 260;
  const left = 64;
  const right = 20;
  const top = 20;
  const bottom = 42;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const values = chartRuns.flatMap((run) =>
    (run.algorithms || [])
      .map((item) => Number(item.requestsPerSecond))
      .filter((value) => Number.isFinite(value) && value >= 0)
  );
  const maxValue = values.length ? Math.max(...values) * 1.12 || 1 : 1;
  const xFor = (index) =>
    chartRuns.length <= 1
      ? left + plotWidth / 2
      : left + (index / (chartRuns.length - 1)) * plotWidth;
  const yFor = (value) => top + plotHeight - (value / maxValue) * plotHeight;

  const series = [
    { name: "Sliding Window", color: "var(--purple)" },
    { name: "Token Bucket", color: "var(--blue)" },
  ].map((definition) => {
    const points = chartRuns.map((run, index) => {
      const item = (run.algorithms || []).find(
        (algorithm) => algorithm.name === definition.name
      );
      const value = Number(item?.requestsPerSecond);
      return Number.isFinite(value) && item?.requestsPerSecond != null
        ? { x: xFor(index), y: yFor(value), value, index }
        : null;
    }).filter(Boolean);

    return { ...definition, points };
  });

  return (
    <section className="panel benchmark-panel history-panel">
      <div className="panel-heading history-heading">
        <div>
          <h2><History size={17} /> Benchmark history</h2>
          <p className="muted small">
            Throughput across saved benchmark runs. Values come from your report files.
          </p>
        </div>
        <div className="history-actions">
          <select
            className="select-control"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            aria-label="Number of benchmark runs to show"
          >
            <option value="10">Last 10 runs</option>
            <option value="20">Last 20 runs</option>
            <option value="50">Last 50 runs</option>
            <option value="100">Last 100 runs</option>
          </select>
          <button
            className="button secondary"
            type="button"
            onClick={loadHistory}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            {loading ? "Loading…" : "Refresh history"}
          </button>
        </div>
      </div>

      {error && <p className="history-message error-text" role="alert">{error}</p>}

      {!error && !loading && history.length === 0 && (
        <p className="history-message muted" role="status">
          No saved reports were found. Run a benchmark to start building history.
        </p>
      )}

      {history.length > 0 && (
        <>
          <div className="chart-legend history-legend">
            {series.map((item) => (
              <span key={item.name}>
                <i className={`legend-dot ${item.name === "Sliding Window" ? "purple-dot" : "blue-dot"}`} />
                {item.name}
              </span>
            ))}
          </div>

          <div className="history-chart-wrap">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="chart-svg history-chart"
              role="img"
              aria-label="Historical benchmark throughput comparison"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                const y = top + plotHeight - fraction * plotHeight;
                return (
                  <g key={fraction}>
                    <line x1={left} y1={y} x2={chartWidth - right} y2={y} className="chart-grid" />
                    <text x={left - 10} y={y + 4} className="chart-label" textAnchor="end">
                      {formatNumber(maxValue * fraction)}
                    </text>
                  </g>
                );
              })}
              {series.map((item) => (
                <g key={item.name}>
                  {item.points.length > 1 && (
                    <polyline
                      points={item.points.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke={item.color}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {item.points.map((point) => (
                    <circle key={`${item.name}-${point.index}`} cx={point.x} cy={point.y} r="4" fill={item.color}>
                      <title>{`${item.name}: ${formatNumber(point.value)} req/s`}</title>
                    </circle>
                  ))}
                </g>
              ))}
              {chartRuns.map((run, index) => (
                <text
                  key={`${run.reportFile}-${index}`}
                  x={xFor(index)}
                  y={chartHeight - 12}
                  className="chart-label"
                  textAnchor="middle"
                >
                  {index === 0 || index === chartRuns.length - 1 || chartRuns.length <= 8
                    ? new Date(run.generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : index % Math.ceil(chartRuns.length / 7) === 0 ? `#${index + 1}` : ""}
                </text>
              ))}
            </svg>
          </div>

          {chartRuns.length < 2 && (
            <p className="muted small">Run at least one more benchmark to compare performance over time.</p>
          )}

          <div className="table-wrapper history-table-wrapper">
            <table className="benchmark-table history-table">
              <thead>
                <tr>
                  <th>Run time</th>
                  <th>Benchmark type</th>
                  <th>Algorithm</th>
                  <th>Requests/sec</th>
                  <th>P50</th>
                  <th>P97.5</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {history.flatMap((run) => (run.algorithms || []).map((item, index) => (
                  <tr key={`${run.reportFile}-${item.name}-${index}`}>
                    <td>{new Date(run.generatedAt).toLocaleString()}</td>
                    <td title={run.benchmarkType}>{run.benchmarkType || "—"}</td>
                    <td>{item.name || "Unknown"}</td>
                    <td>{formatNumber(item.requestsPerSecond)}</td>
                    <td>{metricValue(item.p50LatencyMs, " ms")}</td>
                    <td>{metricValue(item.p975LatencyMs, " ms")}</td>
                    <td className={Number(item.errors || 0) === 0 ? "success-text" : "error-text"}>
                      {formatNumber(item.errors ?? 0)}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <p className="muted small history-footnote">
            Showing {history.length} saved run{history.length === 1 ? "" : "s"}. Throughput varies with machine load, connection settings, and benchmark configuration; compare like-for-like runs.
          </p>

          <section className="stability-section" aria-labelledby="stability-title">
            <div className="stability-heading">
              <div>
                <h3 id="stability-title"><Activity size={17} /> Benchmark stability analysis</h3>
                <p className="muted small">
                  Statistics use only runs with the same benchmark type and configuration as the newest report.
                </p>
              </div>
              <span className="stability-sample">{compatibleRuns.length} compatible run{compatibleRuns.length === 1 ? "" : "s"}</span>
            </div>

            {compatibleRuns.length < 2 ? (
              <p className="history-message muted" role="status">
                At least two compatible saved runs are needed to estimate throughput stability. Run the same benchmark configuration again to build a fair comparison.
              </p>
            ) : (
              <>
                <div className="stability-grid">
                  {stabilityStats.map(({ name, stats }) => (
                    <article className="stability-card" key={name}>
                      <div className="stability-card-title">
                        <span className={`legend-dot ${name === "Sliding Window" ? "purple-dot" : "blue-dot"}`} />
                        <h4>{name}</h4>
                      </div>
                      {stats ? (
                        <>
                          <div className="stability-primary">
                            <strong>{formatNumber(stats.median)}</strong>
                            <span>median req/s</span>
                          </div>
                          <dl className="stability-metrics">
                            <div><dt>Mean throughput</dt><dd>{formatNumber(stats.mean)} req/s</dd></div>
                            <div><dt>Standard deviation</dt><dd>{formatNumber(stats.standardDeviation)} req/s</dd></div>
                            <div>
                              <dt>Coefficient of variation</dt>
                              <dd className={stats.coefficientOfVariation != null && stats.coefficientOfVariation > 10 ? "warning-text" : "success-text"}>
                                {stats.coefficientOfVariation == null ? "—" : `${formatNumber(stats.coefficientOfVariation)}%`}
                              </dd>
                            </div>
                            <div><dt>Samples</dt><dd>{stats.count}</dd></div>
                          </dl>
                          {stats.coefficientOfVariation != null && (
                            <p className={`stability-status ${stats.coefficientOfVariation > 10 ? "warning-text" : "success-text"}`}>
                              {stats.coefficientOfVariation > 10 ? "Higher variability in these runs" : "Relatively consistent in these runs"}
                            </p>
                          )}
                        </>
                      ) : <p className="muted small">No valid throughput values for this algorithm in the compatible runs.</p>}
                    </article>
                  ))}
                </div>

                <div className="paired-comparison">
                  <div>
                    <span className="muted small">Mean paired throughput difference</span>
                    <strong className={pairedDeltaStats && pairedDeltaStats.mean >= 0 ? "success-text" : "warning-text"}>
                      {pairedDeltaStats ? `${pairedDeltaStats.mean > 0 ? "+" : ""}${formatNumber(pairedDeltaStats.mean)}%` : "—"}
                    </strong>
                    <p className="muted small">Sliding Window relative to Token Bucket across {pairedRuns.length} paired run{pairedRuns.length === 1 ? "" : "s"}.</p>
                  </div>
                  <div>
                    <span className="muted small">Median paired difference</span>
                    <strong>{pairedDeltaStats ? `${pairedDeltaStats.median > 0 ? "+" : ""}${formatNumber(pairedDeltaStats.median)}%` : "—"}</strong>
                    <p className="muted small">Positive values mean Sliding Window had higher throughput in that pair.</p>
                  </div>
                </div>
                <p className="muted small stability-disclaimer">
                  Variability flag: CV above 10% is a practical warning threshold, not a universal rule. These are descriptive statistics, not a statistical-significance test; hardware load and run order can affect results.
                </p>
              </>
            )}
          </section>

          <section className="comparison-section" aria-labelledby="comparison-title">
            <div className="stability-heading">
              <div>
                <h3 id="comparison-title"><GitCompareArrows size={17} /> Compare benchmark runs</h3>
                <p className="muted small">Choose two runs with matching benchmark type and configuration. Positive changes mean improvement; lower latency and fewer errors are better.</p>
              </div>
              <button className="button secondary" type="button" onClick={exportComparison} disabled={!selectedBaseline || !selectedTarget || selectedBaseline.reportFile === selectedTarget.reportFile}>
                <Download size={14} /> Export HTML report
              </button>
            </div>

            {comparisonRuns.length < 2 ? (
              <p className="history-message muted">At least two compatible reports are needed to compare runs. Run another benchmark using the same configuration.</p>
            ) : (
              <>
                <div className="comparison-selectors">
                  <label>Baseline run
                    <select className="select-control" value={selectedBaseline?.reportFile || ""} onChange={(event) => setBaselineReportFile(event.target.value)}>
                      {comparisonRuns.map((run) => <option key={`base-${run.reportFile}`} value={run.reportFile}>{new Date(run.generatedAt).toLocaleString()} · {run.benchmarkType}</option>)}
                    </select>
                  </label>
                  <label>Comparison run
                    <select className="select-control" value={selectedTarget?.reportFile || ""} onChange={(event) => setTargetReportFile(event.target.value)}>
                      {comparisonRuns.map((run) => <option key={`target-${run.reportFile}`} value={run.reportFile}>{new Date(run.generatedAt).toLocaleString()} · {run.benchmarkType}</option>)}
                    </select>
                  </label>
                </div>

                {selectedBaseline?.reportFile === selectedTarget?.reportFile ? (
                  <p className="history-message warning-text">Choose two different runs to calculate changes.</p>
                ) : (
                  <div className="comparison-algorithms">
                    {comparisonRows.map((row) => (
                      <article className="comparison-algorithm" key={row.name}>
                        <h4><span className={`legend-dot ${row.name === "Sliding Window" ? "purple-dot" : "blue-dot"}`} />{row.name}</h4>
                        <div className="table-wrapper">
                          <table className="benchmark-table comparison-table">
                            <thead><tr><th>Metric</th><th>Baseline</th><th>Comparison</th><th>Change</th></tr></thead>
                            <tbody>{row.metrics.map((metric) => {
                              const positive = metric.change != null && metric.change > 0;
                              const negative = metric.change != null && metric.change < 0;
                              return <tr key={metric.key}>
                                <td>{metric.label}</td>
                                <td>{metric.baseline == null ? "—" : `${formatNumber(metric.baseline)}${metric.unit}`}</td>
                                <td>{metric.target == null ? "—" : `${formatNumber(metric.target)}${metric.unit}`}</td>
                                <td className={metric.change == null ? "muted" : positive ? "success-text" : negative ? "error-text" : "muted"}>
                                  {metric.change == null ? "—" : `${metric.change > 0 ? "+" : ""}${formatNumber(metric.change)}%`}
                                </td>
                              </tr>;
                            })}</tbody>
                          </table>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <p className="muted small history-footnote">The comparison is descriptive, not a statistical-significance test. A missing metric or zero baseline is shown as unavailable rather than calculating a misleading percentage.</p>
              </>
            )}
          </section>
        </>
      )}
      {loading && history.length === 0 && <p className="history-message muted">Loading saved benchmark history…</p>}
    </section>
  );
}

function Benchmarks({
  report,
  metricsLoading,
  metricsError,
  refreshMetrics,
}) {
  const metrics = report?.metrics || {};
  const rows = report?.algorithms || [];

  const [runState, setRunState] = useState({
    running: false,
    job: null,
    error: "",
  });

  async function runBenchmark() {
    if (runState.running) return;

    const initialReportTimestamp = report?.generatedAt || null;
    const startedAtClient = Date.now();
    const pollIntervalMs = 2000;
    const maxWaitMs = 4 * 60 * 1000;
    let latestJob = null;
    let transientFailures = 0;

    setRunState({ running: true, job: null, error: "" });

    try {
      const response = await fetch(`${API_BASE}/metrics/run`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        cache: "no-store",
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.success === false) {
        throw new Error(
          payload?.error?.message ||
            payload?.error ||
            `Could not start benchmark (${response.status})`
        );
      }

      latestJob = payload.job || null;

      setRunState({
        running: true,
        job: latestJob,
        error: "",
      });

      while (Date.now() - startedAtClient < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        let statusResponse;

        try {
          statusResponse = await fetch(`${API_BASE}/metrics/run/status`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });

          transientFailures = 0;
        } catch {
          transientFailures += 1;

          setRunState((current) => ({
            ...current,
            running: true,
            job: {
              ...(current.job || {}),
              ...(latestJob || {}),
              running: true,
              output: [
                ...((latestJob && latestJob.output) || []),
                "Temporarily unable to reach the backend; retrying status check…",
              ],
            },
          }));

          // Allow brief interruptions, including a backend restart.
          if (transientFailures <= 10) continue;

          throw new Error(
            "The backend could not be reached after several retries. Check the backend terminal."
          );
        }

        const statusPayload = await statusResponse.json().catch(() => ({}));

        if (!statusResponse.ok || statusPayload?.success === false) {
          transientFailures += 1;
          if (transientFailures <= 10) continue;

          throw new Error(
            statusPayload?.error?.message ||
              `Unable to read benchmark status (${statusResponse.status})`
          );
        }

        const job = statusPayload.job;

        // Some backend versions return a null job after restarting.
        if (!job) {
          try {
            await refreshMetrics();
          } catch {
            // Continue polling while the backend comes back online.
          }
          continue;
        }

        latestJob = job;

        const jobStateWasReset =
          !job.running &&
          !job.startedAt &&
          !job.finishedAt &&
          job.exitCode == null &&
          !job.error;

        if (jobStateWasReset) {
          try {
            const metricsResponse = await fetch(`${API_BASE}/metrics`, {
              headers: { Accept: "application/json" },
              cache: "no-store",
            });

            const metricsPayload = await metricsResponse
              .json()
              .catch(() => ({}));

            if (
              metricsResponse.ok &&
              metricsPayload?.success !== false &&
              metricsPayload?.generatedAt &&
              metricsPayload.generatedAt !== initialReportTimestamp
            ) {
              setRunState({
                running: false,
                job: {
                  running: false,
                  startedAt: new Date(startedAtClient).toISOString(),
                  finishedAt: new Date().toISOString(),
                  exitCode: 0,
                  error: null,
                  output: [
                    ...(latestJob?.output || []),
                    "Backend status reset during the run, but a new benchmark report was saved.",
                    "Benchmark completed successfully.",
                  ],
                },
                error: "",
              });

              await refreshMetrics();
              return;
            }
          } catch {
            // Continue polling until the backend and report endpoint respond.
          }

          setRunState((current) => ({
            ...current,
            running: true,
            job: {
              ...(current.job || {}),
              ...(latestJob || {}),
              running: true,
              output: [
                ...((latestJob && latestJob.output) || []),
                "Backend status was reset; checking for the saved report…",
              ],
            },
          }));

          continue;
        }

        setRunState({
          running: Boolean(job.running),
          job,
          error: "",
        });

        if (job.running) continue;

        if (job.exitCode === 0 && !job.error) {
          await refreshMetrics();
          setRunState({
            running: false,
            job,
            error: "",
          });
          return;
        }

        if (job.exitCode != null || job.error) {
          throw new Error(
            job.error ||
              `Benchmark process exited with code ${job.exitCode}. Check the backend output.`
          );
        }

        // No terminal state yet. Keep checking until completion or timeout.
        setRunState((current) => ({
          ...current,
          running: true,
          job,
        }));
      }

      // One final report check can recover a run whose status disappeared.
      const finalResponse = await fetch(`${API_BASE}/metrics`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const finalPayload = await finalResponse.json().catch(() => ({}));

      if (
        finalResponse.ok &&
        finalPayload?.success !== false &&
        finalPayload?.generatedAt &&
        finalPayload.generatedAt !== initialReportTimestamp
      ) {
        await refreshMetrics();
        setRunState({
          running: false,
          job: {
            ...(latestJob || {}),
            running: false,
            exitCode: 0,
            finishedAt: new Date().toISOString(),
            output: [
              ...(latestJob?.output || []),
              "A new saved benchmark report was detected.",
            ],
          },
          error: "",
        });
        return;
      }

      throw new Error(
        "Benchmark status timed out after 4 minutes. Check the backend terminal and benchmarks/results for the saved report."
      );
    } catch (error) {
      setRunState((current) => ({
        ...current,
        running: false,
        error: error.message || "Benchmark failed",
      }));
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PERFORMANCE LAB</span>
          <h1>Benchmark results</h1>
          <p>Results from the latest saved local benchmark report.</p>
        </div>

        <button
          className="button primary"
          type="button"
          onClick={runBenchmark}
          disabled={runState.running}
        >
          {runState.running ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Play size={17} />
          )}
          {runState.running ? "Benchmark running…" : "Run benchmark"}
        </button>
      </div>

      <p className="muted small">
        A run takes about 100 seconds plus setup. It generates load against
        your configured API.
      </p>

      {runState.error && (
        <p className="muted small" role="alert">
          {runState.error}
        </p>
      )}

      {runState.job && (
        <section className="panel benchmark-panel">
          <div className="panel-heading">
            <div>
              <h2>
                {runState.job.running
                  ? "Benchmark in progress"
                  : runState.job.exitCode === 0
                    ? "Benchmark completed"
                    : "Benchmark process output"}
              </h2>
              <p className="muted small">
                Started{" "}
                {runState.job.startedAt
                  ? new Date(runState.job.startedAt).toLocaleString()
                  : "—"}
              </p>
            </div>

            <span
              className={`status-pill ${
                runState.job.running
                  ? "active"
                  : runState.job.exitCode === 0
                    ? "ready"
                    : "error"
              }`}
            >
              {runState.job.running
                ? "Running"
                : runState.job.exitCode === 0
                  ? "Completed"
                  : "Failed"}
            </span>
          </div>

          <pre className="response-output">
            {(runState.job.output || []).join("\n") ||
              "Waiting for benchmark output…"}
          </pre>
        </section>
      )}

      <p className="muted small" role={metricsError ? "alert" : "status"}>
        {metricsError
          ? `Could not load benchmark metrics: ${metricsError}`
          : report?.generatedAt
            ? `Report generated ${new Date(
                report.generatedAt
              ).toLocaleString()} · ${report.benchmarkType || "benchmark"}`
            : metricsLoading
              ? "Loading saved benchmark metrics…"
              : "No saved benchmark report found. Run a benchmark first."}
      </p>

      <section className="metric-grid">
        <MetricCard
          title="Overall throughput"
          value={
            metricsLoading ? "…" : formatNumber(metrics.throughput)
          }
          unit="req/s"
          icon={Activity}
          tone="purple"
          detail="Saved benchmark report"
        />

        <MetricCard
          title="P50 latency"
          value={
            metricsLoading ? "…" : formatNumber(metrics.p50LatencyMs)
          }
          unit="ms"
          icon={Clock3}
          tone="blue"
          detail="Median latency"
        />

        <MetricCard
          title="P97.5 latency"
          value={
            metricsLoading ? "…" : formatNumber(metrics.p975LatencyMs)
          }
          unit="ms"
          icon={Gauge}
          tone="green"
          detail="Tail latency"
        />

        <MetricCard
          title="Errors and timeouts"
          value={
            metricsLoading
              ? "…"
              : formatNumber(
                  Number(metrics.errors || 0) +
                    Number(metrics.timeouts || 0)
                )
          }
          icon={ShieldCheck}
          tone="amber"
          detail={`${formatNumber(metrics.rejected429)} rejected with HTTP 429`}
        />
      </section>

      <section className="panel benchmark-panel">
        <div className="panel-heading">
          <div>
            <h2>Strategy comparison</h2>
            <p className="muted small">
              Per-algorithm results included in the saved report
            </p>
          </div>

          <button
            type="button"
            className="button secondary"
            onClick={() => refreshMetrics().catch(() => {})}
            disabled={metricsLoading}
          >
            {metricsLoading ? "Refreshing…" : "Refresh results"}
          </button>
        </div>

        <div className="table-wrapper">
          <table className="benchmark-table">
            <thead>
              <tr>
                <th>Algorithm</th>
                <th>Requests/sec</th>
                <th>P50</th>
                <th>P97.5</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((item, index) => (
                  <tr key={`${item.name || "algorithm"}-${index}`}>
                    <td>{item.name || "Unknown"}</td>
                    <td>
                      {formatNumber(
                        item.requestsPerSecond ?? item.throughput
                      )}
                    </td>
                    <td>{metricValue(item.p50LatencyMs, " ms")}</td>
                    <td>{metricValue(item.p975LatencyMs, " ms")}</td>
                    <td
                      className={
                        Number(item.errors || 0) === 0
                          ? "success-text"
                          : ""
                      }
                    >
                      {formatNumber(item.errors ?? 0)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    {metricsLoading
                      ? "Loading benchmark rows…"
                      : "No per-algorithm rows found in this report."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="muted small">
          {report?.configuration
            ? `Configuration: ${report.configuration.rounds} rounds · ${report.configuration.durationSeconds}s per round · ${report.configuration.connections} connections.`
            : "Benchmark configuration is not available."}{" "}
          HTTP 429 responses are counted as rate-limit rejections, not
          automatically as server errors.
        </p>
      </section>

      <BenchmarkHistory />
    </>
  );
}

function APIPlayground() {
  const [method, setMethod] = useState("GET");
  const [endpoint, setEndpoint] = useState("/api/demo");
  const [clientId, setClientId] = useState("demo-client");
  const [body, setBody] = useState(
    '{\n  "message": "Hello ThrottleX"\n}'
  );
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);

  async function sendRequest(event) {
    event.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const cleanEndpoint = endpoint.trim().startsWith("/")
        ? endpoint.trim()
        : `/${endpoint.trim()}`;

      const baseWithoutApi = API_BASE.replace(/\/api$/i, "");

      const requestUrl = /^https?:\/\//i.test(cleanEndpoint)
        ? cleanEndpoint
        : cleanEndpoint.startsWith("/api/")
          ? `${baseWithoutApi}${cleanEndpoint}`
          : `${API_BASE}${cleanEndpoint}`;

      const headers = {
        "Content-Type": "application/json",
        "X-Client-Id": clientId.trim() || "demo-client",
      };

      const options = {
        method,
        headers,
      };

      if (method !== "GET" && method !== "HEAD") {
        try {
          options.body = JSON.stringify(JSON.parse(body));
        } catch {
          setResponse({
            ok: false,
            status: "Invalid JSON",
            data: {
              error: "Check the request body. It must contain valid JSON.",
            },
          });
          setLoading(false);
          return;
        }
      }

      const startedAt = performance.now();
      const result = await fetch(requestUrl, options);
      const elapsed = Math.round(performance.now() - startedAt);
      const contentType = result.headers.get("content-type") || "";

      let data;

      if (contentType.includes("application/json")) {
        data = await result.json();
      } else {
        data = await result.text();
      }

      setResponse({
        ok: result.ok,
        status: result.status,
        elapsed,
        data,
        headers: Object.fromEntries(result.headers.entries()),
      });
    } catch (error) {
      setResponse({
        ok: false,
        status: "Network error",
        data: {
          error: error.message || "Failed to fetch",
          help: "Check that the backend is running, the endpoint is correct, and CORS permits your frontend origin.",
        },
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEVELOPER TOOLS</span>
          <h1>API playground</h1>
          <p>Send a real HTTP request to your locally running backend.</p>
        </div>
      </div>

      <section className="panel playground-panel">
        <div className="panel-heading">
          <div>
            <h2>Request builder</h2>
            <p className="muted small">
              Make sure the backend and Redis are running first.
            </p>
          </div>
          <Code2 size={21} />
        </div>

        <form onSubmit={sendRequest} className="request-form">
          <label htmlFor="request-method">HTTP method</label>
          <select
            id="request-method"
            className="input-control"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>

          <label htmlFor="request-endpoint">API endpoint</label>
          <input
            id="request-endpoint"
            className="input-control"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="/api/demo"
            required
          />

          <label htmlFor="request-client">Client ID</label>
          <input
            id="request-client"
            className="input-control"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="demo-client"
          />

          {method !== "GET" && method !== "HEAD" && (
            <>
              <label htmlFor="request-body">JSON request body</label>
              <textarea
                id="request-body"
                className="input-control body-input"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={5}
              />
            </>
          )}

          <button
            className="button primary"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Play size={17} />
            )}
            {loading ? "Sending request..." : "Send request"}
          </button>
        </form>

        <p className="muted small helper-text">
          API base URL: {API_BASE}. Change VITE_API_BASE_URL in frontend/.env
          if your backend uses another address.
        </p>

        {response && (
          <div className="response-section">
            <div className="response-heading">
              <h2>Response</h2>
              <span
                className={`status-pill ${
                  response.ok ? "active" : "error"
                }`}
              >
                {response.status}
              </span>
            </div>

            {response.elapsed !== undefined && (
              <p className="muted small">
                Completed in {response.elapsed} ms
              </p>
            )}

            <pre className="response-output">
              {typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data, null, 2)}
            </pre>

            {response.headers && (
              <details className="response-details">
                <summary>Response headers</summary>
                <pre className="response-output">
                  {JSON.stringify(response.headers, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export default function App() {
  const [trafficRange, setTrafficRange] = useState("1h");
  const [traffic, setTraffic] = useState([]);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [trafficError, setTrafficError] = useState("");

  useEffect(() => {
    let active = true;
    let timer;
    const loadTraffic = async () => {
      try {
        const response = await fetch(`${API_BASE}/metrics/traffic?range=${trafficRange}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Request failed");
        if (active) { setTraffic(payload.series || []); setTrafficError(""); }
      } catch (err) {
        if (active) setTrafficError(err.message || "Unable to fetch traffic telemetry");
      } finally {
        if (active) setTrafficLoading(false);
      }
    };
    setTrafficLoading(true);
    loadTraffic();
    timer = window.setInterval(loadTraffic, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [trafficRange]);

  const [page, setPage] = useState("Overview");
  const [report, setReport] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState("");

  async function refreshMetrics() {
    setMetricsLoading(true);
    setMetricsError("");

    try {
      const response = await fetch(`${API_BASE}/metrics`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const payload = await response.json();

      if (!response.ok || payload?.success === false) {
        throw new Error(
          payload?.error?.message ||
            `Request failed (${response.status})`
        );
      }

      setReport(payload);
      // Keep independently mounted charts in sync when a fresh report is loaded.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("throttlex:metrics-updated"));
      }
      return payload;
    } catch (error) {
      setMetricsError(error.message || "Unable to load metrics");
      throw error;
    } finally {
      setMetricsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialMetrics() {
      try {
        const response = await fetch(`${API_BASE}/metrics`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        const payload = await response.json();

        if (!response.ok || payload?.success === false) {
          throw new Error(
            payload?.error?.message ||
              `Request failed (${response.status})`
          );
        }

        if (!cancelled) {
          setReport(payload);
          setMetricsError("");
        }
      } catch (error) {
        if (!cancelled) {
          setMetricsError(error.message || "Unable to load metrics");
        }
      } finally {
        if (!cancelled) {
          setMetricsLoading(false);
        }
      }
    }

    loadInitialMetrics();

    return () => {
      cancelled = true;
    };
  }, []);

  const pageContent = {
    Overview: (
      <Overview
        setPage={setPage}
        report={report}
        metricsLoading={metricsLoading}
        metricsError={metricsError}
        trafficRange={trafficRange}
        setTrafficRange={setTrafficRange}
        traffic={traffic}
        trafficLoading={trafficLoading}
        trafficError={trafficError}
      />
    ),
    Algorithms: (
      <Algorithms
        report={report}
        metricsLoading={metricsLoading}
        metricsError={metricsError}
      />
    ),
    Benchmarks: (
      <Benchmarks
        report={report}
        metricsLoading={metricsLoading}
        metricsError={metricsError}
        refreshMetrics={refreshMetrics}
      />
    ),
    "API Playground": <APIPlayground />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Zap size={26} fill="currentColor" />
          </div>
          <div>
            <div className="brand-name">
              Throttle<span>X</span>
            </div>
            <div className="brand-caption">API CONTROL PLANE</div>
          </div>
        </div>

        <div className="sidebar-section">
          <span className="sidebar-label">WORKSPACE</span>

          <button className="workspace-selector" type="button">
            <span className="workspace-avatar">T</span>
            <span className="workspace-copy">
              <strong>Local development</strong>
              <small>Personal workspace</small>
            </span>
            <ChevronDown size={17} />
          </button>
        </div>

        <div className="sidebar-section platform-section">
          <span className="sidebar-label">PLATFORM</span>

          <nav className="navigation" aria-label="Main navigation">
            {navItems.map(({ label, icon: Icon }) => (
              <button
                type="button"
                key={label}
                className={`nav-item ${page === label ? "selected" : ""}`}
                onClick={() => setPage(label)}
                aria-current={page === label ? "page" : undefined}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <span className="promo-icon">
              <ShieldCheck size={23} />
            </span>
            <h3>Built for reliable APIs</h3>
            <p>
              Atomic enforcement. Isolated clients. Measurable performance.
            </p>
          </div>

          <div className="sidebar-profile">
            <span className="profile-avatar">TX</span>
            <div className="profile-copy">
              <strong>ThrottleX</strong>
              <small>Developer edition</small>
            </div>
            <MoreHorizontal size={20} />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>ThrottleX</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{page}</strong>
          </div>

          <div className="topbar-actions">
            <span className="environment-pill">
              <span className="online-dot" />
              Local environment
            </span>

            <button
              type="button"
              className="icon-button"
              title="Configuration"
              onClick={() => setPage("API Playground")}
            >
              <SlidersHorizontal size={19} />
            </button>

            <span className="topbar-divider" />

            <button
              type="button"
              className="user-button"
              title="Developer profile"
            >
              <UserRound size={17} />
            </button>
          </div>
        </header>

        <div className="page-content" key={page}>
          {pageContent[page]}
        </div>

        <footer className="app-footer">
          <span>
            ThrottleX <span className="footer-divider">·</span> API Rate
            Limiting Platform
          </span>
          <span>
            <GitBranch size={14} /> Local development
          </span>
        </footer>
      </main>
    </div>
  );
}