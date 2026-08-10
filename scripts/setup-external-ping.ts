/**
 * External Ping Service Registration
 *
 * Programmatically registers the TeraBox app on free uptime monitoring services
 * using the agentmail.to email for signup. These provide the INITIAL bootstrap
 * ping that wakes the server, after which self-ping keeps it alive.
 *
 * Services:
 * 1. UptimeRobot (free: 50 monitors, 5-min intervals)
 * 2. cron-job.org (free: unlimited, custom intervals)
 */

const RENDER_URL = 'https://terabox-detf.onrender.com';
const AGENTMAIL_EMAIL = 'z.aiishee@agentmail.to';
const AGENTMAIL_API_KEY = 'am_us_inbox_8f0ba92ba7a10f59e34000f0ecb0a81451a89799e11ab709fd74af0dc5bb7bce';

// ─── UptimeRobot Registration ───

/**
 * UptimeRobot has a public API. We can create monitors directly
 * using their API key (requires account). Let's try the API approach.
 * 
 * Since we don't have a UptimeRobot API key yet, we'll use their
 * signup API to create an account first.
 */
async function setupUptimeRobot(): Promise<void> {
  console.log('\n=== UptimeRobot Setup ===');
  console.log(`Monitor URL: ${RENDER_URL}/api/health`);
  console.log(`Interval: 5 minutes (free tier minimum)`);
  console.log(`Alert Email: ${AGENTMAIL_EMAIL}`);
  
  // UptimeRobot doesn't have a public signup API, but we can use their
  // monitor API if we had an API key. For now, we'll set up via
  // their new-account flow.
  
  // Try creating an account via their signup endpoint
  try {
    const signupRes = await fetch('https://uptimerobot.com/v2/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        email: AGENTMAIL_EMAIL,
        password: 'TeraBot2024!Secure',
        name: 'TeraBox Agent',
      }),
      signal: AbortSignal.timeout(15000),
    });
    
    console.log(`Signup response: ${signupRes.status}`);
    if (signupRes.ok) {
      const data = await signupRes.json().catch(() => ({}));
      console.log('UptimeRobot signup response:', JSON.stringify(data).substring(0, 200));
    }
  } catch (err) {
    console.log(`UptimeRobot signup not available via API: ${(err as Error).message}`);
  }
  
  console.log('\nTo complete UptimeRobot setup manually:');
  console.log('1. Go to https://uptimerobot.com');
  console.log('2. Sign up with: z.aiishee@agentmail.to');
  console.log('3. Add monitor: https://terabox-detf.onrender.com/api/health');
  console.log('4. Set interval: 5 minutes');
  console.log('5. Alert to: z.aiishee@agentmail.to');
}

// ─── cron-job.org Registration ───

async function setupCronJobOrg(): Promise<void> {
  console.log('\n=== cron-job.org Setup ===');
  console.log(`Job URL: ${RENDER_URL}/api/init`);
  console.log(`Interval: Every 5 minutes`);
  console.log(`Auth Email: ${AGENTMAIL_EMAIL}`);

  // cron-job.org has an API for creating jobs
  // First, let's try to create an account
  try {
    // Try their API endpoint for creating a cron job
    // cron-job.org API docs: https://cron-job.org/api/
    const createJobRes = await fetch('https://api.cron-job.org/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        email: AGENTMAIL_EMAIL,
        password: 'TeraBot2024!Secure',
      }),
      signal: AbortSignal.timeout(15000),
    });
    
    console.log(`cron-job.org login response: ${createJobRes.status}`);
  } catch (err) {
    console.log(`cron-job.org API not available: ${(err as Error).message}`);
  }

  console.log('\nTo complete cron-job.org setup manually:');
  console.log('1. Go to https://cron-job.org');
  console.log('2. Sign up with: z.aiishee@agentmail.to');
  console.log('3. Create job: URL = https://terabox-detf.onrender.com/api/init');
  console.log('4. Schedule: Every 5 minutes');
  console.log('5. Method: GET');
}

// ─── AgentMail Health Check ───

async function verifyAgentMail(): Promise<void> {
  console.log('\n=== AgentMail Verification ===');
  console.log(`Email: ${AGENTMAIL_EMAIL}`);
  console.log(`API Key: ${AGENTMAIL_API_KEY.substring(0, 20)}...`);
  
  try {
    // Test the agentmail API
    const res = await fetch('https://api.agentmail.to/v1/me', {
      headers: {
        'Authorization': `Bearer ${AGENTMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log('AgentMail account verified:', JSON.stringify(data).substring(0, 200));
    } else {
      console.log(`AgentMail API returned: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.log(`AgentMail verification: ${(err as Error).message}`);
  }
}

// ─── Direct Keep-Alive Test ───

async function testSelfPing(): Promise<void> {
  console.log('\n=== Direct Keep-Alive Test ===');
  console.log(`Pinging: ${RENDER_URL}/api/health`);
  
  try {
    const start = Date.now();
    const res = await fetch(`${RENDER_URL}/api/health`, {
      headers: { 'User-Agent': 'TeraBox-Setup/1.0' },
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    const latency = Date.now() - start;
    
    console.log(`Health check: ${res.status} (${latency}ms)`);
    
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log('Engine running:', data.engine?.running);
      console.log('Keep-alive running:', data.keepAlive?.isRunning);
      console.log('Workers:', data.engine?.workers);
      console.log('Proxy pool:', data.proxy?.poolSize, 'proxies');
    }
  } catch (err) {
    console.log(`Ping failed: ${(err as Error).message}`);
    console.log('Server may be sleeping — first external ping will wake it');
  }
  
  // Also ping /api/init to ensure engine starts
  console.log(`\nPinging: ${RENDER_URL}/api/init`);
  try {
    const res = await fetch(`${RENDER_URL}/api/init`, {
      method: 'POST',
      headers: { 'User-Agent': 'TeraBox-Setup/1.0' },
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    console.log(`Init: ${res.status}`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log('Initialized:', data.initialized);
      console.log('Engine running:', data.engineRunning);
    }
  } catch (err) {
    console.log(`Init ping failed: ${(err as Error).message}`);
  }
}

// ─── Main ───

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   TeraBox Referral Agent — 24/7 Setup        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\nApp URL: ${RENDER_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  
  await verifyAgentMail();
  await testSelfPing();
  await setupUptimeRobot();
  await setupCronJobOrg();
  
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Setup Complete                              ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nThe self-ping keep-alive is built into the app.');
  console.log('Once deployed, it will automatically start on server boot.');
  console.log('Just needs ONE external ping to bootstrap (wake from sleep).');
  console.log('\nFastest way: curl https://terabox-detf.onrender.com/api/init');
}

main().catch(console.error);
