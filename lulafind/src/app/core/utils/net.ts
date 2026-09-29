/**
 * A network call that never answers is worse than one that fails.
 *
 * Supabase (and any HTTP call) can sit for minutes on a stalled connection -
 * a cellphone on a bad tower looks exactly like this. Without a deadline the
 * screen shows its loading state for ever, which reads as "the app is broken".
 * These helpers give every read a deadline and a name for what went wrong.
 */

export class NetTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not answer within ${Math.round(ms / 1000)}s`);
    this.name = 'NetTimeoutError';
  }
}

/**
 * Resolve `promise`, or throw a NetTimeoutError once `ms` have passed.
 *
 * The original promise is left to settle on its own - we cannot cancel a fetch
 * that has already been sent, and the caller only needs to stop waiting.
 */
export function withTimeout<T>(promise: Promise<T>, ms = 12_000, label = 'The server'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new NetTimeoutError(label, ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** True when an error came from withTimeout rather than from the server. */
export function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === 'NetTimeoutError';
}
