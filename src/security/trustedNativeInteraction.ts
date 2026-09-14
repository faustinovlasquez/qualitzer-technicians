import type { NativeInteractionClock } from "./contracts";

export const NATIVE_INTERACTION_TIMEOUT_MS = 5 * 60 * 1000;

export const nativeInteractionClock: NativeInteractionClock = {
  now: () => performance.now(),
  schedule: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

export function waitForSecurityCondition(
  ready: () => boolean,
  subscribe: (listener: () => void) => () => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const cleanup = () => { unsubscribe(); signal.removeEventListener("abort", canceled); };
    const canceled = () => { cleanup(); reject(new Error("TRUSTED_NATIVE_INTERACTION_REVOKED")); };
    const check = () => {
      if (signal.aborted) { canceled(); return; }
      try {
        if (ready()) { cleanup(); resolve(); }
      } catch (error) { cleanup(); reject(error); }
    };
    signal.addEventListener("abort", canceled, { once: true });
    unsubscribe = subscribe(check);
    check();
  });
}

export function nativeResultOrRevocation<T>(operation: () => Promise<T>, signal: AbortSignal, onSettled?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", canceled);
    const canceled = () => { cleanup(); reject(new Error("TRUSTED_NATIVE_INTERACTION_REVOKED")); };
    if (signal.aborted) { canceled(); return; }
    signal.addEventListener("abort", canceled, { once: true });
    try {
      operation().then(value => {
        cleanup();
        try { onSettled?.(); resolve(value); } catch (error) { reject(error); }
      }, error => { cleanup(); reject(error); });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}