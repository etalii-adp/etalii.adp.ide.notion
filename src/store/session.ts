// The session: the user's Notion token, kept in the browser and asked for through the service's
// grant of access (etalii.adp spec 012, contracts/service.md, "The token in the browser").

const KEY = 'adp-notion.token';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// How often the service is asked for the grant, and how long a grant may take in all, in
// milliseconds.
const ASK_EVERY = 2_000;
const AT_MOST = 300_000;

/**
 * Why no token could be had. `refused`, `timeout` and `cancelled`: the grant ended without a
 * token, the last because the person stopped waiting. `expired`: the kept token could not be
 * renewed and is removed. `unreachable`: the service gave no answer, and what is kept is still
 * kept.
 */
export type ConnectReason = 'refused' | 'timeout' | 'cancelled' | 'expired' | 'unreachable';

/** A grant under way, for a page to show. */
export interface Waiting {
  /** Where the person grants access: a page links to it for when no window opened. */
  readonly address: string;
  /** Whether a window was opened for it. */
  readonly opened: boolean;
  /** Stops waiting; the grant ends as `cancelled`. */
  cancel(): void;
}

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
  /**
   * The kept token, or the one a grant gives. Only a call that needs a token asks for it.
   * `onWaiting` is told once of the grant this call waits for.
   */
  token(options?: { onWaiting?(waiting: Waiting): void }): Promise<string>;
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
  open?: (url: string) => object | null;
  fetch?: typeof fetch;
  /** Hears the messages posted to this page; answers what stops it. */
  listen?: (take: (message: { origin: string; data: unknown }) => void) => () => void;
  /** Runs a check now and then; answers what stops it. */
  every?: (check: () => void, milliseconds: number) => () => void;
  /** The time in milliseconds. */
  now?: () => number;
  random?: (bytes: Uint8Array) => Uint8Array;
}

interface Pair {
  verifier: string;
  state: string;
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
  const now = options.now ?? (() => Date.now());

  // Storage that is refused once is left alone: the session then lives in memory, for this page.
  let storage = options.storage ?? browserStorage();
  let memory: string | null = null;
  let granting: Promise<string> | undefined;
  let waiting: Waiting | undefined;
  let toTell: ((waiting: Waiting) => void)[] = [];
  // The verifier and the state of the next grant, made ahead of it: making the state takes a
  // turn, and a browser opens a window only in the turn of the person's click.
  let prepared: Pair | undefined;
  let preparing: Promise<Pair>;
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

  function prepare(): void {
    prepared = undefined;
    preparing = (async () => {
      // 256 is a multiple of 64, so every character is as likely as any other.
      const verifier = Array.from(random(new Uint8Array(48)), (byte) => ALPHABET[byte & 63]).join('');
      // The state goes through addresses, so it is only the verifier's digest: who reads it
      // there cannot ask the service for the token.
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      return (prepared = { verifier, state });
    })();
    // Whoever needs the pair hears why there is none.
    preparing.catch(() => undefined);
  }
  prepare();

  /** Starts a grant: at once with the pair that is ready, and after it when it is not yet. */
  function grant(): Promise<string> {
    const pair = prepared;
    const started = pair ? wait(pair) : preparing.then(wait);
    // Each grant has a pair of its own.
    prepare();
    return started;
  }

  function wait({ verifier, state }: Pair): Promise<string> {
    const address = `${service}/authorize?state=${state}`;

    /** What the service keeps of this grant, which it hands over once; nothing while there is none. */
    const ask = async (): Promise<unknown> => {
      try {
        const answer = await send(`${service}/grant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ verifier }),
        });
        return answer.status === 200 ? await answer.json() : undefined;
      } catch {
        return undefined;
      }
    };

    return new Promise<string>((resolve, reject) => {
      let done = false;
      let asking = false;
      let stopListening = (): void => undefined;
      let stopWatching = (): void => undefined;
      const finish = (): void => {
        done = true;
        waiting = undefined;
        toTell = [];
        stopListening();
        stopWatching();
      };
      const fail = (reason: ConnectReason, code?: string): void => {
        if (done) return;
        finish();
        reject(new ConnectError(reason, code));
      };
      const take = (data: unknown): void => {
        if (done || !isObject(data) || data.source !== 'adp-notion' || data.state !== state) return;
        if (typeof data.token !== 'string' || data.token === '') {
          fail('refused', typeof data.error === 'string' ? data.error : 'invalid_request');
          return;
        }
        finish();
        keep({
          token: data.token,
          refresh: typeof data.refresh === 'string' ? data.refresh : null,
          workspace: typeof data.workspace === 'string' ? data.workspace : '',
        });
        resolve(data.token);
      };

      stopListening = listen(({ origin: from, data }) => {
        if (done || from !== origin) return;
        take(data);
        // The service keeps a copy for a window without an opener: asking for it removes it now.
        if (done) void ask();
      });
      // A window that does not open is no failure: a page shows the address as a link, and where
      // the page is embedded in an app, the app may have opened it in the system's browser.
      const opened = open(address);
      if (done) return;

      // A window that is closed ends nothing: an app may answer one that reads as closed at
      // once, and a person may close it and grant in another.
      const started = now();
      let asked = started;
      stopWatching = every(() => {
        // An answer under way may hold the token, so nothing ends before it is here.
        if (asking) return;
        const time = now();
        if (time - started >= AT_MOST) fail('timeout');
        else if (time - asked >= ASK_EVERY) {
          asked = time;
          asking = true;
          void ask().then((data) => {
            asking = false;
            take(data);
          });
        }
      }, 500);

      waiting = { address, opened: opened !== null, cancel: () => fail('cancelled') };
      for (const tell of toTell.splice(0)) tell(waiting);
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
    token({ onWaiting } = {}) {
      const has = kept();
      if (has) return Promise.resolve(has.token);
      granting ??= grant().finally(() => (granting = undefined));
      if (onWaiting && waiting) onWaiting(waiting);
      else if (onWaiting) toTell.push(onWaiting);
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
