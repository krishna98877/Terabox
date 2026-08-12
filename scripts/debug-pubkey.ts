/**
 * Debug RSA pubkey format
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const { TeraBoxSession } = await import('../src/lib/terabox/api');
  const tb = new TeraBoxSession('pktest');
  
  const pk = await tb.getPubKey();
  if (!pk) { console.log('No pubkey'); return; }
  
  console.log('Full pubkey response:');
  console.log(JSON.stringify(pk, null, 2));
  
  console.log('\npubkey (pp1) length:', pk.pubkey?.length);
  console.log('pubkey (pp1) first 100:', pk.pubkey?.substring(0, 100));
  console.log('pubkey (pp1) last 50:', pk.pubkey?.substring((pk.pubkey?.length || 0) - 50));
  
  // Try to decode base64 to see if it's a valid DER
  try {
    const buf = Buffer.from(pk.pubkey || '', 'base64');
    console.log('\nBase64 decoded length:', buf.length);
    console.log('First 20 bytes:', buf.subarray(0, 20).toString('hex'));
    
    // Check if it starts with standard DER header (30 82 = SEQUENCE)
    if (buf[0] === 0x30) {
      console.log('★★★ Valid DER format! Starts with SEQUENCE tag');
    } else {
      console.log('NOT standard DER format');
    }
  } catch (e: any) {
    console.log('Base64 decode error:', e.message);
  }
  
  // Try encryption with different formats
  console.log('\n--- Testing encryption ---');
  
  // Test 1: Direct (current method)
  try {
    const forge = require('node-forge');
    const pki = forge.pki;
    const lines = (pk.pubkey || '').match(/.{1,64}/g) || [pk.pubkey];
    const pem = '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----';
    console.log('PEM:', pem.substring(0, 100) + '...');
    const publicKey = pki.publicKeyFromPem(pem);
    console.log('★ Key parsed OK');
    const encrypted = publicKey.encrypt('test@catchmail.io', 'RSAES-PKCS1-V1_5');
    console.log('★ Encryption OK, result length:', forge.util.encode64(encrypted).length);
  } catch (e: any) {
    console.log('Encryption FAILED:', e.message);
  }
}

main().catch(console.error);
