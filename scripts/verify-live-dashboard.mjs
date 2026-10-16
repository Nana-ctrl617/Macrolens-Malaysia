import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ARTIFACT = join(ROOT, 'data/published/dashboard.json');
const DEFAULT_API_URL = 'https://macrolens-malaysia.vercel.app/api/dashboard';
const DEFAULT_ATTEMPTS = 13;
const DEFAULT_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validArtifact(value) {
  return isRecord(value)
    && Number.isInteger(value.schemaVersion)
    && value.schemaVersion >= 1
    && typeof value.generatedAt === 'string'
    && Number.isFinite(Date.parse(value.generatedAt));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/**
 * Wait until the public API serves the exact validated artifact pushed by the
 * scheduled workflow. Vercel's per-instance artifact cache can take up to five
 * minutes to expire, so a bounded retry is expected after data-only commits.
 */
export async function verifyLiveDashboard({
  artifactPath = DEFAULT_ARTIFACT,
  apiUrl = DEFAULT_API_URL,
  fetcher = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  sleep: pause = sleep,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 30) throw new Error('Dashboard verification attempts must be an integer from 1 to 30.');
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 120_000) throw new Error('Dashboard verification interval must be from 0 to 120000 milliseconds.');
  if (typeof fetcher !== 'function' || typeof pause !== 'function') throw new Error('Dashboard verification requires fetch and sleep functions.');

  const expected = JSON.parse(await readFile(artifactPath, 'utf8'));
  if (!validArtifact(expected)) throw new Error('The published dashboard artifact has invalid schema or generatedAt metadata.');
  let url;
  try { url = new URL(apiUrl); } catch { throw new Error('DASHBOARD_API_URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new Error('DASHBOARD_API_URL must use HTTPS.');

  let lastObserved = 'No response received.';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        lastObserved = `HTTP ${response.status}`;
      } else {
        const live = await response.json();
        if (!isRecord(live)) {
          lastObserved = 'The API returned a non-object JSON value.';
        } else if (live.usingFallback !== false) {
          lastObserved = `The API reports fallback data (usingFallback=${String(live.usingFallback)}).`;
        } else if (live.schemaVersion !== expected.schemaVersion) {
          lastObserved = `Schema mismatch: expected ${expected.schemaVersion}, received ${String(live.schemaVersion)}.`;
        } else if (live.generatedAt !== expected.generatedAt) {
          lastObserved = `Artifact timestamp mismatch: expected ${expected.generatedAt}, received ${String(live.generatedAt)}.`;
        } else {
          return { generatedAt: expected.generatedAt, schemaVersion: expected.schemaVersion, attempts: attempt };
        }
      }
    } catch (error) {
      lastObserved = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      console.log(`Waiting for public dashboard artifact (${attempt}/${attempts - 1} retries): ${lastObserved}`);
      await pause(intervalMs);
    }
  }

  throw new Error(`Public dashboard API did not serve the validated artifact after ${attempts} attempts. Last response: ${lastObserved}`);
}

async function main() {
  const result = await verifyLiveDashboard({ apiUrl: process.env.DASHBOARD_API_URL || DEFAULT_API_URL });
  console.log(`Public dashboard verified: schema ${result.schemaVersion}, generatedAt ${result.generatedAt} (attempt ${result.attempts}).`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT, 'verified=true\n', 'utf8');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
