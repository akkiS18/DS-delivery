/**
 * One-shot, ordered shutdown. Each step runs even if an earlier one throws; the whole sequence is bounded by a hard timeout so a stuck
 * connection can never leave the process hanging. A second call (e.g. a second SIGTERM) joins the first instead of running steps twice.
 */
export interface ShutdownStep { name: string; run: () => void | Promise<void> }
export interface ShutdownResult { timedOut: boolean; failed: string[] }

export function createShutdown(steps: () => ShutdownStep[], opts: { timeoutMs?: number; log?: (msg: string, extra?: object) => void } = {}) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const log = opts.log ?? (() => undefined);
  let running: Promise<ShutdownResult> | undefined;
  return (reason: string): Promise<ShutdownResult> => {
    running ??= (async () => {
      log(`${reason}: shutting down`);
      const failed: string[] = [];
      let timer: NodeJS.Timeout | undefined;
      const sequence = (async () => {
        for (const step of steps()) {
          try { await step.run(); } catch (err) { failed.push(step.name); log(`shutdown step "${step.name}" failed`, { err }); }
        }
        return false;
      })();
      const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), timeoutMs); timer.unref(); });
      const timedOut = await Promise.race([sequence, timeout]);
      clearTimeout(timer);
      if (timedOut) log(`shutdown exceeded ${timeoutMs}ms; forcing exit`);
      return { timedOut, failed };
    })();
    return running;
  };
}
