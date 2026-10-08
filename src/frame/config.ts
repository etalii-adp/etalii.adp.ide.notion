// The one place in src/ that names the service (etalii.adp spec 012, contracts/service.md).
// A page served from localhost talks to the local service, `node scripts/service.mjs`.
// Any other page talks to the deployed service, the Cloudflare Worker of service/worker.ts.
const LOCAL_SERVICE = 'http://localhost:8787';
const DEPLOYED_SERVICE = 'https://adp-notion.notion-adp.workers.dev';

export function serviceAddress(location: Pick<Location, 'hostname'>): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local ? LOCAL_SERVICE : DEPLOYED_SERVICE;
}
