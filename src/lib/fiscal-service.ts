import { createClient } from "@supabase/supabase-js";
import { createSecureContext } from "node:tls";
import {
  buildFiscalXml,
  sendAeat,
  parseAeatResponse,
  type Producer,
} from "./verifactu";
import type { FiscalRecord, Invoice } from "./types";
export function readiness() {
  let cert = false;
  try {
    if (process.env.VERIFACTU_PFX_BASE64) {
      createSecureContext({
        pfx: Buffer.from(process.env.VERIFACTU_PFX_BASE64, "base64"),
        passphrase: process.env.VERIFACTU_PFX_PASSWORD || "",
      });
      cert = true;
    }
  } catch {}
  const checks = [
    { label: "Certificado PFX y contraseña del servidor", ok: cert },
    {
      label: "Clave privada de servicio de Supabase",
      ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    {
      label: "Nombre y NIF del productor del software",
      ok:
        !!process.env.VERIFACTU_PRODUCER_NAME &&
        !!process.env.VERIFACTU_PRODUCER_NIF,
    },
    {
      label: "Declaración responsable del productor",
      ok: !!process.env.VERIFACTU_DECLARATION_URL,
    },
    {
      label: "Servidor siempre activo",
      ok: process.env.VERIFACTU_ALWAYS_ON === "true",
    },
    {
      label: "Validación externa y habilitación de producción",
      ok: process.env.VERIFACTU_PRODUCTION_APPROVED === "true",
    },
  ];
  return {
    checks,
    testReady: checks.slice(0, 3).every((c) => c.ok),
    productionReady: checks.every((c) => c.ok),
  };
}
export function producer(): Producer {
  return {
    name: process.env.VERIFACTU_PRODUCER_NAME!,
    nif: process.env.VERIFACTU_PRODUCER_NIF!,
    installation: process.env.VERIFACTU_INSTALLATION || "ROBOTICLAB-01",
  };
}
export function service() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error(
      "Configure SUPABASE_SERVICE_ROLE_KEY en el servidor para usar VeriFactu",
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function processQueue() {
  const db = service();
  const { data: settings, error: se } = await db
    .from("rl_settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (se) throw se;
  if (!settings.verifactu_enabled) return { processed: 0 };
  const env = settings.verifactu_environment as "test" | "production";
  const ready = readiness();
  if (!(env === "test" ? ready.testReady : ready.productionReady))
    throw new Error(
      "El servidor no está preparado para remitir en este entorno",
    );
  const { data: records, error: re } = await db
    .from("rl_fiscal_records")
    .select("id")
    .eq("environment", env)
    .in("status", ["pending", "uncertain", "sending"])
    .lte("next_attempt", new Date().toISOString())
    .order("seq")
    .limit(1);
  if (re) throw re;
  if (!records?.length) return { processed: 0 };
  const { data: claimed, error: ce } = await db.rpc("rl_claim_fiscal", {
    record_id: records[0].id,
  });
  if (ce) return { processed: 0, waiting: true };
  const rec = claimed as FiscalRecord & {
    payload: FiscalRecord["payload"] & { system: Producer };
  };
  let response = "",
    result: { status: string; csv: string | null; wait: number } = {
      status: "uncertain",
      csv: null,
      wait: 60,
    };
  try {
    let rectified: Invoice | undefined;
    if (rec.payload.invoice.rectifies) {
      const { data: origin, error } = await db
        .from("rl_invoices")
        .select("*")
        .eq("id", rec.payload.invoice.rectifies)
        .single();
      if (error) throw error;
      rectified = origin;
    }
    const xml = buildFiscalXml(rec, rec.payload.system, rectified);
    response = await sendAeat(
      env,
      xml,
      process.env.VERIFACTU_PFX_BASE64!,
      process.env.VERIFACTU_PFX_PASSWORD || "",
    );
    result = parseAeatResponse(response);
  } catch (e) {
    response = response || String((e as Error).message);
  }
  const { error: fe } = await db.rpc("rl_finish_fiscal", {
    p: { id: rec.id, lease_id: rec.lease_id, ...result, response },
  });
  if (fe) throw fe;
  return { processed: 1, status: result.status };
}
