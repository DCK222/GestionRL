import { chromium } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,email text unique,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,confirmation_token text,recovery_token text,email_change_token_new text,email_change text);
create table auth.identities(id uuid primary key,provider_id text,user_id uuid,identity_data jsonb,provider text,last_sign_in_at timestamptz,created_at timestamptz,updated_at timestamptz,unique(provider_id,provider));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
grant usage on schema auth,public to authenticated;grant execute on all functions in schema auth to authenticated;`);
await db.exec(
  await fs.readFile("deliverables/supabase-roboticlab.sql", "utf8"),
);
await db.exec(await fs.readFile("migrations/030_clientes_y_hoja.sql", "utf8"));
const admin = (
  await db.query(
    "select id from auth.users where email='admin@roboticlab.internal'",
  )
).rows[0].id;
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
await db.exec("set role authenticated");
const out = "private-import/test-results";
const baseURL = process.env.ROBOTICLAB_TEST_URL || "http://localhost:3000";
assert.equal((await fetch(`${baseURL}/api/verifactu`)).status, 401);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  locale: "es-ES",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const numberKeys = new Set([
  "rate",
  "units",
  "month_hours",
  "pack_units",
  "paid",
  "advance",
  "expected",
  "amount",
  "subtotal",
  "vat",
  "withholding_rate",
  "withholding",
  "total",
]);
const numbers = (o) =>
  o instanceof Date
    ? o.toISOString().slice(0, 10)
    : Array.isArray(o)
      ? o.map(numbers)
      : o && typeof o === "object"
        ? Object.fromEntries(
            Object.entries(o).map(([k, v]) => [
              k,
              numberKeys.has(k) &&
              v !== null &&
              typeof v === "string" &&
              !isNaN(Number(v))
                ? Number(v)
                : numbers(v),
            ]),
          )
        : o;
await page.route(
  "https://qbiqnlhzdovdrglihttg.supabase.co/**",
  async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    const fulfill = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(numbers(body)),
      });
    if (req.method() === "OPTIONS") return fulfill({});
    if (u.pathname === "/auth/v1/token") {
      return fulfill({
        access_token: "local-test-only",
        refresh_token: "local-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: admin,
          aud: "authenticated",
          role: "authenticated",
          email: "admin@roboticlab.internal",
          email_confirmed_at: new Date().toISOString(),
          app_metadata: { provider: "email" },
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      });
    }
    if (u.pathname === "/auth/v1/logout") return fulfill({});
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      try {
        const name = u.pathname.split("/").at(-1);
        if (!/^rl_[a-z_]+$/.test(name)) throw Error("Invalid RPC");
        const args = req.postDataJSON() || {};
        const vals = Object.values(args).map((x) =>
          typeof x === "object" ? JSON.stringify(x) : x,
        );
        const names = Object.keys(args).map((k, i) => `${k} => $${i + 1}`);
        const res = await db.query(
          `select ${name}(${names.join(",")}) result`,
          vals,
        );
        return fulfill(res.rows[0].result);
      } catch (e) {
        return fulfill({ message: e.message }, 400);
      }
    }
    const table = u.pathname.split("/").at(-1);
    if (!/^rl_[a-z_]+$/.test(table))
      return fulfill({ message: "unknown" }, 404);
    try {
      const args = [],
        conditions = [];
      for (const [k, v] of u.searchParams) {
        if (v.startsWith("eq.") && /^[a-z_]+$/.test(k)) {
          args.push(v.slice(3));
          conditions.push(`${k}=$${args.length}`);
        }
      }
      if (req.method() === "POST") {
        const p = req.postDataJSON();
        const keys = Object.keys(p);
        await db.query(
          `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          Object.values(p),
        );
        return fulfill(null, 201);
      }
      if (req.method() === "PATCH") {
        const p = req.postDataJSON();
        const where = conditions.join(" and ");
        await db.query(
          `update ${table} set ${Object.keys(p)
            .map((k, i) => `${k}=$${args.length + i + 1}`)
            .join(",")} where ${where}`,
          [...args, ...Object.values(p)],
        );
        return fulfill(null);
      }
      const selection = u.searchParams.get("select") || "*";
      if (!/^[a-z_0-9,*]+$/.test(selection)) throw Error("Invalid selection");
      let q = `select ${selection} from ${table}${conditions.length ? " where " + conditions.join(" and ") : ""}`;
      const order = u.searchParams.get("order");
      if (order) {
        const [key, dir] = order.split(".");
        q += ` order by ${key} ${dir === "desc" ? "desc" : "asc"}`;
      }
      if (u.searchParams.has("limit"))
        q += " limit " + Number(u.searchParams.get("limit"));
      if (u.searchParams.has("offset"))
        q += " offset " + Number(u.searchParams.get("offset"));
      const result = await db.query(q, args);
      return fulfill(
        req.headers().accept?.includes("vnd.pgrst.object")
          ? result.rows[0]
          : result.rows,
      );
    } catch (e) {
      return fulfill({ message: e.message }, 400);
    }
  },
);
await page.route("**/api/verifactu", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      checks: [{ label: "Certificado de pruebas", ok: false }],
      testReady: false,
      productionReady: false,
    }),
  }),
);
try {
  await page.goto(baseURL);
  await page.getByRole("heading", { name: "Bienvenido de nuevo" }).waitFor();
  await page.screenshot({
    path: out + "/login.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("local-only-test-password");
  await page.getByRole("button", { name: "Entrar a Roboticlab" }).click();
  await page.getByRole("heading", { name: "Todo empieza aquí" }).waitFor();
  await page.screenshot({
    path: out + "/dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
    false,
  );
  console.log("PASS login and dashboard");
  await page.getByRole("button", { name: "Facturación", exact: true }).click();
  await page.getByRole("heading", { name: "Tus facturas, en orden" }).waitFor();
  const monteClient = (
    await db.query("select id from rl_clients where name='Monte Platino S.L.'")
  ).rows[0].id;
  await page
    .getByLabel("Cliente de factura", { exact: true })
    .selectOption(monteClient);
  const monteCount = Number(
    (
      await db.query("select count(*) n from rl_invoices where client_id=$1", [
        monteClient,
      ])
    ).rows[0].n,
  );
  assert.equal(
    await page.locator("section.panel tbody tr").count(),
    monteCount,
  );
  await page.getByLabel("Buscar facturas", { exact: true }).fill("informatica");
  assert.ok((await page.locator("section.panel tbody tr").count()) > 0);
  await page.getByLabel("Facturas desde", { exact: true }).fill("2026-02-01");
  await page.getByLabel("Facturas hasta", { exact: true }).fill("2026-02-28");
  assert.equal(await page.locator("section.panel tbody tr").count(), 2);
  await page.screenshot({ path: out + "/invoice-filters.png", fullPage: true });
  await page
    .getByRole("button", { name: "Limpiar filtros", exact: true })
    .click();
  assert.equal(await page.locator("section.panel tbody tr").count(), 20);
  console.log("PASS invoice customer, concept and date filters");
  await page
    .getByRole("button", { name: "Nueva factura", exact: true })
    .click();
  // Adding a row must work even while required fields on the first row are empty.
  await page.getByRole("button", { name: "Añadir línea", exact: true }).click();
  assert.equal(await page.locator(".line-editor tbody tr").count(), 2);
  assert.equal(
    await page
      .getByLabel("Descripción 2", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page
    .getByLabel("Descripción 2", { exact: true })
    .fill("Concepto que se eliminará");
  await page
    .getByRole("button", { name: "Añadir otra línea", exact: true })
    .click();
  await page
    .getByLabel("Descripción 3", { exact: true })
    .fill("Taller adicional de robótica");
  await page.getByLabel("Cantidad 3", { exact: true }).fill("3");
  await page.getByLabel("Precio 3", { exact: true }).fill("40");
  await page.getByLabel("Descuento 3", { exact: true }).fill("10");
  await page.getByLabel("IVA 3", { exact: true }).selectOption("21");
  await page
    .getByRole("button", { name: "Eliminar línea 2", exact: true })
    .click();
  assert.equal(await page.locator(".line-editor tbody tr").count(), 2);
  assert.equal(
    await page.getByLabel("Descripción 2", { exact: true }).inputValue(),
    "Taller adicional de robótica",
  );
  await page
    .getByLabel("Descripción 1", { exact: true })
    .fill("Sesión de prueba del navegador");
  await page.getByLabel("Cantidad 1", { exact: true }).fill("2");
  await page.getByLabel("Precio 1", { exact: true }).fill("25");
  await page.getByLabel("Retención IRPF (%)", { exact: true }).fill("15");
  assert.match(
    await page.locator("dialog[open] .invoice-totals .total").innerText(),
    /156,98/,
  );
  await page.screenshot({
    path: out + "/invoice-multiple-lines.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await page
    .getByText("Borrador guardado. Puedes revisarlo antes de emitir.")
    .waitFor();
  await page.getByRole("button", { name: "Borrador", exact: true }).click();
  const draftRow = (
    await db.query(
      "select lines,subtotal,vat,withholding,total from rl_invoices where status='draft'",
    )
  ).rows[0];
  assert.equal(draftRow.lines.length, 2);
  assert.equal(Number(draftRow.subtotal), 158);
  assert.equal(Number(draftRow.vat), 22.68);
  assert.equal(Number(draftRow.withholding), 23.7);
  assert.equal(Number(draftRow.total), 156.98);
  assert.equal(await page.locator(".invoice-lines tbody tr").count(), 2);
  await page
    .getByRole("button", { name: "Editar borrador", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Descripción 2", { exact: true }).inputValue(),
    "Taller adicional de robótica",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Añadir línea", exact: true }).click();
  await page
    .getByLabel("Descripción 3", { exact: true })
    .fill("Concepto móvil");
  assert.equal(await page.locator(".line-editor tbody tr").count(), 3);
  const editorDialog = page
    .locator("dialog[open]")
    .filter({ has: page.locator(".line-editor") });
  assert.equal(
    await editorDialog.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({
    path: out + "/invoice-multiple-lines-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Eliminar línea 3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Editar borrador", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 1440, height: 1080 });
  console.log(
    "PASS multiple invoice lines: add, remove, save, reopen, totals and mobile layout",
  );
  await page.getByRole("button", { name: "Emitir", exact: true }).click();
  await page
    .getByRole("button", { name: "Emitir factura", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "F-2026-1021", exact: true })
    .waitFor();
  assert.ok(
    (
      await db.query(
        "select number from rl_invoices where number='F-2026-1021'",
      )
    ).rows.length === 1,
  );
  console.log("PASS browser draft and atomic invoice issuance");
  await page.screenshot({
    path: out + "/invoice.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: out + "/printed-invoice.pdf",
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.screenshot({
    path: out + "/invoice-print.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page
    .getByRole("button", { name: "Clases e ingresos", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tu academia, al día" }).waitFor();
  await page.screenshot({
    path: out + "/academy.png",
    fullPage: true,
    animations: "disabled",
  });
  const sheet = page.locator(".editable-sheet");
  const cell = (r, c) => sheet.locator(`[data-row="${r}"][data-col="${c}"]`);
  await cell(0, 1).fill("Grupo editado en hoja");
  await cell(0, 1).press("Enter");
  assert.equal(
    await cell(1, 1).evaluate((el) => el === document.activeElement),
    true,
  );
  await cell(0, 11).evaluate((el) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "Lunes\tNota hoja 1\nMartes\tNota hoja 2\n",
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(await cell(1, 12).inputValue(), "Nota hoja 2");
  await cell(0, 3).fill("12,50");
  await cell(0, 4).selectOption("hourly");
  await cell(0, 7).fill("3");
  await cell(0, 8).fill("10");
  await cell(0, 9).fill("5");
  await sheet
    .getByRole("button", { name: /^Recalcular previsto de/ })
    .first()
    .click();
  assert.equal(await cell(0, 10).inputValue(), "22.5");
  assert.equal(
    await page.getByLabel("Mes de clases", { exact: true }).isDisabled(),
    true,
  );
  await page.screenshot({ path: out + "/editable-sheet.png", fullPage: true });
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await page.getByText("2 filas guardadas", { exact: true }).waitFor();
  assert.equal(
    Number(
      (
        await db.query(
          "select expected from rl_enrollments where notes='Nota hoja 1'",
        )
      ).rows[0].expected,
    ),
    22.5,
  );
  assert.equal(
    Number(
      (
        await db.query(
          "select count(*) n from rl_enrollments where notes in ('Nota hoja 1','Nota hoja 2')",
        )
      ).rows[0].n,
    ),
    2,
  );
  await page.getByPlaceholder("Buscar alumno o anotación…").fill("Nota hoja 1");
  assert.equal(await sheet.locator("tbody tr").count(), 1);
  await page.getByPlaceholder("Buscar alumno o anotación…").fill("");
  console.log(
    "PASS editable monthly sheet: keyboard, multi-cell paste, decimal comma, totals and save",
  );
  await page
    .getByRole("button", { name: "Horas de LUCIA", exact: true })
    .click();
  await page
    .getByLabel("Concepto / motivo")
    .fill("Clase registrada desde la prueba");
  await page
    .getByRole("button", { name: "Registrar movimiento", exact: true })
    .click();
  await page.getByText("Movimiento registrado", { exact: true }).waitFor();
  console.log("PASS browser hour ledger");
  await page
    .getByRole("button", { name: "Clientes y alumnos", exact: true })
    .click();
  await page.getByRole("heading", { name: "Personas que conectan" }).waitFor();
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .click();
  await page
    .getByLabel("Nombre completo / razón social")
    .fill("Cliente de prueba local");
  await page.getByLabel("NIF / CIF", { exact: true }).fill("B12345678");
  await page
    .getByRole("button", { name: "Guardar contacto", exact: true })
    .click();
  await page.getByText("Contacto guardado", { exact: true }).waitFor();
  console.log("PASS client form");
  const clientRow = page
    .locator("section.panel tbody tr")
    .filter({ hasText: "Monte Platino S.L." });
  await clientRow.getByRole("button", { name: /facturas →/ }).click();
  await page.getByLabel("Cliente de factura", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Cliente de factura", { exact: true }).inputValue(),
    monteClient,
  );
  assert.equal(
    await page.locator("section.panel tbody tr").count(),
    monteCount,
  );
  console.log(
    "PASS invoice clients in directory and direct filtered invoice navigation",
  );
  await page
    .getByRole("button", { name: "Gestión financiera", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tus números, claros" }).waitFor();
  await page.screenshot({
    path: out + "/finance.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Archivo original", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Tu historia, conservada" })
    .waitFor();
  await page.locator(".original-grid td").first().waitFor();
  assert.equal(
    await page.getByLabel("Hoja original").locator("option").count(),
    61,
  );
  console.log("PASS original workbook archive");
  await page
    .getByRole("button", { name: "Configuración", exact: true })
    .click();
  await page.getByRole("heading", { name: "A tu manera" }).waitFor();
  await page.getByRole("button", { name: "VeriFactu", exact: true }).click();
  await page.getByText("Certificado de pruebas", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Inicio", exact: true }).click();
  await page.getByRole("button", { name: "Cambiar tema", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({
    path: out + "/dashboard-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: out + "/mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
    false,
  );
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await page
    .getByRole("button", { name: "Clases e ingresos", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tu academia, al día" }).waitFor();
  await page.screenshot({
    path: out + "/mobile-academy.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
    false,
  );
  console.log("PASS dark theme and mobile layout");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    out + "/browser.json",
    JSON.stringify({ passed: true, pageErrors: errors }, null, 2),
  );
  console.log(
    "All browser checks passed (local Supabase adapter, no remote writes).",
  );
} catch (e) {
  await page.screenshot({
    path: out + "/failure.png",
    fullPage: true,
    animations: "disabled",
  });
  console.error((await page.locator("body").innerText()).slice(0, 2500));
  console.error(errors);
  throw e;
} finally {
  await browser.close();
  await db.close();
}
