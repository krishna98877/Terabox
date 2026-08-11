/**
 * Test CaptchaSolv API status and solve time
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const apiKey = process.env.CAPTCHASOLV_API_KEY;
  console.log('API Key:', apiKey?.substring(0, 8) + '...');
  
  // Check balance
  console.log('\n=== Balance ===');
  try {
    const res = await fetch('https://api.capsolver.com/getBalance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  
  // Try solving a simple captcha to test API speed
  console.log('\n=== Test Solve (proxyless) ===');
  const t0 = Date.now();
  try {
    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'RecaptchaV2EnterpriseTaskProxyless',
          websiteURL: 'https://www.1024terabox.com/',
          websiteKey: '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH',
        }
      }),
      signal: AbortSignal.timeout(15000),
    });
    const createData = await createRes.json();
    console.log(`Create response (${((Date.now()-t0)/1000).toFixed(1)}s):`, JSON.stringify(createData).substring(0, 300));
    
    if (createData.taskId) {
      // Poll for result
      console.log(`Task ID: ${createData.taskId}`);
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch('https://api.capsolver.com/getTaskResult', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientKey: apiKey, taskId: createData.taskId }),
          signal: AbortSignal.timeout(10000),
        });
        const pollData = await pollRes.json();
        const elapsed = ((Date.now()-t0)/1000).toFixed(1);
        
        if (pollData.status === 'ready') {
          console.log(`\n★★★ SOLVED in ${elapsed}s ★★★`);
          console.log(`Token length: ${pollData.solution?.gRecaptchaResponse?.length || 0}`);
          console.log(`Token preview: ${pollData.solution?.gRecaptchaResponse?.substring(0, 30)}...`);
          break;
        }
        
        console.log(`[${elapsed}s] Status: ${pollData.status} | ${pollData.errorId || 0}`);
        if (pollData.errorId > 0) {
          console.log('Error:', pollData.errorDescription);
          break;
        }
      }
    }
  } catch (e: any) {
    console.log(`Error (${((Date.now()-t0)/1000).toFixed(1)}s):`, e.message);
  }
}

main().catch(console.error);
