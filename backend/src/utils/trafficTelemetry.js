const BUCKET_MS = 60_000;
const RETENTION_BUCKETS = 24 * 60;
const buckets = new Map();

export function recordTrafficRequest(statusCode, timestamp = Date.now()) {
  const bucketStart = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
  let bucket = buckets.get(bucketStart);
  if (!bucket) {
    bucket = { timestamp: bucketStart, incoming: 0, limited: 0 };
    buckets.set(bucketStart, bucket);
  }
  bucket.incoming += 1;
  if (statusCode === 429) bucket.limited += 1;
  const cutoff = bucketStart - RETENTION_BUCKETS * BUCKET_MS;
  for (const key of buckets.keys()) if (key < cutoff) buckets.delete(key);
}

export function getTrafficSeries(range = "1h", now = Date.now()) {
  const rangeMs = range === "15m" ? 15 * 60_000 : range === "24h" ? 24 * 60 * 60_000 : 60 * 60_000;
  const stepMs = range === "24h" ? 60 * 60_000 : 60_000;
  const start = Math.floor((now - rangeMs) / stepMs) * stepMs;
  const series = [];
  for (let timestamp = start; timestamp <= now; timestamp += stepMs) {
    const bucketStart = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
    if (stepMs === BUCKET_MS) {
      const bucket = buckets.get(bucketStart);
      series.push({ timestamp: new Date(timestamp).toISOString(), incoming: bucket?.incoming ?? 0, limited: bucket?.limited ?? 0, time: new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) });
    } else {
      let incoming = 0, limited = 0;
      for (let t = timestamp; t < timestamp + stepMs; t += BUCKET_MS) {
        const bucket = buckets.get(t);
        if (bucket) { incoming += bucket.incoming; limited += bucket.limited; }
      }
      series.push({ timestamp: new Date(timestamp).toISOString(), incoming, limited, time: new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) });
    }
  }
  return series;
}

