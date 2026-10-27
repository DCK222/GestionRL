import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://qbiqnlhzdovdrglihttg.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_hr25_jZQnPpRMK3ex6U7xQ_JKQuRnbj",
);
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function readAll<T>(table: string, columns = "*"): Promise<T[]> {
  const result: T[] = [];
  let start = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(start, start + 999)
      .abortSignal(AbortSignal.timeout(20000));
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    result.push(...(data as T[]));
    if (data.length < 1000) break;
    start += 1000;
  }
  return result;
}
// Only a missing relation may be treated as an unapplied optional migration.
// Permission, network and other schema errors must still fail the data load.
export async function readOptionalTable<T>(table: string): Promise<T[] | null> {
  try {
    return await readAll<T>(table);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "PGRST205") return null;
    throw error;
  }
}
export async function api(path: string, body?: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("La sesión ha caducado");
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await res.json();
  if (!res.ok)
    throw new Error(result.error || "No se pudo completar la operación");
  return result;
}
