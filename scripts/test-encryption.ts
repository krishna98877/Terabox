/**
 * Test the RSA encryption fix directly
 */
async function main() {
  const { TeraBoxSession, encryptEmail } = await import('../src/lib/terabox/api');
  const tb = new TeraBoxSession('enctest');
  
  const pk = await tb.getPubKey();
  if (!pk) { console.log('No pubkey'); return; }
  
  console.log('Pubkey length:', pk.pubkey?.length);
  console.log('Pubkey preview:', pk.pubkey?.substring(0, 40));
  
  // Test encryption
  console.log('\n--- Testing encryptEmail ---');
  try {
    const enc = encryptEmail('test123@catchmail.io', pk.pubkey);
    console.log('★ Encryption SUCCESS!');
    console.log('Encrypted length:', enc.length);
    console.log('Encrypted preview:', enc.substring(0, 40));
  } catch (e: any) {
    console.log('Encryption FAILED:', e.message);
  }
  
  // Test password encryption
  console.log('\n--- Testing encodePassword ---');
  try {
    const { encodePassword } = await import('../src/lib/terabox/api');
    const enc = encodePassword('TestPass123!@#', pk.pubkey);
    console.log('★ Password encryption SUCCESS!');
    console.log('Encrypted length:', enc.length);
  } catch (e: any) {
    console.log('Password encryption FAILED:', e.message);
  }
}

main().catch(console.error);
