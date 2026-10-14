import Decimal from "decimal.js";
import type { Line, Invoice, Payment, Enrollment, Expense } from "./types";
export const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
      }).format(value);
export const qty = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(v);
export const dateLabel = (s: string | null | undefined) =>
  s ? new Date(s + "T12:00:00").toLocaleDateString("es-ES") : "—";
export const monthLabel = (s: string) =>
  new Date(s + "-01T12:00:00").toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function calculateInvoice(lines: Line[], withholdingRate: number) {
  let subtotal = new Decimal(0),
    vat = new Decimal(0);
  for (const l of lines) {
    const b = l.historical_amount
      ? new Decimal(l.base ?? 0)
      : new Decimal(l.quantity || 0)
          .mul(l.price || 0)
          .mul(new Decimal(1).minus(new Decimal(l.discount || 0).div(100)))
          .toDecimalPlaces(2);
    subtotal = subtotal.add(b);
    vat = vat.add(
      b
        .mul(l.vat_rate || 0)
        .div(100)
        .toDecimalPlaces(2),
    );
  }
  const withholding = subtotal
    .mul(withholdingRate || 0)
    .div(100)
    .toDecimalPlaces(2);
  return {
    subtotal: subtotal.toNumber(),
    vat: vat.toNumber(),
    withholding: withholding.toNumber(),
    total: subtotal.add(vat).minus(withholding).toNumber(),
  };
}
export function invoicePaid(i: Invoice, p: Payment[]) {
  return p
    .filter((x) => x.invoice_id === i.id)
    .reduce((a, x) => a + Number(x.amount), 0);
}
export function invoiceState(i: Invoice, p: Payment[]) {
  if (i.status === "draft") return "Borrador";
  if (i.environment === "test") return "Prueba";
  if (i.total < 0) return "Rectificativa";
  const paid = invoicePaid(i, p);
  if (paid >= i.total) return "Cobrada";
  if (i.status === "imported" && !i.payment_reviewed && paid === 0)
    return "Por conciliar";
  if (i.due_date && i.due_date < today()) return "Vencida";
  if (paid > 0) return "Cobro parcial";
  return "Pendiente";
}
export function monthlyTotals(
  month: string,
  rows: Enrollment[],
  payments: Payment[],
  expenses: Expense[],
  invoices: Invoice[],
) {
  const r = rows.filter((x) => x.period === month);
  // Recover historical amounts, then assign app receipts to their actual payment month.
  // This also handles a November receipt for October classes without counting it twice.
  const enrollmentIds = new Set(r.map((x) => x.id));
  const ledgerTotal = r.reduce(
    (a, x) => a + Number(x.paid || 0) + Number(x.advance || 0),
    0,
  );
  const includedReceipts = payments
    .filter((p) => p.enrollment_id && enrollmentIds.has(p.enrollment_id))
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const currentReceipts = payments
    .filter((p) => p.enrollment_id && p.date.startsWith(month))
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const operational = ledgerTotal - includedReceipts + currentReceipts;
  const independent = payments
    .filter((p) => !p.enrollment_id && p.date.startsWith(month))
    .reduce((a, p) => a + Number(p.amount), 0);
  const cash = operational + independent;
  const out = expenses
    .filter((x) => x.status === "paid" && x.date.startsWith(month))
    .reduce((a, x) => a + Number(x.amount), 0);
  return {
    cash,
    operational,
    independent,
    expenses: out,
    net: cash - out,
    expected: r.reduce((a, x) => a + Number(x.expected || 0), 0),
    hours: r.reduce((a, x) => a + Number(x.month_hours || 0), 0),
    billed: invoices
      .filter(
        (i) =>
          i.status !== "draft" &&
          i.environment === "production" &&
          i.date.startsWith(month),
      )
      .reduce((a, i) => a + Number(i.total), 0),
  };
}
export function csvText(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const quote = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      keys.map(quote).join(";"),
      ...rows.map((r) => keys.map((k) => quote(r[k])).join(";")),
    ].join("\r\n")
  );
}
export function download(
  name: string,
  content: BlobPart,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
