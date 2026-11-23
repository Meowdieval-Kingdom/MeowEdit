export const NETWORK_TIMEOUT_MS = 20_000;
export const NETWORK_TIMEOUT_MESSAGE = "The request timed out. Check your connection and try again.";

/**
 * Runs an async operation with an abortable deadline. The underlying work is
 * actually aborted on timeout (not merely abandoned), a caller-supplied signal
 * is forwarded, and a late failure after the deadline is reported as a timeout
 * instead of a confusing low-level error.
 */
export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  milliseconds = NETWORK_TIMEOUT_MS,
  callerSignal?: AbortSignal | null,
  message = NETWORK_TIMEOUT_MESSAGE
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, milliseconds);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
