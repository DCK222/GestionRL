import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
async function main() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,email text unique,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,confirmation_token text,recovery_token text,email_change_token_new text,email_change text);
create table auth.identities(id uuid primary key,provider_id text,user_id uuid,identity_data jsonb,provider text,last_sign_in_at timestamptz,created_at timestamptz,updated_at timestamptz,unique(provider_id,provider));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
grant usage on schema auth,public to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`);
    await db.exec(
      await fs.readFile("deliverables/supabase-roboticlab.sql", "utf8"),
    );
    const migration = await fs.readFile(
      "migrations/030_clientes_y_hoja.sql",
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const admin = (
      await db.query<{ id: string }>(
        "select id from auth.users where email='admin@roboticlab.internal'",
      )
    ).rows[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    // A legacy invoice can have only a snapshot and no linked client.
    await db.exec(`insert into rl_invoices(client_snapshot,issuer_snapshot,date,lines,subtotal,vat,withholding,total,status)
 values('{"name":"Cliente recuperado de prueba","tax_id":"B-123 456","address":"Dirección histórica"}','{}','2026-01-01','[]',0,0,0,0,'imported');
 set role authenticated;`);
    assert.equal(
      (await db.query<{ n: number }>("select rl_sync_invoice_clients() n"))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await db.query<{ n: number }>("select rl_sync_invoice_clients() n"))
        .rows[0].n,
      0,
    );
    await db.exec(
      "update rl_clients set address='Dirección actual' where name='Cliente recuperado de prueba'",
    );
    await db.exec("select rl_sync_invoice_clients()");
    assert.equal(
      (
        await db.query<{ address: string }>(
          "select address from rl_clients where name='Cliente recuperado de prueba'",
        )
      ).rows[0].address,
      "Dirección actual",
    );
    const rows = (
      await db.query<Record<string, unknown>>(
        "select * from rl_enrollments order by id limit 2",
      )
    ).rows;
    const updates = rows.map((r, i) => ({ ...r, notes: `Hoja ${i}` }));
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select rl_save_enrollments($1::jsonb) n",
          [JSON.stringify(updates)],
        )
      ).rows[0].n,
      2,
    );
    const saved = (
      await db.query<Record<string, unknown>>(
        "select * from rl_enrollments order by id limit 2",
      )
    ).rows;
    await assert.rejects(
      () =>
        db.query("select rl_save_enrollments($1::jsonb)", [
          JSON.stringify([
            { ...saved[0], notes: "NO guardar" },
            { ...saved[1], version: 0, notes: "Conflicto" },
          ]),
        ]),
      /Otro usuario/,
    );
    assert.equal(
      (
        await db.query<{ notes: string }>(
          "select notes from rl_enrollments where id=$1",
          [saved[0].id],
        )
      ).rows[0].notes,
      "Hoja 0",
    );
    await assert.rejects(
      () =>
        db.query("select rl_save_enrollments($1::jsonb)", [
          JSON.stringify([saved[0], saved[0]]),
        ]),
      /duplicadas/,
    );
    await db.exec(
      "reset role;update rl_members set role='viewer' where email='admin@roboticlab.internal';set role authenticated;",
    );
    await assert.rejects(
      () =>
        db.query("select rl_save_enrollments($1::jsonb)", [
          JSON.stringify(saved),
        ]),
      /Acceso denegado/,
    );
    await assert.rejects(
      () => db.query("select rl_sync_invoice_clients()"),
      /Acceso denegado/,
    );
    await db.exec("reset role;set role anon;");
    await assert.rejects(
      () => db.query("select rl_sync_invoice_clients()"),
      /permission denied/,
    );
    console.log(
      "PASS: migration repeatable; client recovery without duplicates/overwrites; atomic sheet edits, version conflicts and permissions.",
    );
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
