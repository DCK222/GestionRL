import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
async function main() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,email text unique,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,confirmation_token text,recovery_token text,email_change_token_new text,email_change text);
 create table auth.identities(id uuid primary key,provider_id text,user_id uuid,identity_data jsonb,provider text,last_sign_in_at timestamptz,created_at timestamptz,updated_at timestamptz,unique(provider_id,provider));
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`);
  const sql = await fs.readFile("deliverables/supabase-roboticlab.sql", "utf8");
  await db.exec(sql);
  console.log("PASS: SQL completo ejecutado");
  const one = async (q: string, args: unknown[] = []) =>
    ((await db.query(q, args)).rows as Record<string, any>[])[0];
  assert.equal((await one("select count(*)::int n from rl_invoices")).n, 20);
  assert.equal(
    (await one("select sum(total)::numeric total from rl_invoices")).total,
    "5086.50",
  );
  assert.equal((await one("select count(*)::int n from rl_sheets")).n, 61);
  assert.equal(
    (await one("select count(*)::int n from rl_enrollments")).n,
    2209,
  );
  assert.equal((await one("select count(*)::int n from rl_documents")).n, 21);
  await db.exec(sql);
  assert.equal((await one("select count(*)::int n from rl_invoices")).n, 20);
  console.log("PASS: importación conciliada e idempotente");
  const admin = (
    await one(
      "select id from auth.users where email='admin@roboticlab.internal'",
    )
  ).id;
  async function role(uid: string | null, role = "authenticated") {
    await db.exec("reset role");
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
      [uid || "", role],
    );
    await db.exec(`set role ${role}`);
  }
  async function fails(fn: () => Promise<unknown>, pattern: RegExp) {
    await assert.rejects(fn, pattern);
  }
  await role(null, "anon");
  await fails(() => db.query("select * from rl_clients"), /permission denied/);
  const unknown = randomUUID();
  await role(unknown);
  assert.equal((await one("select count(*)::int n from rl_clients")).n, 0);
  await fails(
    () => db.query("select rl_clone_month('2026-10','2026-11')"),
    /Acceso denegado/,
  );
  console.log("PASS: anónimos y usuarios no autorizados sin acceso");
  await role(admin);
  const client = (await one("select id from rl_clients limit 1")).id;
  const draft = {
    client_id: client,
    date: "2026-10-01",
    lines: [
      {
        description: "Clase de prueba",
        quantity: 3,
        price: 19.99,
        discount: 10,
        vat_rate: 21,
      },
    ],
    withholding_rate: 15,
    invoice_type: "F1",
    exemption: "",
    environment: "production",
  };
  const id = (
    await one("select rl_save_invoice($1::jsonb) id", [JSON.stringify(draft)])
  ).id;
  const inv = await one("select * from rl_invoices where id=$1", [id]);
  assert.equal(inv.subtotal, "53.97");
  assert.equal(inv.vat, "11.33");
  assert.equal(inv.total, "57.20");
  const num = (await one("select rl_issue_invoice($1) n", [id])).n;
  assert.equal(num, "F-2026-1021");
  assert.equal((await one("select rl_issue_invoice($1) n", [id])).n, num);
  await fails(
    () =>
      db.query("select rl_save_invoice($1::jsonb)", [
        JSON.stringify({ ...draft, id }),
      ]),
    /ya está emitida/,
  );
  await fails(
    () => db.query("update rl_invoices set total=1 where id=$1", [id]),
    /permission denied/,
  );
  console.log("PASS: importes redondeados, numeración y bloqueo de facturas");
  const p = {
    id: randomUUID(),
    date: "2026-10-01",
    amount: 20,
    method: "Transferencia",
    description: "Pago parcial",
    invoice_id: id,
  };
  await db.query("select rl_record_payment($1::jsonb)", [JSON.stringify(p)]);
  await db.query("select rl_record_payment($1::jsonb)", [JSON.stringify(p)]);
  assert.equal(
    (
      await one("select sum(amount) s from rl_payments where invoice_id=$1", [
        id,
      ])
    ).s,
    "20.00",
  );
  await fails(
    () =>
      db.query("select rl_record_payment($1::jsonb)", [
        JSON.stringify({ ...p, id: randomUUID(), amount: 100 }),
      ]),
    /supera el saldo/,
  );
  console.log("PASS: cobro parcial, idempotencia y límite de saldo");
  const enrollment = await one(
    "select * from rl_enrollments where period='2026-10' and billing_mode='hourly' limit 1",
  );
  const h = {
    enrollment_id: enrollment.id,
    date: "2026-10-02",
    units: 1.5,
    kind: "class",
    note: "Sesión de prueba",
    request_id: randomUUID(),
  };
  await db.query("select rl_log_hours($1::jsonb)", [JSON.stringify(h)]);
  await db.query("select rl_log_hours($1::jsonb)", [JSON.stringify(h)]);
  const updated = await one("select * from rl_enrollments where id=$1", [
    enrollment.id,
  ]);
  assert.equal(
    Number(updated.month_hours),
    Number(enrollment.month_hours) + 1.5,
  );
  assert.equal(
    Number(updated.expected),
    Number(enrollment.expected) + 1.5 * Number(enrollment.rate),
  );
  await fails(
    () =>
      db.query("select rl_save_enrollment($1::jsonb)", [
        JSON.stringify(enrollment),
      ]),
    /Otro usuario/,
  );
  await fails(
    () =>
      db.query("select rl_log_hours($1::jsonb)", [
        JSON.stringify({ ...h, request_id: randomUUID(), date: "2026-11-01" }),
      ]),
    /fecha debe pertenecer/,
  );
  console.log(
    "PASS: horas, cargos automáticos, idempotencia y control de edición simultánea",
  );
  await fails(
    () => db.query("select rl_set_verifactu(true,'production')"),
    /permission denied/,
  );
  await role(null, "service_role");
  await db.query("select rl_set_verifactu(true,'test')");
  await role(admin);
  const testId = (
    await one("select rl_save_invoice($1::jsonb) id", [
      JSON.stringify({ ...draft, environment: "test" }),
    ])
  ).id;
  await db.query("select rl_issue_invoice($1)", [testId]);
  const fr = await one("select * from rl_fiscal_records where invoice_id=$1", [
    testId,
  ]);
  assert.equal(
    fr.hash,
    createHash("sha256").update(fr.hash_input).digest("hex").toUpperCase(),
  );
  assert.equal(fr.previous_hash, "");
  const testId2 = (
    await one("select rl_save_invoice($1::jsonb) id", [
      JSON.stringify({ ...draft, environment: "test" }),
    ])
  ).id;
  await db.query("select rl_issue_invoice($1)", [testId2]);
  const fr2 = await one("select * from rl_fiscal_records where invoice_id=$1", [
    testId2,
  ]);
  assert.equal(fr2.previous_hash, fr.hash);
  await role(null, "service_role");
  await fails(
    () => db.query("select rl_claim_fiscal($1)", [fr2.id]),
    /registros anteriores/,
  );
  const claim = (await one("select rl_claim_fiscal($1) r", [fr.id])).r;
  await fails(() => db.query("select rl_claim_fiscal($1)", [fr.id]), /Espere/);
  await db.query("select rl_finish_fiscal($1::jsonb)", [
    JSON.stringify({
      id: fr.id,
      lease_id: claim.lease_id,
      status: "accepted",
      response: "Test local",
      csv: "TEST",
      wait: 60,
    }),
  ]);
  console.log(
    "PASS: entornos separados, cadena SHA-256, acceso de servidor y exclusión de reenvíos concurrentes",
  );
  await db.exec("reset role");
  await fails(
    () =>
      db.query("update rl_fiscal_records set hash=$1 where id=$2", [
        "tamper",
        fr.id,
      ]),
    /inalterable/,
  );
  await fails(
    () => db.query("delete from rl_invoices where id=$1", [id]),
    /inalterable/,
  );
  const viewer = randomUUID();
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'viewer@example.test',now())",
    [viewer],
  );
  await db.query(
    "insert into rl_members values('viewer@example.test','viewer')",
  );
  await role(viewer);
  assert.equal((await one("select count(*)::int n from rl_clients")).n, 7);
  await fails(
    () => db.query("insert into rl_clients(name) values('No permitido')"),
    /row-level security/,
  );
  await fails(
    () =>
      db.query("select rl_save_invoice($1::jsonb)", [JSON.stringify(draft)]),
    /Acceso denegado/,
  );
  console.log("PASS: usuario de solo lectura no modifica datos");
  await db.exec("reset role");
  assert.ok((await one("select count(*)::int n from rl_audit")).n > 0);
  await fs.mkdir("private-import/test-results", { recursive: true });
  await fs.writeFile(
    "private-import/test-results/database.json",
    JSON.stringify(
      { status: "passed", at: new Date().toISOString(), checks: 18 },
      null,
      2,
    ),
  );
  await db.close();
  console.log("Todas las comprobaciones de base de datos superadas.");
}
main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
