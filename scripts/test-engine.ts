/**
 * Direct engine test — runs a single signup without the Next.js HTTP server.
 * This tests the actual engine code with all params, cookies, and captcha.
 */
import { executeSignup } from '../src/lib/automation/engine.ts';
import { PrismaClient } from '@prisma/client';

const REFERRAL_LINK = 'https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ';

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  LIVE SIGNUP TEST — NO PROXY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Referral: ${REFERRAL_LINK}`);
  console.log('');

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
    if (result.steps) {
      console.log('');
      console.log('─── Steps ───');
      result.steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    }
  } catch (err) {
    console.error('Fatal:', err);
  }
}

main();
