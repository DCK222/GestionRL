export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    const { processQueue } = await import("./lib/fiscal-service");
    const globals = globalThis as typeof globalThis & {
      rlFiscalTimer?: ReturnType<typeof setInterval>;
    };
    if (!globals.rlFiscalTimer) {
      let running = false;
      globals.rlFiscalTimer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
          await processQueue();
        } catch {
          console.warn(
            "VeriFactu: cola pendiente. Revise la configuración y los registros.",
          );
        } finally {
          running = false;
        }
      }, 60000);
      globals.rlFiscalTimer.unref();
    }
  }
}
