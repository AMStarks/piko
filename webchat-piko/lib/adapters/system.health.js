/**
 * System health adapter — pings URLs to check for 200 status.
 */
async function pingEndpoints(urls) {
  const list = Array.isArray(urls) ? urls : [].concat(urls || []).filter(Boolean);
  if (list.length === 0) {
    return { success: false, error: 'No URLs provided.' };
  }

  const timeoutMs = 5000;

  const results = await Promise.all(
    list.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response = await fetch(url, { method: 'HEAD', signal: controller.signal });
        if (!response.ok && (response.status === 404 || response.status === 405)) {
          response = await fetch(url, { method: 'GET', signal: controller.signal });
        }
        clearTimeout(timer);
        return { url, status: response.status, ok: response.ok };
      } catch (e) {
        clearTimeout(timer);
        return { url, status: 'Failed', ok: false, error: e.message || 'Request failed' };
      }
    })
  );

  const failed = results.filter((r) => !r.ok);
  return {
    success: true,
    overall_status: failed.length === 0 ? 'healthy' : 'degraded',
    results,
    failed_endpoints: failed,
  };
}

module.exports = { pingEndpoints };
