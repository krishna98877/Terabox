/**
 * Search for reCAPTCHA sitekey in TeraBox JS bundles
 */
async function main() {
  console.log('Fetching main HTML...');
  const res = await fetch('https://www.1024terabox.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  
  // Find all JS bundle URLs
  const jsUrls = [...html.matchAll(/src=['"]([^'"]*\.js)['"]/g)].map(m => m[1]);
  console.log(`Found ${jsUrls.length} JS URLs`);
  
  for (const url of jsUrls) {
    const fullUrl = url.startsWith('http') ? url : `https://www.1024terabox.com${url}`;
    console.log(`\nChecking: ${fullUrl.substring(0, 80)}...`);
    try {
      const jsRes = await fetch(fullUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      const jsText = await jsRes.text();
      console.log(`  Size: ${jsText.length}`);
      
      // Search for recaptcha sitekey patterns
      const sitekeyMatches = [...jsText.matchAll(/6L[a-zA-Z0-9_-]{38,42}/g)];
      if (sitekeyMatches.length > 0) {
        console.log(`  ★★★ FOUND SITEKEYS: ${sitekeyMatches.length}`);
        for (const m of sitekeyMatches) {
          console.log(`    ${m[0]}`);
        }
      }
      
      // Also search for sitekey keyword
      const skMatches = [...jsText.matchAll(/sitekey/gi)];
      if (skMatches.length > 0) {
        console.log(`  'sitekey' mentions: ${skMatches.length}`);
        for (const m of skMatches.slice(0, 5)) {
          const idx = m.index || 0;
          console.log(`    ...${jsText.substring(Math.max(0, idx - 30), idx + 60)}...`);
        }
      }
      
      // Search for recaptcha
      const rcMatches = [...jsText.matchAll(/recaptcha/gi)];
      if (rcMatches.length > 0) {
        console.log(`  'recaptcha' mentions: ${rcMatches.length}`);
        for (const m of rcMatches.slice(0, 5)) {
          const idx = m.index || 0;
          console.log(`    ...${jsText.substring(Math.max(0, idx - 20), idx + 80)}...`);
        }
      }
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }
  
  // Also try the /ndbs/ bundle specifically
  console.log('\n\n=== Checking ndbs bundle ===');
  try {
    const ndbsRes = await fetch('https://www.1024terabox.com/ndbs/nd_bundle_430546.js', {
      signal: AbortSignal.timeout(15000),
    });
    const ndbsText = await ndbsRes.text();
    console.log(`Size: ${ndbsText.length}`);
    
    const sitekeys = [...ndbsText.matchAll(/6L[a-zA-Z0-9_-]{38,42}/g)];
    if (sitekeys.length > 0) {
      console.log(`★★★ SITEKEYS FOUND:`);
      for (const m of sitekeys) console.log(`  ${m[0]}`);
    }
    
    const skM = [...ndbsText.matchAll(/sitekey/gi)];
    if (skM.length > 0) {
      console.log(`'sitekey' mentions: ${skM.length}`);
      for (const m of skM.slice(0, 3)) {
        const idx = m.index || 0;
        console.log(`  ...${ndbsText.substring(Math.max(0, idx - 30), idx + 80)}...`);
      }
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }
}

main().catch(console.error);
