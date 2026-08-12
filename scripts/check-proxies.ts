import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const { getNextProxy, getProxyStatus } = await import('../src/lib/proxy');
  const status = getProxyStatus();
  console.log('Proxy status:', JSON.stringify(status, null, 2));
  const proxy = await getNextProxy();
  console.log('Next proxy:', proxy ? JSON.stringify(proxy, null, 2) : 'None available');
}

main().catch(console.error);
