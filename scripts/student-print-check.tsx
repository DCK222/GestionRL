import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs/promises";
import {
  StudentMonthPaper,
  type ClassMovement,
} from "../src/components/student-month-report";
import type { Enrollment } from "../src/lib/types";

async function main() {
  const row: Enrollment = {
    id: "test-row",
    student_id: "test-student",
    period: "2026-10",
    category: "Robótica",
    schedule: "Martes de 17:00 a 18:00",
    rate: 20,
    rate_label: "20 € / hora",
    month_hours: 4,
    units: 4,
    pack_units: null,
    paid: 60,
    advance: 10,
    expected: 10,
    class_days: "M6 M13 M20 M27",
    notes: "NOTA INTERNA NO IMPRIMIR",
    billing_mode: "hourly",
    source_sheet: null,
    source_row: null,
    version: 1,
  };
  const css = (await fs.readFile("src/app/globals.css", "utf8")).replace(
    /@import[^;]+;/g,
    "",
  );
  const logo = `data:image/webp;base64,${(await fs.readFile("public/logo.webp")).toString("base64")}`;
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  await fs.mkdir("private-import/print-review", { recursive: true });
  try {
    const page = await browser.newPage();
    for (const mode of ["student-short", "student-long", "student-empty"]) {
      const logs: ClassMovement[] = Array.from(
        {
          length:
            mode === "student-long" ? 55 : mode === "student-empty" ? 0 : 4,
        },
        (_, i) => ({
          id: `log-${i}`,
          enrollment_id: row.id,
          date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
          kind: "class",
          units: 1,
          note: `Sesión ${String(i + 1).padStart(2, "0")} de robótica educativa`,
        }),
      );
      const rows =
        mode === "student-empty"
          ? [
              {
                ...row,
                month_hours: null,
                paid: null,
                advance: null,
                expected: null,
                class_days: "",
              },
            ]
          : [row];
      const markup = renderToStaticMarkup(
        <StudentMonthPaper
          name="Alumno de prueba"
          period={row.period}
          rows={rows}
          logs={logs}
          payments={
            mode === "student-empty"
              ? []
              : [
                  {
                    id: "p",
                    enrollment_id: row.id,
                    invoice_id: null,
                    date: "2026-10-06",
                    amount: 60,
                    method: "Transferencia",
                    description: "Cuota de octubre",
                    notes: "NOTA PRIVADA NO IMPRIMIR",
                  },
                ]
          }
        />,
      ).replaceAll('src="/logo.webp"', `src="${logo}"`);
      await page.route("https://student-check.invalid/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Roboticlab · Gestión</title><style>${css}</style></head><body><div class="app-shell"><div class="main-shell"><main><section>NO IMPRIMIR</section><dialog class="modal wide"><header>NO IMPRIMIR</header><div class="document-actions">NO IMPRIMIR</div>${markup}</dialog></main></div></div></body></html>`,
        }),
      );
      await page.goto(`https://student-check.invalid/${mode}`);
      await page.evaluate(async () => {
        document.querySelector("dialog")!.showModal();
        await Promise.all(Array.from(document.images).map((i) => i.decode()));
      });
      await page.pdf({
        path: `private-import/print-review/${mode}.pdf`,
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
      });
      await page.unroute("https://student-check.invalid/**");
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
