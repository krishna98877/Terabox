/**
 * Search for recaptcha sitekey in TeraBox API endpoints
 * TeraBox likely has an API that returns the recaptcha sitekey
 */
async function main() {
  // Try common TeraBox API endpoints that might return captcha config
  const endpoints = [
    '/api/recaptcha/config',
    '/api/captcha/config',
    '/passport/getcaptchaconfig',
    '/passport/getpubkey',  // Already known - might include captcha info
    '/api/config',
    '/nodeapi/config',
    '/api/getcodeconf',
  ];
  
  const baseUrls = ['https://www.1024terabox.com', 'https://1024terabox.com'];
  
  for (const base of baseUrls) {
    for (const ep of endpoints) {
      const url = `${base}${ep}`;
      try {
        console.log(`\nTrying: ${url}`);
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cookie': 'lang=en;',
          },
          signal: AbortSignal.timeout(8000),
        });
        const text = await res.text();
        console.log(`  Status: ${res.status}, Length: ${text.length}`);
        if (text.length < 2000) {
          console.log(`  Body: ${text.substring(0, 500)}`);
        }
        
        // Check for sitekey in response
        const sitekeys = [...text.matchAll(/6L[a-zA-Z0-9_-]{38,42}/g)];
        if (sitekeys.length > 0) {
          console.log(`  ★★★ SITEKEY FOUND: ${sitekeys[0][0]}`);
        }
        
        // Check for recaptcha keyword
        if (text.toLowerCase().includes('recaptcha') || text.toLowerCase().includes('sitekey')) {
          console.log(`  ★★★ Contains recaptcha/sitekey reference!`);
          console.log(`  ${text.substring(0, 1000)}`);
        }
      } catch (e: any) {
        console.log(`  Error: ${e.message}`);
      }
    }
  }
  
  // Also try the passport/register page directly which should have the signup form with captcha
  console.log('\n\n=== Trying signup page ===');
  for (const base of baseUrls) {
    const signupUrls = [
      `${base}/passport/account/signup`,
      `${base}/passport/register`,
    ];
    for (const url of signupUrls) {
      try {
        console.log(`\nTrying: ${url}`);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
          redirect: 'follow',
        });
        const text = await res.text();
        console.log(`  Status: ${res.status}, Length: ${text.length}`);
        
        const sitekeys = [...text.matchAll(/6L[a-zA-Z0-9_-]{38,42}/g)];
        if (sitekeys.length > 0) {
          console.log(`  ★★★ SITEKEY FOUND: ${sitekeys[0][0]}`);
        }
        
        // Search broader pattern
        const broaderKeys = [...text.matchAll(/['"]([A-Za-z0-9_-]{39,41})['"]/g)];
        const rcKeys = broaderKeys.filter(m => m[1].startsWith('6L'));
        if (rcKeys.length > 0) {
          console.log(`  ★★★ SITEKEY (broad): ${rcKeys[0][1]}`);
        }
      } catch (e: any) {
        console.log(`  Error: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
