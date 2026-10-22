import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("presupuestos: numeración propia, validación, estados, conversión atómica e idempotente y permisos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on all functions in schema auth to anon,authenticated,service_role;`);
    await db.exec(
      (await readFile("scripts/schema.template", "utf8")) + "\ncommit;",
    );
    await db.exec(
      await readFile("migrations/031_estabilidad_facturas.sql", "utf8"),
    );
    const migration = await readFile("migrations/032_presupuestos.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const admin = randomUUID(),
      viewer = randomUUID(),
      unknown = randomUUID(),
      client = randomUUID();
    await db.query(
      "insert into auth.users values($1,'admin@example.test',now()),($2,'viewer@example.test',now()),($3,'unknown@example.test',now())",
      [admin, viewer, unknown],
    );
    await db.exec(`insert into rl_members values('admin@example.test','admin'),('viewer@example.test','viewer');
      insert into rl_settings(id,company) values(1,'{"name":"Academia ficticia","tax_id":"12345678Z"}');`);
    await db.query(
      "insert into rl_clients(id,name,tax_id) values($1,'Cliente ficticio','12345678Z')",
      [client],
    );
    const one = async (sql: string, args: unknown[] = []) =>
      (await db.query<Record<string, any>>(sql, args)).rows[0];
    const role = async (id: string, name = "authenticated") => {
      await db.exec("reset role");
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
        [id, name],
      );
      await db.exec(`set role ${name}`);
    };
    await role(admin);
    const form = {
      id: randomUUID(),
      version: 0,
      client_id: client,
      date: "2026-01-01",
      valid_until: "",
      project_date: "2026-01-10",
      location: "Madrid",
      withholding_rate: 15,
      exemption: "Actividad exenta",
      notes: "Propuesta de robótica",
      payment_terms: "Transferencia a 30 días",
      // Supplied totals, numbering, state and invoice links must never be trusted.
      total: 1,
      number: "F-FAKE",
      status: "converted",
      invoice_id: randomUUID(),
      lines: [
        {
          description: "Taller",
          quantity: 3,
          unit: "horas",
          price: 19.99,
          discount: 10,
          vat_rate: 21,
          base: 1,
          historical_amount: true,
        },
        {
          description: "Material",
          quantity: 1,
          price: 12,
          discount: 0,
          vat_rate: 0,
        },
      ],
    };
    const save = (p: unknown) =>
      one("select rl_save_quote($1::jsonb) id", [JSON.stringify(p)]);
    const get = (id = form.id) =>
      one("select * from rl_quotes where id=$1", [id]);
    const state = (q: Record<string, any>, value: string) =>
      db.query("select rl_set_quote_status($1,$2,$3)", [
        q.id,
        q.version,
        value,
      ]);
    const convert = (q: Record<string, any>) =>
      one("select rl_convert_quote($1,$2) id", [q.id, q.version]);
    await save(form);
    let q = await get();
    assert.equal(q.number, "P-2026-0001");
    assert.equal(q.status, "draft");
    assert.equal(q.invoice_id, null);
    assert.equal(q.subtotal, "65.97");
    assert.equal(q.vat, "11.33");
    assert.equal(q.withholding, "9.90");
    assert.equal(q.total, "67.40");
    assert.equal(q.lines[0].historical_amount, false);
    assert.equal((await one("select count(*)::int n from rl_invoices")).n, 0);
    await assert.rejects(() => save(form), /ha cambiado|ya se guardó/);
    for (const patch of [
      { lines: [] },
      { lines: null },
      { withholding_rate: "NaN" },
      { valid_until: "2025-12-31" },
      { lines: [{ ...form.lines[0], price: -1 }] },
      { lines: [{ ...form.lines[0], quantity: "Infinity" }] },
    ]) {
      await assert.rejects(() =>
        save({ ...form, version: q.version, ...patch }),
      );
    }
    await state(q, "sent");
    await assert.rejects(() => state(q, "accepted"), /ha cambiado/);
    q = await get();
    await assert.rejects(() => state(q, "converted"), /Estado/);
    await assert.rejects(() => convert({ ...q, version: 0 }), /ha cambiado/);
    await state(q, "accepted");
    q = await get();
    await save({ ...form, version: q.version, notes: "Revisión" });
    q = await get();
    assert.equal(q.status, "draft");
    assert.equal(q.number, "P-2026-0001");
    await state(q, "accepted");
    q = await get();
    // Changing contacts after acceptance must not rewrite the accepted snapshots.
    await db.query(
      "update rl_clients set name='Cliente actualizado' where id=$1",
      [client],
    );
    const converted = await convert(q);
    assert.equal((await convert(q)).id, converted.id);
    const i = await one("select * from rl_invoices where id=$1", [
      converted.id,
    ]);
    assert.equal(i.status, "draft");
    assert.equal(i.number, null);
    assert.equal(
      i.date.toISOString().slice(0, 10),
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    assert.equal(i.due_date, null);
    assert.deepEqual(i.lines, q.lines);
    assert.deepEqual(i.client_snapshot, q.client_snapshot);
    assert.deepEqual(i.issuer_snapshot, q.issuer_snapshot);
    for (const field of [
      "subtotal",
      "vat",
      "withholding_rate",
      "withholding",
      "total",
      "project_date",
      "location",
      "payment_terms",
      "exemption",
    ]) {
      assert.deepEqual(i[field], q[field], field);
    }
    assert.match(i.notes, /Revisión\nPresupuesto origen: P-2026-0001/);
    assert.equal((await get()).invoice_id, i.id);
    assert.equal((await get()).status, "converted");
    await assert.rejects(
      async () => save({ ...form, version: (await get()).version }),
      /convertido/,
    );
    await assert.rejects(async () => state(await get(), "draft"), /convertido/);
    assert.equal((await one("select count(*)::int n from rl_invoices")).n, 1);
    assert.equal(
      (await one("select count(*)::int n from rl_fiscal_records")).n,
      0,
    );
    assert.equal((await one("select count(*)::int n from rl_payments")).n, 0);
    const invoiceNumber = (await one("select rl_issue_invoice($1) n", [i.id]))
      .n;
    assert.match(invoiceNumber, /^F-\d{4}-0001$/);

    const second = { ...form, id: randomUUID(), status: "draft" };
    await save(second);
    const next = await get(second.id);
    assert.equal(next.number, "P-2026-0002");
    await state(next, "rejected");
    await assert.rejects(
      () => convert({ ...next, version: next.version + 1 }),
      /rechazado/,
    );
    const stale = { ...form, id: randomUUID(), valid_until: "2026-01-02" };
    await save(stale);
    const expired = await get(stale.id);
    await assert.rejects(() => convert(expired), /caducado/);
    await assert.rejects(() => state(expired, "accepted"), /caducado/);
    assert.ok(
      (
        await one(
          "select count(*)::int n from rl_audit where entity='rl_quotes'",
        )
      ).n >= 8,
    );

    await role(viewer);
    assert.equal((await one("select count(*)::int n from rl_quotes")).n, 3);
    await assert.rejects(
      () => save({ ...form, id: randomUUID() }),
      /Acceso denegado/,
    );
    await assert.rejects(() => convert(q), /Acceso denegado/);
    await assert.rejects(() => state(next, "accepted"), /Acceso denegado/);
    await assert.rejects(
      () =>
        db.query("update rl_quotes set status='draft' where id=$1", [form.id]),
      /permission denied/,
    );
    await role(unknown);
    assert.equal((await one("select count(*)::int n from rl_quotes")).n, 0);
    await role("", "anon");
    await assert.rejects(() => save(form), /permission denied/);
    await assert.rejects(
      () => db.query("select * from rl_quotes"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
