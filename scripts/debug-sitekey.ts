/**
 * Debug sitekey extraction — check what's in TeraBox HTML
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const urls = [
    'https://www.1024terabox.com',
    'https://1024terabox.com',
    'https://www.terabox.com',
  ];
  
  for (const url of urls) {
    console.log(`\n=== Fetching ${url} ===`);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      const html = await res.text();
      console.log(`HTML length: ${html.length}`);
      
      // Search for recaptcha patterns
      const patterns = [
        /sitekey['":\s]+['"]([^'"]+)['"]/gi,
        /recaptcha[^"]*['"]([^'"]{30,})['"]/gi,
        /6L[a-zA-Z0-9]{38}/g,  // reCAPTCHA sitekeys start with 6L
        /grecaptcha/gi,
        /captcha/gi,
      ];
      
      for (let i = 0; i < patterns.length; i++) {
        const matches = [...html.matchAll(patterns[i])];
        if (matches.length > 0) {
          console.log(`  Pattern ${i+1}: ${matches.length} matches`);
          for (const m of matches.slice(0, 3)) {
            console.log(`    Match: ${m[0]?.substring(0, 80)}`);
          }
        }
      }
      
      // Also check for script src with recaptcha
      const scriptMatches = [...html.matchAll(/<script[^>]*src=['"]([^'"]*recaptcha[^'"]*)['"][^>]*>/gi)];
      if (scriptMatches.length > 0) {
        console.log(`  reCAPTCHA script tags: ${scriptMatches.length}`);
        for (const m of scriptMatches) {
          console.log(`    ${m[1]?.substring(0, 100)}`);
        }
      }
      
      // Check for data-sitekey
      const dataSitekey = [...html.matchAll(/data-sitekey=['"]([^'"]+)['"]/gi)];
      if (dataSitekey.length > 0) {
        console.log(`  data-sitekey: ${dataSitekey.length} matches`);
        for (const m of dataSitekey) {
          console.log(`    ${m[1]}`);
        }
      }
      
    } catch (e: any) {
      console.log(`Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
