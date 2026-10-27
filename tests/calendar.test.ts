import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  calendarDays,
  eventHours,
  mapEmbedUrl,
  shiftMonth,
  validateEvent,
} from "../src/lib/calendar";
import type { CalendarEvent } from "../src/lib/types";

const sample = (): CalendarEvent => ({
  id: randomUUID(),
  version: 0,
  title: "Taller de robótica",
  client_id: randomUUID(),
  date: "2026-10-27",
  start_time: "10:30",
  end_time: "12:00",
  location: "Calle Mayor 10, Madrid",
  map_url: "",
  price: 120.5,
  participants: 12,
  participant_names: "Grupo A",
  category: "workshop",
  status: "confirmed",
  notes: "Traer material",
});

test("calendario: semanas de lunes a domingo, cambio de año y año bisiesto", () => {
  assert.equal(calendarDays("2026-11")[0], "2026-10-26");
  assert.equal(calendarDays("2026-11")[41], "2026-12-06");
  assert.equal(
    calendarDays("2024-02").filter((d) => d.startsWith("2024-02")).length,
    29,
  );
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(eventHours(sample()), 1.5);
  assert.equal(validateEvent(sample()), "");
  for (const change of [
    { date: "2026-02-30" },
    { end_time: "10:00" },
    { start_time: "29:00" },
    { price: -1 },
    { price: NaN },
    { participants: 1.5 },
    { participants: -1 },
  ])
    assert.notEqual(validateEvent({ ...sample(), ...change }), "");
});

test("mapas: acepta iframe de Maps sin ejecutar HTML y rechaza orígenes ajenos", () => {
  assert.equal(
    mapEmbedUrl(
      '<iframe src="https://www.google.com/maps/embed?pb=test&amp;z=12" onload="alert(1)"></iframe>',
    ),
    "https://www.google.com/maps/embed?pb=test&z=12",
  );
  assert.equal(
    mapEmbedUrl("", "Madrid & Sol"),
    "https://www.google.com/maps?q=Madrid%20%26%20Sol&output=embed",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://www.google.com.evil.test/maps/embed",
    "https://evil.test/maps/embed",
    "https://www.google.com@evil.test/maps/embed",
    "https://www.google.com/search?q=x",
    '<iframe src="data:text/html,test"></iframe>',
  ])
    assert.equal(mapEmbedUrl(url), null);
});

test("eventos SQL: migración repetible, persistencia, validación, conflictos, auditoría y permisos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    await db.exec(
      (await readFile("scripts/schema.template", "utf8")) + "\ncommit;",
    );
    const migration = await readFile("migrations/033_calendario.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const admin = randomUUID(),
      viewer = randomUUID(),
      staff = randomUUID(),
      outsider = randomUUID(),
      event = sample();
    await db.query(
      "insert into auth.users values($1,'admin@test.local',now()),($2,'viewer@test.local',now()),($3,'staff@test.local',now()),($4,'outsider@test.local',now())",
      [admin, viewer, staff, outsider],
    );
    await db.exec(
      "insert into rl_members values('admin@test.local','admin'),('viewer@test.local','viewer'),('staff@test.local','staff')",
    );
    await db.query(
      "insert into rl_clients(id,name) values($1,'Cliente de prueba')",
      [event.client_id],
    );
    async function role(id: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    }
    const save = (value: unknown) =>
      db.query("select rl_save_event($1::jsonb)", [JSON.stringify(value)]);
    const get = async () =>
      (
        await db.query<CalendarEvent>("select * from rl_events where id=$1", [
          event.id,
        ])
      ).rows[0];
    await role(admin);
    await save(event);
    assert.equal((await get()).version, 1);
    assert.equal((await get()).participant_names, "Grupo A");
    await assert.rejects(() => save(event), /Otro usuario/);
    for (const invalid of [
      { end_time: "09:00" },
      { price: -10 },
      { participants: -1 },
      { title: " " },
      { category: "fake" },
      { map_url: "https://evil.test/maps/embed" },
      { client_id: randomUUID() },
    ])
      await assert.rejects(() => save({ ...event, version: 1, ...invalid }));
    assert.equal((await get()).version, 1);
    await role(staff);
    await save({
      ...event,
      version: 1,
      title: "Actualizado",
      status: "cancelled",
    });
    assert.equal((await get()).version, 2);
    await assert.rejects(
      () => db.query("select rl_delete_event($1,1)", [event.id]),
      /ha cambiado/,
    );
    await role(viewer);
    assert.equal((await get()).title, "Actualizado");
    await assert.rejects(
      () => save({ ...event, version: 2 }),
      /Acceso denegado/,
    );
    await assert.rejects(
      () => db.query("select rl_delete_event($1,2)", [event.id]),
      /Acceso denegado/,
    );
    await assert.rejects(
      () => db.exec("delete from rl_events"),
      /permission denied/,
    );
    await role(outsider);
    assert.equal((await db.query("select * from rl_events")).rows.length, 0);
    await assert.rejects(() => save(event), /Acceso denegado/);
    await db.exec("reset role; set role anon");
    await assert.rejects(
      () => db.exec("select * from rl_events"),
      /permission denied/,
    );
    await assert.rejects(() => save(event), /permission denied/);
    await role(admin);
    await db.query("select rl_delete_event($1,2)", [event.id]);
    assert.equal(await get(), undefined);
    await assert.rejects(() => save({ ...event, version: 2 }), /ya no existe/);
    const audit = await db.query<{ action: string }>(
      "select action from rl_audit where entity='rl_events' order by id",
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action),
      ["INSERT", "UPDATE", "DELETE"],
    );
  } finally {
    await db.close();
  }
});
