/**
 * Direct signup test script — runs the engine WITHOUT going through the HTTP server.
 * This avoids Next.js dev server crashes and gives us direct console output.
 * 
 * Tests: signup WITHOUT proxy (per user's request)
 */
import { executeSignup } from '../src/lib/automation/engine';
import { db } from '../src/lib/db';
import { PrismaClient } from '@prisma/client';

const REFERRAL_LINK = 'https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ';

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  LIVE SIGNUP TEST — NO PROXY (direct connection)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Referral Link: ${REFERRAL_LINK}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  // Ensure config exists
  let config = await db.referralConfig.findFirst();
  if (!config) {
    config = await db.referralConfig.create({
      data: {
        masterLink: REFERRAL_LINK,
        isActive: true,
        autoSignup: false,
        signupInterval: 30,
        maxSignupsPerDay: 50,
      },
    });
    console.log('Created default config');
  } else if (!config.masterLink) {
    config = await db.referralConfig.update({
      where: { id: config.id },
      data: { masterLink: REFERRAL_LINK },
    });
    console.log('Updated config with default masterLink');
  }
  console.log(`Config: masterLink=${config.masterLink}, isActive=${config.isActive}`);

  // Check captcha status
  const apiKey = process.env.CAPTCHASOLV_API_KEY;
  console.log(`CAPTCHASOLV_API_KEY: ${apiKey ? apiKey.substring(0, 8) + '...' : 'NOT SET'}`);

  // Clear proxy pool to force direct connection
  console.log('');
  console.log('─── Clearing proxy pool (forcing NO PROXY) ───');
  // We'll just let the engine's getNextProxy return null naturally

  console.log('');
  console.log('─── Starting signup attempt ───');
  const startTime = Date.now();

  try {
    const result = await executeSignup(REFERRAL_LINK);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  RESULT (${elapsed}s)`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`Success: ${result.success}`);
    console.log(`Email: ${result.email}`);
    console.log(`Status: ${result.status}`);
    if (result.error) console.log(`Error: ${result.error}`);
    if (result.proxyUsed) console.log(`Proxy Used: ${result.proxyUsed}`);
    if (result.steps) {
      console.log('');
      console.log('─── Steps ───');
      result.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    }
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  FATAL ERROR (${elapsed}s)`);
    console.log('═══════════════════════════════════════════════════');
    console.error(err);
  }

  // Fetch and display activity logs for this test
  console.log('');
  console.log('─── Activity Logs (last 20) ───');
  const logs = await db.activityLog.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
  });
  
  for (const log of logs) {
    const time = new Date(log.createdAt).toLocaleTimeString();
    const metaStr = log.metadata ? ` [metadata: ${log.metadata.substring(0, 200)}${log.metadata.length > 200 ? '...' : ''}]` : '';
    console.log(`  [${time}] ${log.type.toUpperCase()}: ${log.message}${metaStr}`);
  }

  await db.$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
