/**
 * Dump TeraBox HTML to see what's there
 */
async function main() {
  const res = await fetch('https://www.1024terabox.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  console.log('Length:', html.length);
  console.log('--- First 3000 chars ---');
  console.log(html.substring(0, 3000));
  console.log('--- Last 2000 chars ---');
  console.log(html.substring(html.length - 2000));
}

main().catch(console.error);
