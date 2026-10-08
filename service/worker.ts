// The service as a Cloudflare Worker (etalii.adp spec 012, contracts/service.md). Everything it
// does is in handler.ts, which knows no platform; this file only hands it the Worker's settings.
// The local service, scripts/service.mjs, runs the same handler.
import { handle } from './handler';

interface Settings {
  NOTION_CLIENT_ID: string;
  NOTION_CLIENT_SECRET: string;
  ALLOWED_ORIGIN: string;
}

export default {
  fetch(request: Request, settings: Settings): Promise<Response> {
    return handle(request, {
      clientId: settings.NOTION_CLIENT_ID,
      clientSecret: settings.NOTION_CLIENT_SECRET,
      allowedOrigin: settings.ALLOWED_ORIGIN,
      serviceAddress: new URL(request.url).origin,
    });
  },
};
