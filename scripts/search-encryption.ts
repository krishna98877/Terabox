/**
 * Search TeraBox JS for how they encrypt email with pubkey
 */
async function main() {
  // Get the main JS bundle
  const res = await fetch('https://s5.teraboxcdn.com/fe-static/fe-v5-web-index/js/index.26abcf88.js', {
    signal: AbortSignal.timeout(30000),
  });
  const js = await res.text();
  
  // Search for encryption-related code
  const patterns = [
    /encrypt/gi,
    /RSA/gi,
    /JSEncrypt/gi,
    /pubkey/gi,
    /pp1/gi,
    /pp2/gi,
    /getpubkey/gi,
    /passVersion/gi,
    /fs-ex-st/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = [...js.matchAll(pattern)];
    if (matches.length > 0 && matches.length < 20) {
      console.log(`\n=== Pattern: ${pattern.source} (${matches.length} matches) ===`);
      for (const m of matches) {
        const idx = m.index || 0;
        const context = js.substring(Math.max(0, idx - 100), idx + 150);
        console.log(`  [${idx}] ...${context}...`);
      }
    } else if (matches.length > 0) {
      console.log(`\n=== Pattern: ${pattern.source} (${matches.length} matches — too many, showing first 5) ===`);
      for (const m of matches.slice(0, 5)) {
        const idx = m.index || 0;
        const context = js.substring(Math.max(0, idx - 80), idx + 120);
        console.log(`  [${idx}] ...${context}...`);
      }
    }
  }
}

main().catch(console.error);
