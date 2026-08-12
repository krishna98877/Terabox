/**
 * Deep search for recaptcha sitekey in TeraBox main JS
 */
async function main() {
  console.log('Fetching main JS bundle...');
  const res = await fetch('https://s5.teraboxcdn.com/fe-static/fe-v5-web-index/js/index.26abcf88.js', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(30000),
  });
  const js = await res.text();
  console.log(`Size: ${js.length}`);

  // Find all occurrences of 'recaptcha' with surrounding context
  const reMatches = [...js.matchAll(/recaptcha/gi)];
  console.log(`\n'recaptcha' occurrences: ${reMatches.length}`);
  for (const m of reMatches) {
    const idx = m.index || 0;
    console.log(`  [${idx}] ...${js.substring(Math.max(0, idx - 80), idx + 120)}...`);
  }
  
  // Find 'sitekey' with context
  const skMatches = [...js.matchAll(/sitekey/gi)];
  console.log(`\n'sitekey' occurrences: ${skMatches.length}`);
  for (const m of skMatches) {
    const idx = m.index || 0;
    console.log(`  [${idx}] ...${js.substring(Math.max(0, idx - 80), idx + 120)}...`);
  }
  
  // Find 'grecaptcha' with context
  const grMatches = [...js.matchAll(/grecaptcha/gi)];
  console.log(`\n'grecaptcha' occurrences: ${grMatches.length}`);
  for (const m of grMatches) {
    const idx = m.index || 0;
    console.log(`  [${idx}] ...${js.substring(Math.max(0, idx - 80), idx + 120)}...`);
  }
  
  // Find any 40-char base64-like strings that look like sitekeys
  // reCAPTCHA v2 sitekeys are 40 chars, format: 6L...
  const allKeys = [...js.matchAll(/['"`]([6L][A-Za-z0-9_-]{38,41})['"`]/g)];
  console.log(`\nPotential sitekey strings (6L...): ${allKeys.length}`);
  for (const m of allKeys) {
    console.log(`  ${m[1]}`);
  }

  // Look for captcha rendering/render function
  const renderMatches = [...js.matchAll(/\.render\(/g)];
  console.log(`\n.render() calls: ${renderMatches.length}`);
  for (const m of renderMatches.slice(0, 5)) {
    const idx = m.index || 0;
    console.log(`  [${idx}] ...${js.substring(Math.max(0, idx - 60), idx + 100)}...`);
  }
}

main().catch(console.error);
