// The service as an add-on reaches it: a `fetch` that runs the real handler, with the in-memory
// Notion as the handler's own `fetch`. A test of the store so takes the whole path, from the
// add-on through the service to Notion.

import { handle, type ServiceConfig } from '../../service/handler';
import { createMemoryNotion, type MemoryNotion, type MemoryNotionOptions } from './memoryNotion';

export interface MemoryService {
  /** The service's base address, as the store's modules take it. */
  readonly address: string;
  /** The origin of the add-on's pages, the one the service allows. */
  readonly origin: string;
  readonly notion: MemoryNotion;
  readonly config: ServiceConfig;
  fetch: typeof fetch;
  /** Every request that reached the service, as `METHOD /path`. */
  readonly requests: string[];
  /** The next requests, one unless told otherwise, find the service out of reach. */
  unreachable(times?: number): void;
  /**
   * What the window of a grant does: it follows the address the session opened through Notion's
   * grant and the service's callback, and answers the message the callback's page posts.
   * With `refuse`, the user refuses with that code and Notion grants nothing.
   */
  grant(address: string, options?: { refuse?: string }): Promise<{ origin: string; data: unknown }>;
}

export function createMemoryService(options: MemoryNotionOptions & { address?: string; origin?: string } = {}): MemoryService {
  const address = options.address ?? 'https://service.example';
  const origin = options.origin ?? 'https://etalii.net';
  const notion = createMemoryNotion(options);
  const config: ServiceConfig = {
    clientId: options.clientId ?? 'memory-client',
    clientSecret: options.clientSecret ?? 'memory-secret',
    allowedOrigin: origin,
    serviceAddress: address,
    fetch: notion.fetch,
  };
  const requests: string[] = [];
  let out = 0;

  return {
    address,
    origin,
    notion,
    config,
    requests,
    unreachable: (times = 1) => void (out += times),

    async fetch(input, init) {
      const request = new Request(input, init);
      // A browser says where the page is from.
      request.headers.set('Origin', origin);
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      if (out > 0) {
        out--;
        throw new TypeError('fetch failed');
      }
      return handle(request, config);
    },

    async grant(opened, { refuse } = {}) {
      const state = new URL(opened).searchParams.get('state') ?? '';
      const toNotion = (await handle(new Request(opened), config)).headers.get('Location');
      if (!toNotion) throw new Error(`The service does not start a grant at ${opened}`);
      const back = refuse
        ? `${address}/callback?error=${encodeURIComponent(refuse)}&state=${state}`
        : (await notion.fetch(toNotion, { redirect: 'manual' })).headers.get('Location')!;
      const page = await (await handle(new Request(back), config)).text();
      const posted = /postMessage\((\{.*?\}), ("[^"]*")\); window\.close\(\);<\/script>$/.exec(page);
      if (!posted) throw new Error('The callback answered no page that posts a message.');
      if (JSON.parse(posted[2]) !== origin) throw new Error('The message is posted to another origin than the add-on\'s.');
      return { origin: new URL(address).origin, data: JSON.parse(posted[1]) };
    },
  };
}

/** A local storage of its own; with `refused`, one that throws as a browser's refusal does. */
export function createMemoryStorage(refused = false): Storage {
  const kept = new Map<string, string>();
  const use = <T>(answer: () => T): T => {
    if (refused) throw new DOMException('The operation is insecure.', 'SecurityError');
    return answer();
  };
  return {
    get length() {
      return use(() => kept.size);
    },
    clear: () => use(() => kept.clear()),
    getItem: (key) => use(() => kept.get(key) ?? null),
    key: (index) => use(() => [...kept.keys()][index] ?? null),
    removeItem: (key) => use(() => void kept.delete(key)),
    setItem: (key, value) => use(() => void kept.set(key, value)),
  };
}
