// Start scripts/local-fixture.mjs first. Only synthetic data on loopback is used.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

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
const out = "test-results/quotes";
await mkdir(out, { recursive: true });
try {
  await page.goto("http://127.0.0.1:3101");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("local-fixture-password");
  await page.getByRole("button", { name: "Entrar a Roboticlab" }).click();
  await page.getByRole("button", { name: "Facturación", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nueva factura", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Presupuestos \(/ }).click();
  await page
    .getByRole("button", { name: "Nuevo presupuesto", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Descripción 1", { exact: true })
    .fill("Taller de robótica");
  await page.getByLabel("Cantidad 1", { exact: true }).fill("3");
  await page.getByLabel("Precio 1", { exact: true }).fill("19.99");
  await page.getByLabel("Descuento 1", { exact: true }).fill("10");
  await page.getByLabel("IVA 1", { exact: true }).selectOption("21");
  await page.getByRole("button", { name: "Añadir línea", exact: true }).click();
  await page.getByLabel("Descripción 2", { exact: true }).fill("Material");
  await page.getByLabel("Precio 2", { exact: true }).fill("12");
  await page.getByLabel("Retención IRPF (%)", { exact: true }).fill("15");
  await page
    .getByLabel("Observaciones del presupuesto")
    .fill("Propuesta para el taller");
  await expect(page.locator(".invoice-totals .total")).toContainText("67,40");
  await page
    .getByRole("button", { name: "Guardar presupuesto", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page
    .locator("section.panel tbody tr")
    .filter({ hasText: "67,40" })
    .first();
  const number = await row.locator("td").first().innerText();
  assert.match(number, /^P-\d{4}-\d{4}$/);
  await page.getByLabel("Buscar presupuestos").fill("robotica");
  await expect(row).toBeVisible();
  await page.getByLabel("Buscar presupuestos").fill("sin coincidencias");
  await expect(page.locator("section.panel tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await row.getByRole("button", { name: "Ver presupuesto →" }).click();
  await expect(page.locator(".invoice-paper h2")).toHaveText(
    `Presupuesto nº ${number}`,
  );
  await expect(page.locator(".invoice-paper .watermark")).toHaveText(
    "PRESUPUESTO · SIN VALIDEZ FISCAL",
  );
  await page.getByRole("button", { name: "Marcar enviado" }).click();
  await expect(page.locator("dialog .alert")).toContainText("Estado: Enviado");
  await page.getByRole("button", { name: "Marcar aceptado" }).click();
  await expect(page.locator("dialog .alert")).toContainText("Estado: Aceptado");
  await page.screenshot({ path: `${out}/presupuesto.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Convertir a factura", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crear borrador de factura", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator(".invoice-paper h2")).toHaveText(
    "Factura nº BORRADOR",
  );
  await expect(page.locator(".invoice-paper .total")).toContainText("67,40");
  await expect(page.locator(".invoice-paper")).toContainText(
    "Taller de robótica",
  );
  await expect(page.locator(".invoice-paper")).toContainText(
    `Presupuesto origen: ${number}`,
  );
  await page
    .getByRole("button", { name: `Ver presupuesto ${number}`, exact: true })
    .click();
  await expect(page.locator("dialog .alert")).toContainText(
    "Convertido en factura",
  );
  await expect(
    page.getByRole("button", { name: "Convertir a factura", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Editar presupuesto", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Ver factura en borrador/ }).click();
  await page
    .getByRole("button", { name: "Editar borrador", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await expect(page.getByLabel("Descripción 1", { exact: true })).toHaveValue(
    "Taller de robótica",
  );
  await expect(page.getByLabel("Precio 1", { exact: true })).toHaveValue(
    "19.99",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Emitir", exact: true }).click();
  await page
    .getByRole("button", { name: "Emitir factura", exact: true })
    .click();
  await expect(page.locator(".invoice-paper h2")).toHaveText(
    /^Factura nº F-\d{4}-\d{4}$/,
  );
  await page.screenshot({ path: `${out}/factura.png`, fullPage: true });
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: /^Presupuestos \(/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar", exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "presupuestos.csv");
  await page.getByLabel("Estado de presupuesto").selectOption("converted");
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/movil.png`, fullPage: true });
  assert.equal(
    await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
    false,
  );
  await row.getByRole("button", { name: "Ver presupuesto →" }).click();
  await expect(page.locator(".invoice-paper h2")).toHaveText(
    `Presupuesto nº ${number}`,
  );
  await page.screenshot({
    path: `${out}/movil-presupuesto.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: creación, cálculo, búsqueda, estados, conversión, enlaces, edición/emisión de factura, exportación y móvil; sin errores de React.",
  );
} finally {
  await browser.close();
}
