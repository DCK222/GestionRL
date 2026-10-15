import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs/promises";
import { InvoicePaper } from "../src/components/invoices";
import type { Invoice } from "../src/lib/types";

async function main() {
  const source = JSON.parse(
    await fs.readFile("private-import/normalized.json", "utf8"),
  );
  const sample: Invoice = {
    ...source.invoices.find((i: Invoice) => i.number === "F-2026-1008"),
    number: "F-2026-1021",
    date: "2026-10-15",
    project_date: "2026-10-13",
    status: "issued",
    environment: "production",
    invoice_type: "F1",
    location: "",
    notes: "",
    document_id: null,
    lines: [
      {
        description:
          "SENIOR DIGITAL- IMSERSO CAUMAS Descubre las reacciones químicas que ocurren al cocinar. Fecha 13/10/26 Online",
        quantity: 1,
        price: 100,
        discount: 0,
        vat_rate: 0,
        base: 100,
      },
    ],
    subtotal: 100,
    vat: 0,
    withholding_rate: 15,
    withholding: 15,
    total: 85,
  };
  const css = (await fs.readFile("src/app/globals.css", "utf8")).replace(
    /@import[^;]+;/g,
    "",
  );
  const logo = `data:image/webp;base64,${(await fs.readFile("public/logo.webp")).toString("base64")}`;
  const out = "private-import/print-review";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    for (const mode of ["short", "long", "dark-mobile"]) {
      const invoice =
        mode === "long"
          ? {
              ...sample,
              lines: Array.from({ length: 55 }, (_, index) => ({
                ...sample.lines[0],
                description: `Concepto ${String(index + 1).padStart(2, "0")} - Taller educativo con materiales y actividad práctica.`,
                base: 100,
              })),
              subtotal: 5500,
              withholding: 825,
              total: 4675,
            }
          : sample;
      const markup = renderToStaticMarkup(
        <InvoicePaper invoice={invoice} />,
      ).replaceAll('src="/logo.webp"', `src="${logo}"`);
      const html = `<!DOCTYPE html><html lang="es" data-theme="${mode === "dark-mobile" ? "dark" : "light"}"><head><meta charset="utf-8"><title>Roboticlab · Gestión</title><style>${css}</style></head><body><div class="app-shell"><aside class="sidebar">MENÚ NO IMPRIMIR</aside><div class="main-shell"><div class="topbar">CABECERA NO IMPRIMIR</div><main><section class="panel" style="height:2000px">LISTADO NO IMPRIMIR</section><dialog class="modal wide"><header>VISTA PREVIA NO IMPRIMIR</header><div class="document-actions">BOTONES NO IMPRIMIR</div>${markup}</dialog></main></div></div></body></html>`;
      await page.route("https://print-check.invalid/**", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      await page.goto(`https://print-check.invalid/${mode}`);
      await page.setViewportSize(
        mode === "dark-mobile"
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1080 },
      );
      await page.evaluate(async () => {
        document.querySelector("dialog")!.showModal();
        await Promise.all(
          Array.from(document.images).map((image) => image.decode()),
        );
      });
      // Deliberately enable browser headers: CSS must suppress them, not the test settings.
      await page.pdf({
        path: `${out}/${mode}.pdf`,
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
      });
      await page.unroute("https://print-check.invalid/**");
    }
    console.log(
      "Generated short, long and dark/mobile PDFs with browser headers enabled for regression checking.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
