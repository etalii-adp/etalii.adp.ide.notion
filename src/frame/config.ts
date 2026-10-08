// The one place in src/ that names the service (etalii.adp spec 012, contracts/service.md).
// A page served from localhost talks to the local service, `node scripts/service.mjs`.
// Any other page talks to the deployed Worker, whose address is written here when it exists.
const LOCAL_SERVICE = 'http://localhost:8787';
const DEPLOYED_SERVICE = '';

export function serviceAddress(location: Pick<Location, 'hostname'>): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local ? LOCAL_SERVICE : DEPLOYED_SERVICE;
}
