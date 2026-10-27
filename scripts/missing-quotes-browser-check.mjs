// Run scripts/local-fixture.mjs first. All failures are simulated on loopback.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let failure = "missing";
  await page.route("http://127.0.0.1:4545/rest/v1/rl_quotes?*", async (route) => {
    if (!failure) return route.continue();
    return route.fulfill({ status: failure === "missing" ? 404 : 403, contentType: "application/json", body: JSON.stringify(failure === "missing" ? { code: "PGRST205", message: "Could not find the table 'public.rl_quotes' in the schema cache" } : { code: "42501", message: "permission denied for table rl_quotes" }) });
  });
  await page.goto("http://127.0.0.1:3101");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-fixture-password");
  await page.getByRole("button", { name: "Entrar a Roboticlab" }).click();
  await page.getByRole("button", { name: "Facturación", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nueva factura", exact: true })).toBeVisible();
  await expect(page.getByText("No se han podido cargar los datos", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Presupuestos · pendiente de activar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Presupuestos pendientes de activar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo presupuesto", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Calendario", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nuevo evento", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "Copias de datos", exact: true }).click();
  await expect(page.getByText(/Activa los presupuestos con/)).toBeVisible();
  // Applying the missing migration must recover without signing out.
  failure = "";
  await page.getByRole("button", { name: "Facturación", exact: true }).click();
  await page.getByRole("button", { name: "Presupuestos · pendiente de activar", exact: true }).click();
  await page.getByRole("button", { name: "Comprobar de nuevo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nuevo presupuesto", exact: true }).first()).toBeVisible();
  // Other errors must not silently turn existing budgets into an empty list.
  failure = "permissions";
  await page.getByRole("button", { name: "Actualizar datos", exact: true }).click();
  await expect(page.getByText("permission denied for table rl_quotes", { exact: true })).toBeVisible();
  failure = "";
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("No se han podido cargar los datos", { exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("PASS: missing budgets do not block invoices/calendar; activation notice and recovery work; permission errors remain visible; incomplete backup is identified.");
} finally { await browser.close(); }
