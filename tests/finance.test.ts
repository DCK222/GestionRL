import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateInvoice,
  monthlyTotals,
  csvText,
  invoiceState,
} from "../src/lib/finance";
import type { Enrollment, Payment, Invoice } from "../src/lib/types";
test("round invoice lines and withholding independently", () => {
  assert.deepEqual(
    calculateInvoice(
      [
        {
          description: "Servicio",
          quantity: 3,
          price: 19.99,
          discount: 10,
          vat_rate: 21,
        },
      ],
      15,
    ),
    { subtotal: 53.97, vat: 11.33, withholding: 8.1, total: 57.2 },
  );
});
test("historical unit display does not multiply a bundled total", () => {
  assert.equal(
    calculateInvoice(
      [
        {
          description: "8 horas",
          quantity: 8,
          price: 180,
          discount: 0,
          vat_rate: 0,
          historical_amount: true,
          base: 180,
        },
      ],
      0,
    ).total,
    180,
  );
});
test("negative rectifying amounts retain their sign", () => {
  assert.equal(
    calculateInvoice(
      [
        {
          description: "Abono",
          quantity: 1,
          price: -100,
          discount: 0,
          vat_rate: 21,
        },
      ],
      15,
    ).total,
    -106,
  );
});
test("class receipts are counted only once", () => {
  const r = [
    {
      id: "existing",
      period: "2026-10",
      paid: 100,
      advance: 25,
      expected: 50,
      month_hours: 2,
    },
  ] as Enrollment[];
  const p = [
    { date: "2026-10-01", amount: 100, enrollment_id: "existing" },
    { date: "2026-10-01", amount: 30, enrollment_id: null },
  ] as Payment[];
  assert.equal(monthlyTotals("2026-10", r, p, [], []).cash, 155);
});
test("late class payment belongs to its actual receipt month", () => {
  const rows = [
    { id: "october", period: "2026-10", paid: 150, advance: 0 },
  ] as Enrollment[];
  const payments = [
    { date: "2026-11-03", amount: 50, enrollment_id: "october" },
  ] as Payment[];
  assert.equal(monthlyTotals("2026-10", rows, payments, [], []).cash, 100);
  assert.equal(monthlyTotals("2026-11", rows, payments, [], []).cash, 50);
});
test("unconfirmed historical invoice does not become overdue automatically", () => {
  assert.equal(
    invoiceState(
      {
        status: "imported",
        total: 100,
        environment: "production",
        due_date: "2020-01-01",
        payment_reviewed: false,
      } as Invoice,
      [],
    ),
    "Por conciliar",
  );
});
test("CSV escapes formulas and quotes", () => {
  const csv = csvText([{ name: '=WEBSERVICE("x")', note: "A;B" }]);
  assert.ok(csv.includes("'=WEBSERVICE"));
  assert.ok(csv.includes('"A;B"'));
});
