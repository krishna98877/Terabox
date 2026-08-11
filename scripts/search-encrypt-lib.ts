/**
 * Search for JS encrypt library in TeraBox's chunk files
 */
async function main() {
  // Get main HTML to find all script URLs
  const htmlRes = await fetch('https://www.1024terabox.com/', {
    signal: AbortSignal.timeout(15000),
  });
  const html = await htmlRes.text();
  
  // Find chunk JS files
  const allJsUrls = [...html.matchAll(/src=['"]([^'"]*\.js)['"]/g)].map(m => m[1]);
  console.log(`Main page scripts: ${allJsUrls.length}`);
  
  // Also try to find chunk files from the main bundle
  const mainJsRes = await fetch(allJsUrls[0], { signal: AbortSignal.timeout(15000) });
  const mainJs = await mainJsRes.text();
  
  // Find chunk references in the main bundle
  const chunkRefs = [...mainJs.matchAll(/["']([^"']*chunk[^"']*\.js)["']/g)].map(m => m[1]);
  console.log(`Chunk references: ${chunkRefs.length}`);
  
  // Also find any .js file references
  const jsRefs = [...mainJs.matchAll(/["']((?:https?:\/\/[^"']+|\/[^"']+)\.js)["']/g)].map(m => m[1]);
  console.log(`JS file references: ${jsRefs.length}`);
  
  // Search for passport/encrypt-related chunks
  const passportChunks = jsRefs.filter(r => 
    r.toLowerCase().includes('passport') || 
    r.toLowerCase().includes('login') || 
    r.toLowerCase().includes('register') ||
    r.toLowerCase().includes('encrypt') ||
    r.toLowerCase().includes('rsa') ||
    r.toLowerCase().includes('auth')
  );
  console.log(`\nPassport/Auth chunks: ${passportChunks.length}`);
  for (const c of passportChunks) console.log(`  ${c}`);
  
  // Try to fetch and search chunks that might contain encryption
  // Look for the ndbs bundle first
  const ndbsUrl = 'https://www.1024terabox.com/ndbs/nd_bundle_430546.js';
  console.log(`\nSearching ndbs bundle...`);
  const ndbsRes = await fetch(ndbsUrl, { signal: AbortSignal.timeout(15000) });
  const ndbs = await ndbsRes.text();
  
  const encryptMentions = [...ndbs.matchAll(/encrypt|RSA|JSEncrypt|publicKey|pubkey/gi)];
  if (encryptMentions.length > 0) {
    console.log(`★★★ Found ${encryptMentions.length} encryption mentions in ndbs!`);
    for (const m of encryptMentions.slice(0, 10)) {
      const idx = m.index || 0;
      console.log(`  ...${ndbs.substring(Math.max(0, idx - 50), idx + 100)}...`);
    }
  } else {
    console.log('No encryption in ndbs bundle');
  }
  
  // Let's also look at the network requests the browser makes during signup
  // Try the passport API directly with a different approach
  // The email might not need RSA encryption at all for some endpoints!
  console.log('\n=== Testing sendcode without encryption ===');
  const { TeraBoxSession } = await import('../src/lib/terabox/api');
  const { createTempEmail } = await import('../src/lib/catchmail');
  
  const tb = new TeraBoxSession('notpenc');
  tb.setProxyUrl(null);
  
  const email = await createTempEmail();
  console.log(`Email: ${email.address}`);
  
  // Visit share link
  await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  
  // Try sendcode WITHOUT encryption (no fs-ex-st header)
  console.log('\nsendcode without encryption header...');
  const res1 = await tb.sendVerificationCode(email.address, undefined, false);
  console.log(`Result: success=${res1.success} errno=${res1.errno} error=${res1.error||'none'}`);
  if (res1.rawResponse) console.log(`RAW: ${JSON.stringify(res1.rawResponse).substring(0, 300)}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
