// The session: the user's Notion token, kept in the browser and asked for through the service's
// grant of access (etalii.adp spec 012, contracts/service.md, "The token in the browser").

const KEY = 'adp-notion.token';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Why no token could be had. `blocked`: the browser opened no window, so the grant never started
 * and the frame offers its link to a tab. `closed` and `refused`: the grant ended without a token.
 * `expired`: the kept token could not be renewed and is removed. `unreachable`: the service gave
 * no answer, and what is kept is still kept.
 */
export type ConnectReason = 'blocked' | 'closed' | 'refused' | 'expired' | 'unreachable';

export class ConnectError extends Error {
  override readonly name = 'ConnectError';

  constructor(
    readonly reason: ConnectReason,
    /** Notion's error code, where it gave one. */
    readonly code = '',
  ) {
    super(`The user must connect to Notion (${code || reason}).`);
  }
}

export interface Session {
  /** The kept token, or the one a grant gives. Only a call that needs a token asks for it. */
  token(): Promise<string>;
  /** Exchanges the kept refresh token for a new pair, once however many ask at the same time. */
  refresh(): Promise<string>;
  disconnect(): void;
  /** Whether a token is kept, without asking for one. */
  hasToken(): boolean;
  /** The name of the workspace the kept token is of. */
  workspace(): string | null;
}

export interface SessionOptions {
  /** The service's base address. */
  service: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Opens the grant in a window of its own; null when the browser opens none. */
  open?: (url: string) => { readonly closed: boolean } | null;
  fetch?: typeof fetch;
  /** Hears the messages posted to this page; answers what stops it. */
  listen?: (take: (message: { origin: string; data: unknown }) => void) => () => void;
  /** Runs a check now and then; answers what stops it. */
  every?: (check: () => void, milliseconds: number) => () => void;
  random?: (bytes: Uint8Array) => Uint8Array;
}

interface Kept {
  token: string;
  refresh: string | null;
  workspace: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function browserStorage(): SessionOptions['storage'] {
  try {
    return globalThis.localStorage;
  } catch {
    // A browser may refuse an embedded page its storage by throwing here.
    return undefined;
  }
}

export function createSession(options: SessionOptions): Session {
  const service = options.service.replace(/\/$/, '');
  const origin = new URL(service).origin;
  const send = options.fetch ?? fetch;
  const open = options.open ?? ((url) => window.open(url, '_blank', 'popup,width=520,height=720'));
  const listen =
    options.listen ??
    ((take) => {
      window.addEventListener('message', take);
      return () => window.removeEventListener('message', take);
    });
  const every =
    options.every ??
    ((check, milliseconds) => {
      const timer = setInterval(check, milliseconds);
      return () => clearInterval(timer);
    });
  const random = options.random ?? ((bytes) => crypto.getRandomValues(bytes));

  // Storage that is refused once is left alone: the session then lives in memory, for this page.
  let storage = options.storage ?? browserStorage();
  let memory: string | null = null;
  let granting: Promise<string> | undefined;
  let refreshing: Promise<string> | undefined;

  function stored<T>(use: (storage: NonNullable<SessionOptions['storage']>) => T, otherwise: () => T): T {
    if (storage) {
      try {
        return use(storage);
      } catch {
        storage = undefined;
      }
    }
    return otherwise();
  }

  function kept(): Kept | null {
    // Read each time: another add-on's page may have been granted the token since.
    const text = stored((storage) => storage.getItem(KEY), () => memory);
    try {
      const value: unknown = JSON.parse(text ?? 'null');
      if (!isObject(value) || typeof value.token !== 'string' || value.token === '') return null;
      return {
        token: value.token,
        refresh: typeof value.refresh === 'string' ? value.refresh : null,
        workspace: typeof value.workspace === 'string' ? value.workspace : '',
      };
    } catch {
      return null;
    }
  }

  function keep(value: Kept): void {
    memory = JSON.stringify(value);
    stored((storage) => storage.setItem(KEY, memory!), () => undefined);
  }

  function disconnect(): void {
    memory = null;
    stored((storage) => storage.removeItem(KEY), () => undefined);
  }

  function grant(): Promise<string> {
    // 256 is a multiple of 64, so every character is as likely as any other.
    const state = Array.from(random(new Uint8Array(48)), (byte) => ALPHABET[byte & 63]).join('');
    return new Promise<string>((resolve, reject) => {
      let done = false;
      let stopListening = (): void => undefined;
      let stopWatching = (): void => undefined;
      const finish = (): void => {
        done = true;
        stopListening();
        stopWatching();
      };
      stopListening = listen(({ origin: from, data }) => {
        if (from !== origin || !isObject(data) || data.source !== 'adp-notion' || data.state !== state) return;
        finish();
        if (typeof data.token !== 'string' || data.token === '') {
          reject(new ConnectError('refused', typeof data.error === 'string' ? data.error : 'invalid_request'));
          return;
        }
        keep({
          token: data.token,
          refresh: typeof data.refresh === 'string' ? data.refresh : null,
          workspace: typeof data.workspace === 'string' ? data.workspace : '',
        });
        resolve(data.token);
      });
      const opened = open(`${service}/authorize?state=${state}`);
      if (done) return;
      if (!opened) {
        finish();
        reject(new ConnectError('blocked'));
        return;
      }
      stopWatching = every(() => {
        if (!opened.closed) return;
        finish();
        reject(new ConnectError('closed'));
      }, 500);
    });
  }

  async function renew(): Promise<string> {
    const before = kept();
    let answer: Response | undefined;
    if (before?.refresh) {
      try {
        answer = await send(`${service}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: before.refresh }),
        });
      } catch {
        throw new ConnectError('unreachable');
      }
    }
    const body: unknown = await answer?.json().catch(() => null);
    if (before && answer?.ok && isObject(body) && typeof body.token === 'string' && body.token !== '') {
      keep({ token: body.token, refresh: typeof body.refresh === 'string' ? body.refresh : null, workspace: before.workspace });
      return body.token;
    }
    // Notion could not be asked: the refresh token may still be good, so it is kept.
    if (answer?.status === 502) throw new ConnectError('unreachable');
    disconnect();
    throw new ConnectError('expired', isObject(body) && typeof body.error === 'string' ? body.error : '');
  }

  // One grant and one refresh at a time, whoever asks: a second window or a second use of a
  // refresh token would fail the first.
  return {
    token() {
      const now = kept();
      if (now) return Promise.resolve(now.token);
      granting ??= grant().finally(() => (granting = undefined));
      return granting;
    },
    refresh() {
      refreshing ??= renew().finally(() => (refreshing = undefined));
      return refreshing;
    },
    disconnect,
    hasToken: () => kept() !== null,
    workspace: () => kept()?.workspace ?? null,
  };
}
