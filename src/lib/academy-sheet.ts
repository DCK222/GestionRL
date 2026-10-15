import Decimal from "decimal.js";
import type { Enrollment } from "./types";

export const sheetColumns = [
  { key: "category", label: "Actividad" },
  { key: "schedule", label: "Horario / grupo" },
  { key: "rate_label", label: "Tarifa / bono" },
  { key: "rate", label: "Precio / hora", numeric: true, nonnegative: true },
  { key: "billing_mode", label: "Cálculo" },
  { key: "units", label: "Unidades", numeric: true },
  { key: "pack_units", label: "Bono", numeric: true },
  { key: "month_hours", label: "Horas mes", numeric: true, nonnegative: true },
  { key: "paid", label: "Pagado", numeric: true },
  { key: "advance", label: "Anticipo", numeric: true },
  { key: "expected", label: "Previsto", numeric: true },
  { key: "class_days", label: "Días de clase" },
  { key: "notes", label: "Observaciones" },
] as const;
export type SheetKey = (typeof sheetColumns)[number]["key"];
export type SheetDraft = {
  base: Enrollment;
  values: Partial<Record<SheetKey, string>>;
};
export function sheetString(value: unknown) {
  return value == null ? "" : String(value);
}
export function parseSheetValue(
  key: SheetKey,
  value: string,
): string | number | null {
  const column = sheetColumns.find((c) => c.key === key)!;
  if (key === "category" && !value.trim())
    throw new Error("La actividad no puede quedar vacía.");
  if (key === "billing_mode") {
    const mode =
      (
        {
          "por hora": "hourly",
          bono: "pack",
          manual: "manual",
          "importe manual": "manual",
        } as Record<string, string>
      )[value.toLowerCase().trim()] || value;
    if (!["hourly", "pack", "manual"].includes(mode))
      throw new Error("Cálculo: utiliza Por hora, Bono o Manual.");
    return mode;
  }
  if (!("numeric" in column)) return value;
  let clean = value.trim().replace(/[€\s\u00a0]/g, "");
  if (!clean) return null;
  if (clean.includes(",")) clean = clean.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(clean) || !Number.isFinite(Number(clean)))
    throw new Error(`${column.label}: introduce un número válido.`);
  const number = Number(clean);
  if ("nonnegative" in column && number < 0)
    throw new Error(`${column.label} no puede ser negativo.`);
  return number;
}
export function draftEnrollment(draft: SheetDraft): Enrollment {
  const result = { ...draft.base };
  for (const [key, value] of Object.entries(draft.values)) {
    Object.assign(result, { [key]: parseSheetValue(key as SheetKey, value!) });
  }
  return result;
}
export function expectedFromHours(row: Enrollment) {
  if (row.billing_mode !== "hourly" || row.rate == null)
    throw new Error("Para recalcular, selecciona Por hora e indica el precio.");
  return new Decimal(row.month_hours || 0)
    .mul(row.rate)
    .minus(row.paid || 0)
    .minus(row.advance || 0)
    .toDecimalPlaces(2)
    .toString();
}
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' && (quoted || cell === "")) {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell);
      cell = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error("El bloque pegado contiene comillas sin cerrar.");
  if (cell !== "" || row.length || !source.endsWith("\n")) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
