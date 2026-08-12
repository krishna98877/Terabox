/**
 * Analyze the TeraBox pubkey format
 * Check if it's JWK, custom format, or needs different handling
 */
async function main() {
  const { TeraBoxSession } = await import('../src/lib/terabox/api');
  const tb = new TeraBoxSession('analtest');
  const pk = await tb.getPubKey();
  if (!pk) { console.log('No pubkey'); return; }
  
  const pubkeyStr = pk.pubkey || '';
  console.log('Raw pubkey:', pubkeyStr.substring(0, 60) + '...');
  console.log('Length:', pubkeyStr.length);
  console.log('pp2:', pk.pp2);
  console.log('pp4:', pk.pp4);
  
  // Convert base64url to standard base64
  const standardB64 = pubkeyStr.replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(standardB64, 'base64');
  console.log('\nDecoded bytes:', buf.length);
  console.log('Hex:', buf.toString('hex').substring(0, 100));
  
  // Check if it could be a JWE/JWK format (TeraBox might use pp1 as encrypted key)
  // The pp2 looks like an IV/seed: "JW9myD7hCDV9fgoH" (16 bytes)
  console.log('\npp2 as base64 decoded:', Buffer.from(pk.pp2 || '', 'base64').toString('hex'));
  console.log('pp2 length:', pk.pp2?.length);
  
  // Try using crypto module instead of node-forge
  console.log('\n--- Trying with Node.js crypto ---');
  try {
    const crypto = require('crypto');
    
    // Try as SPKI/DER format
    const pem = `-----BEGIN PUBLIC KEY-----\n${standardB64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
    const key = crypto.createPublicKey(pem);
    console.log('★ Key type:', key.type);
    console.log('★ Key details:', key.asymmetricKeyType, key.asymmetricKeySize);
    
    // Test encryption
    const encrypted = crypto.publicEncrypt({
      key,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }, Buffer.from('test@catchmail.io'));
    console.log('★ Encryption SUCCESS! Length:', encrypted.length);
    console.log('★ Encrypted (base64):', encrypted.toString('base64').substring(0, 40) + '...');
  } catch (e: any) {
    console.log('crypto failed:', e.message);
  }
  
  // Maybe TeraBox uses AES encryption, not RSA?
  // The pp2 (16 chars = 128 bits) looks like an AES key
  // And pp1 (360 chars base64 ≈ 268 bytes) could be the encrypted data
  console.log('\n--- Checking if pp1+pp2 is AES-based ---');
  console.log('pp2 bytes:', Buffer.from(pk.pp2 || '', 'base64').length, '(should be 16 for AES-128)');
  
  // Try using JSEncrypt library
  console.log('\n--- Trying with node-forge (different approach) ---');
  try {
    const forge = require('node-forge');
    const pki = forge.pki;
    
    // Maybe the key needs ASN.1 wrapping differently
    // Let's try to decode the raw base64 as ASN.1
    const derBytes = forge.util.decode64(standardB64);
    console.log('DER bytes length:', derBytes.length);
    
    // Try to parse as ASN.1
    try {
      const asn1 = forge.asn1.fromDer(derBytes);
      console.log('★ ASN.1 parsed! Tag:', asn1.tag, 'Type:', asn1.type);
      
      // Try to create public key from ASN.1
      const publicKey = pki.publicKeyFromAsn1(asn1);
      console.log('★ Public key from ASN.1! Bits:', publicKey.n.bitLength());
      
      // Test encryption
      const encrypted = publicKey.encrypt('test@catchmail.io', 'RSAES-PKCS1-V1_5');
      console.log('★ Encryption SUCCESS!');
      console.log('★ Result:', forge.util.encode64(encrypted).substring(0, 40) + '...');
    } catch (asn1Err: any) {
      console.log('ASN.1 parse failed:', asn1Err.message);
    }
  } catch (e: any) {
    console.log('forge failed:', e.message);
  }
}

main().catch(console.error);
