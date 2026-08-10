/**
 * 24/7 Keep-Alive Daemon — Pings Render every 5 minutes forever.
 *
 * This runs as a background Node.js process:
 *   node /home/z/my-project/scripts/keep-alive-daemon.js
 *
 * It pings:
 *   - /api/health (keeps server awake)
 *   - /api/init (auto-starts engine if down)
 */

const RENDER_URL = 'https://terabox-detf.onrender.com';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LOG_FILE = '/home/z/my-project/scripts/keep-alive.log';

const fs = require('fs');

async function ping() {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);

  try {
    // Ping health
    const healthRes = await fetch(`${RENDER_URL}/api/health`, {
      signal: AbortSignal.timeout(15000),
    });
    const healthStatus = healthRes.status;

    // Ping init (auto-starts engine)
    const initRes = await fetch(`${RENDER_URL}/api/init`, {
      signal: AbortSignal.timeout(15000),
    });
    const initStatus = initRes.status;

    // Get engine status
    let engineInfo = '';
    try {
      const data = await healthRes.json();
      const engine = data.engine || {};
      const runningWorkers = (engine.workerStates || []).filter(w => w.status === 'running').length;
      const proxy = (data.proxy || {}).poolSize || 0;
      const strategy = (data.browser || {}).strategy || 'unknown';
      engineInfo = `engine=${engine.running} workers=${runningWorkers} proxies=${proxy} strategy=${strategy}`;
    } catch {
      engineInfo = 'parse_error';
    }

    const line = `[${ts}] health=${healthStatus} init=${initStatus} ${engineInfo}`;
    console.log(line);

    // Append to log
    try {
      fs.appendFileSync(LOG_FILE, line + '\n');
      // Keep log under 500 lines
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
      if (lines.length > 500) {
        fs.writeFileSync(LOG_FILE, lines.slice(-250).join('\n'));
      }
    } catch {}
  } catch (error) {
    const line = `[${ts}] ERROR: ${error.message}`;
    console.log(line);
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  }
}

console.log(`[Keep-Alive] Starting daemon — pinging ${RENDER_URL} every /5 min`);
console.log(`[Keep-Alive] Log file: ${LOG_FILE}`);

// Ping immediately
ping();

// Then every 5 minutesC minutes
setInterval(ping, INTERVAL_MS);
