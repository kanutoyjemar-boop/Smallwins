const baseUrl = process.env.APP_URL;

if (!baseUrl) {
  console.error('Set APP_URL to the deployed Small Wins URL before running the smoke check.');
  process.exit(1);
}

async function check(path) {
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(10000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(`${path} returned HTTP ${response.status}: ${body.error || 'unexpected response'}`);
  }
  console.log(`${path}: OK`);
}

Promise.all([check('/api/health/live'), check('/api/health/ready')]).catch((err) => {
  console.error(`Smoke check failed: ${err.message}`);
  process.exitCode = 1;
});
