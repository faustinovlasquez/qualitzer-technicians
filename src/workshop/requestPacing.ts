import { ApiError } from "../infrastructure/errors";

/** La ventana de la pasarela dura un minuto: tres esperas de 20 segundos alcanzan para pasarla. */
const RATE_LIMIT_WAIT_MS = 20_000;
const RATE_LIMIT_RETRIES = 3;

/** Si la pasarela responde que se pasó el límite, espera y reintenta sin que la persona tenga que hacer nada. */
export async function retryWhenRateLimited<T>(load: () => Promise<T>, isActive: () => boolean, waitMs = RATE_LIMIT_WAIT_MS, retries = RATE_LIMIT_RETRIES): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await load(); }
    catch (failure) {
      if (!(failure instanceof ApiError) || failure.code !== "RATE_LIMITED" || attempt >= retries || !isActive()) throw failure;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (!isActive()) throw failure;
    }
  }
}

/** Una sola carga a la vez: lo pedido mientras otra corre se junta en una sola repetición al terminar. */
export function singleFlight(run: () => Promise<unknown>): () => void {
  let running = false;
  let again = false;
  const start = () => {
    if (running) { again = true; return; }
    running = true;
    void run().catch(() => undefined).finally(() => {
      running = false;
      if (again) { again = false; start(); }
    });
  };
  return start;
}
