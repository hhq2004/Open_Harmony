/** Host-only adapter. Timers drive deadlines, NOT proof of UI/system idleness. */
export const nodeRuntime = Object.freeze({
  now: () => performance.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
});
