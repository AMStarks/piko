/**
 * Performance benchmark adapter — measures response time and latency for a URL.
 */
async function runPerformanceBenchmark(url) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'URL required.' };
  }

  const timeoutMs = 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const start = performance.now();
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const end = performance.now();
    clearTimeout(timer);

    const latencyMs = Math.round(end - start);
    let statusFlag = 'Fast';
    if (latencyMs > 800) statusFlag = 'Degraded';
    if (latencyMs > 2000) statusFlag = 'Critical';

    return {
      success: true,
      target: url,
      latency_ms: latencyMs,
      status: statusFlag,
      http_status: response.status,
    };
  } catch (error) {
    clearTimeout(timer);
    return { success: false, error: error.message || 'Request failed' };
  }
}

module.exports = { runPerformanceBenchmark };
