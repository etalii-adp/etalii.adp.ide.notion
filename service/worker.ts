// The service as a Cloudflare Worker (etalii.adp spec 012, contracts/service.md). Everything it
// does is in handler.ts, which knows no platform; this file only hands it the Worker's settings
// and a place for the grants in progress. The local service, scripts/service.mjs, runs the same
// handler.
import { handle, type Grants } from './handler';

/** What this file uses of a Durable Object namespace. */
interface GrantNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(address: string, init?: RequestInit): Promise<Response> };
}

/** What this file uses of a Durable Object's state. */
interface GrantState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(time: number): Promise<void>;
  };
}

interface Settings {
  NOTION_CLIENT_ID: string;
  NOTION_CLIENT_SECRET: string;
  ALLOWED_ORIGIN: string;
  GRANTS: GrantNamespace;
}

/**
 * The outcome of one grant, in a Durable Object of its own, named by the grant's state. A
 * key-value store would not do: it may answer "not there" for a minute after a write.
 */
export class Grant {
  constructor(private readonly state: GrantState) {}

  async fetch(request: Request): Promise<Response> {
    const { storage } = this.state;
    if (request.method === 'PUT') {
      const expires = Date.now() + Number(new URL(request.url).searchParams.get('seconds')) * 1000;
      await storage.put('grant', { value: await request.text(), expires });
      await storage.setAlarm(expires);
      return new Response(null, { status: 204 });
    }
    const kept = await storage.get<{ value: string; expires: number }>('grant');
    await storage.deleteAll();
    // The alarm may come late, so the time is checked here too.
    return kept && kept.expires > Date.now() ? new Response(kept.value) : new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

function grantsOf(namespace: GrantNamespace): Grants {
  const of = (key: string) => namespace.get(namespace.idFromName(key));
  return {
    async put(key, value, seconds) {
      const answer = await of(key).fetch(`https://grant/?seconds=${seconds}`, { method: 'PUT', body: value });
      if (!answer.ok) throw new Error('The grant could not be kept.');
    },
    async take(key) {
      const answer = await of(key).fetch('https://grant/', { method: 'POST' });
      return answer.status === 200 ? answer.text() : undefined;
    },
  };
}

export default {
  fetch(request: Request, settings: Settings): Promise<Response> {
    return handle(request, {
      clientId: settings.NOTION_CLIENT_ID,
      clientSecret: settings.NOTION_CLIENT_SECRET,
      allowedOrigin: settings.ALLOWED_ORIGIN,
      serviceAddress: new URL(request.url).origin,
      grants: grantsOf(settings.GRANTS),
    });
  },
};
