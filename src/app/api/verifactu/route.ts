import { createClient } from "@supabase/supabase-js";
import {
  readiness,
  service,
  processQueue,
  producer,
} from "@/lib/fiscal-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function authorize(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Acceso denegado");
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);
  if (error || !user) throw new Error("Sesión no válida");
  const { data: role, error: roleError } = await client.rpc("rl_role");
  if (roleError || !role) throw new Error("Acceso denegado");
  return role as string;
}
export async function GET(req: Request) {
  try {
    await authorize(req);
    return Response.json(readiness());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 401 });
  }
}
export async function POST(req: Request) {
  try {
    const role = await authorize(req);
    if (!["admin", "staff"].includes(role))
      throw new Error("Solo personal de gestión");
    const payload = await req.json();
    if (payload.action === "configure") {
      if (role !== "admin") throw new Error("Solo administración");
      if (
        typeof payload.enabled !== "boolean" ||
        !["test", "production"].includes(payload.environment)
      )
        throw new Error("Configuración no válida");
      const r = readiness();
      if (
        payload.enabled &&
        !(payload.environment === "test" ? r.testReady : r.productionReady)
      )
        throw new Error(
          "Falta completar la configuración del servidor. Producción requiere validación externa, servicio siempre activo y declaración responsable.",
        );
      const { error } = await service().rpc("rl_set_verifactu", {
        enabled: payload.enabled,
        environment: payload.environment,
        system_data: producer(),
      });
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (payload.action === "process")
      return Response.json(await processQueue());
    throw new Error("Acción no válida");
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
