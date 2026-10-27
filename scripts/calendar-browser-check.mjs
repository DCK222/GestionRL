// Run after node scripts/local-fixture.mjs. Uses synthetic data only.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1100 },
  locale: "es-ES",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const out = "test-results/calendar";
await mkdir(out, { recursive: true });
try {
  // Reset only the isolated fixture events so this check can be repeated.
  const existing = await (await page.request.get("http://127.0.0.1:4545/rest/v1/rl_events")).json();
  for (const event of existing) {
    const response = await page.request.post("http://127.0.0.1:4545/rest/v1/rpc/rl_delete_event", { data: { p_id: event.id, p_version: event.version } });
    assert.equal(response.ok(), true);
  }
  await page.goto("http://127.0.0.1:3101");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("local-fixture-password");
  await page.getByRole("button", { name: "Entrar a Roboticlab" }).click();
  await page.getByRole("button", { name: "Calendario", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nuevo evento", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Mes del calendario").fill("2026-10");
  async function create(title, category, date) {
    await page
      .getByRole("button", { name: "Nuevo evento", exact: true })
      .click();
    await page.getByLabel("Nombre del evento", { exact: true }).fill(title);
    await page
      .getByLabel("Cliente", { exact: true })
      .selectOption({ label: "Cliente de prueba" });
    await page.getByRole("radio", { name: category, exact: true }).check();
    await page.getByLabel("Fecha", { exact: true }).fill(date);
    await page.getByLabel("Hora de inicio", { exact: true }).fill("10:30");
    await page.getByLabel("Hora de fin", { exact: true }).fill("12:00");
    await page.getByLabel("Precio total (€)", { exact: false }).fill("150.50");
    await page
      .getByLabel("Número de participantes", { exact: true })
      .fill("18");
    await page
      .getByLabel("Lugar y dirección", { exact: false })
      .fill("Plaza Mayor, Madrid");
    await page
      .getByLabel("Participantes y grupos (opcional)", { exact: true })
      .fill("Grupo de robótica · 18 participantes");
    await page
      .getByRole("button", { name: "Guardar evento", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await create("Exploradores de robótica", "Taller", "2026-10-27");
  await create("Cumple de Lucas", "Cumpleaños", "2026-10-27");
  await create("Robots en el cole", "Colegio", "2026-10-29");
  await create("Planificación de noviembre", "Reunión", "2026-10-30");
  await expect(page.locator(".calendar-stats")).toContainText("602,00");
  await page
    .getByRole("button", { name: "Ver martes, 27 de octubre", exact: true })
    .click();
  await page.screenshot({ path: `${out}/calendario.png`, fullPage: true });
  await page
    .locator(".calendar-day-panel .event-card")
    .filter({ hasText: "Exploradores de robótica" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("1,5 h");
  assert.equal(
    await page.locator("iframe.event-map").getAttribute("src"),
    "https://www.google.com/maps?q=Plaza%20Mayor%2C%20Madrid&output=embed",
  );
  await page.screenshot({ path: `${out}/detalle.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Editar evento", exact: true })
    .click();
  await page.getByLabel("Hora de fin", { exact: true }).fill("09:00");
  await page
    .getByRole("button", { name: "Guardar evento", exact: true })
    .click();
  await expect(page.locator("dialog .alert.error")).toContainText("La hora de fin");
  await page.getByLabel("Hora de fin", { exact: true }).fill("13:00");
  await page.getByLabel("Precio total (€)", { exact: false }).fill("175");
  await page.getByLabel("Estado", { exact: true }).selectOption("confirmed");
  await page
    .getByLabel("Iframe de Google Maps (opcional)", { exact: false })
    .fill('<iframe src="https://evil.test/maps/embed"></iframe>');
  await page
    .getByRole("button", { name: "Guardar evento", exact: true })
    .click();
  await expect(page.locator("dialog .alert.error")).toContainText("Pega el iframe");
  await page
    .getByLabel("Iframe de Google Maps (opcional)", { exact: false })
    .fill(
      '<iframe src="https://www.google.com/maps/embed?pb=fixture"></iframe>',
    );
  await page.screenshot({ path: `${out}/editor.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Guardar evento", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Calendario", exact: true }).click();
  await page.getByLabel("Mes del calendario").fill("2026-10");
  await page.getByLabel("Buscar eventos", { exact: true }).fill("exploradores de robotica");
  await expect(page.locator(".calendar-chip")).toHaveCount(1);
  await page.getByLabel("Buscar eventos", { exact: true }).fill("");
  await page
    .getByLabel("Tipo de evento", { exact: true })
    .selectOption("birthday");
  await expect(page.locator(".calendar-chip")).toHaveCount(1);
  await page.getByLabel("Tipo de evento", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.locator(".calendar-agenda .event-card")).toHaveCount(4);
  await page
    .locator(".calendar-agenda .event-card")
    .filter({ hasText: "Cumple de Lucas" })
    .click();
  await page
    .getByRole("button", { name: "Editar evento", exact: true })
    .click();
  await page.getByLabel("Precio total (€)", { exact: false }).fill("150.50");
  await page.getByLabel("Estado", { exact: true }).selectOption("cancelled");
  await page
    .getByRole("button", { name: "Guardar evento", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".calendar-stats")).toContainText("476,00");
  await page.screenshot({ path: `${out}/agenda.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Mes", exact: true }).click();
  await page.screenshot({ path: `${out}/movil.png`, fullPage: true });
  assert.equal(
    await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
    false,
  );
  await page
    .locator(".calendar-chip")
    .filter({ hasText: "Exploradores" })
    .click();
  await page
    .getByRole("button", { name: "Editar evento", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({ path: `${out}/editor-movil.png`, fullPage: true });
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".calendar-chip").filter({ hasText: "Exploradores" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.getByRole("button", { name: "Cambiar tema" }).click();
  await page.screenshot({ path: `${out}/oscuro.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: creación, persistencia, edición, validación, mapas, filtros, agenda, cancelación, borrado, móvil y tema oscuro.",
  );
} finally {
  await browser.close();
}
