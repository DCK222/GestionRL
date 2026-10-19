"use client";
import { useEffect, useRef, useState } from "react";
import {
  Calculator,
  Clock3,
  History,
  Pencil,
  Printer,
  Save,
  Wallet,
} from "lucide-react";
import type { Shared } from "./workspace";
import type { Enrollment } from "@/lib/types";
import { money, qty } from "@/lib/finance";
import { rpc } from "@/lib/supabase";
import {
  draftEnrollment,
  expectedFromHours,
  parseClipboard,
  parseSheetValue,
  sheetColumns,
  sheetString,
  type SheetDraft,
  type SheetKey,
} from "@/lib/academy-sheet";

export function AcademySheet({
  rows,
  onHours,
  onPayment,
  onEdit,
  onHistory,
  onReport,
  onDirty,
  ...shared
}: Shared & {
  rows: Enrollment[];
  onHours: (row: Enrollment) => void;
  onPayment: (row: Enrollment) => void;
  onEdit: (row: Enrollment) => void;
  onHistory: (row: Enrollment) => void;
  onReport: (row: Enrollment) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { data, canWrite, notify, reload, setUnsavedChanges } = shared;
  const [drafts, setDrafts] = useState<Record<string, SheetDraft>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const pending = Object.keys(drafts).length;
  const name = (row: Enrollment) =>
    data.students.find((s) => s.id === row.student_id)?.name ||
    row.schedule ||
    "Otros ingresos";
  useEffect(() => {
    onDirty(pending > 0);
    setUnsavedChanges?.(pending > 0);
  }, [pending, onDirty, setUnsavedChanges]);
  useEffect(
    () => () => {
      onDirty(false);
      setUnsavedChanges?.(false);
    },
    [onDirty, setUnsavedChanges],
  );
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  function change(row: Enrollment, key: SheetKey, value: string) {
    setDrafts((previous) => {
      const next = { ...previous };
      const draft = next[row.id] || { base: row, values: {} };
      const values = { ...draft.values, [key]: value };
      if (value === sheetString(draft.base[key])) delete values[key];
      if (Object.keys(values).length) next[row.id] = { ...draft, values };
      else delete next[row.id];
      return next;
    });
  }
  function move(rowIndex: number, colIndex: number) {
    root.current
      ?.querySelector<HTMLInputElement>(
        `[data-row="${rowIndex}"][data-col="${colIndex}"]`,
      )
      ?.focus();
  }
  async function save() {
    if (!pending || busy || !canWrite) return;
    setError("");
    setBusy(true);
    try {
      const payload = Object.values(drafts).map(draftEnrollment);
      const count = await rpc<number>("rl_save_enrollments", {
        rows_data: payload,
      });
      setDrafts({});
      await reload();
      notify(`${count} filas guardadas`);
    } catch (e) {
      const message = (e as Error).message;
      setError(
        /rl_save_enrollments|schema cache/.test(message)
          ? "Ejecuta 030_clientes_y_hoja.sql en Supabase para guardar la hoja. Tus cambios siguen aquí."
          : `${message} Tus cambios siguen aquí; no se ha guardado ninguna fila del lote.`,
      );
    } finally {
      setBusy(false);
    }
  }
  function paste(
    event: React.ClipboardEvent,
    rowIndex: number,
    colIndex: number,
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    event.preventDefault();
    try {
      const cells = parseClipboard(text);
      if (
        cells.length + rowIndex > rows.length ||
        cells.some((r) => r.length + colIndex > sheetColumns.length)
      )
        throw new Error(
          "El bloque no cabe. Añade las filas que falten o pega menos columnas.",
        );
      const updates = cells.flatMap((cellsRow, r) =>
        cellsRow.map((value, c) => {
          const key = sheetColumns[colIndex + c].key;
          const parsed = parseSheetValue(key, value);
          return {
            row: rows[rowIndex + r],
            key,
            value: key === "billing_mode" ? String(parsed) : value,
          };
        }),
      );
      // Validate the entire clipboard block before changing any cell.
      setDrafts((previous) => {
        const next = { ...previous };
        for (const { row, key, value } of updates) {
          const draft = next[row.id] || { base: row, values: {} };
          const values = { ...draft.values, [key]: value };
          if (value === sheetString(draft.base[key])) delete values[key];
          if (Object.keys(values).length) next[row.id] = { ...draft, values };
          else delete next[row.id];
        }
        return next;
      });
      setError("");
      notify(
        `${updates.length} celdas pegadas. Guarda los cambios cuando termines.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function recalculate(row: Enrollment) {
    try {
      const current = drafts[row.id] ? draftEnrollment(drafts[row.id]) : row;
      change(row, "expected", expectedFromHours(current));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function total(key: SheetKey) {
    let sum = 0;
    for (const row of rows) {
      try {
        const value = drafts[row.id]?.values[key];
        sum += Number(
          value === undefined
            ? row[key] || 0
            : parseSheetValue(key, value) || 0,
        );
      } catch {
        return "Revisar";
      }
    }
    return ["paid", "advance", "expected"].includes(key)
      ? money(sum)
      : qty(sum);
  }
  return (
    <div
      ref={root}
      className="academy-sheet"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="sheet-toolbar">
        <div>
          <strong>Hoja mensual editable</strong>
          <p>
            Escribe en las celdas · Tab avanza · Enter baja · Puedes pegar un
            bloque de Excel.
          </p>
        </div>
        {canWrite && (
          <div className="actions">
            <span role="status">
              {pending
                ? `${pending} filas sin guardar`
                : "Todos los cambios guardados"}
            </span>
            <button
              disabled={!pending || busy}
              onClick={() => {
                setDrafts({});
                setError("");
              }}
            >
              Descartar cambios
            </button>
            <button
              className="primary"
              disabled={!pending || busy}
              onClick={() => void save()}
            >
              <Save size={16} />
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div
        className="sheet-scroll"
        tabIndex={0}
        aria-label="Hoja mensual. Desplazamiento horizontal y vertical"
      >
        <table className="editable-sheet">
          <thead>
            <tr>
              <th className="sheet-person">Alumno / contacto</th>
              {sheetColumns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const person = data.students.find((s) => s.id === row.student_id);
              return (
                <tr key={row.id}>
                  <td className="sheet-person">
                    <strong>{name(row)}</strong>
                    <small>
                      {person?.phone || person?.email || row.category}
                    </small>
                    <button
                      className="sheet-report-button"
                      disabled={pending > 0 || busy}
                      title="Ver e imprimir el registro del alumno en este mes"
                      aria-label={`Registro mensual de ${name(row)}`}
                      onClick={() => onReport(row)}
                    >
                      <Printer size={13} /> Registro mensual
                    </button>
                  </td>
                  {sheetColumns.map((column, colIndex) => {
                    const value =
                      drafts[row.id]?.values[column.key] ??
                      sheetString(row[column.key]);
                    let invalid = false;
                    try {
                      parseSheetValue(column.key, value);
                    } catch {
                      invalid = true;
                    }
                    const common = {
                      "aria-label": `${column.label} de ${name(row)}`,
                      "aria-invalid": invalid,
                      "data-row": rowIndex,
                      "data-col": colIndex,
                      value,
                      disabled: !canWrite || busy,
                      onChange: (
                        event: React.ChangeEvent<
                          HTMLInputElement | HTMLSelectElement
                        >,
                      ) => change(row, column.key, event.target.value),
                      onPaste: (event: React.ClipboardEvent) =>
                        paste(event, rowIndex, colIndex),
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (
                          event.key === "Enter" ||
                          (column.key !== "billing_mode" &&
                            ["ArrowDown", "ArrowUp"].includes(event.key))
                        ) {
                          event.preventDefault();
                          move(
                            rowIndex +
                              (event.key === "ArrowUp" || event.shiftKey
                                ? -1
                                : 1),
                            colIndex,
                          );
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          change(
                            row,
                            column.key,
                            sheetString(
                              drafts[row.id]?.base[column.key] ??
                                row[column.key],
                            ),
                          );
                        }
                      },
                    };
                    return (
                      <td
                        key={column.key}
                        className={`${drafts[row.id]?.values[column.key] !== undefined ? "cell-edited" : ""} ${column.key === "notes" || column.key === "class_days" ? "sheet-wide" : ""}`}
                      >
                        {column.key === "billing_mode" ? (
                          <select {...common}>
                            <option value="hourly">Por hora</option>
                            <option value="pack">Bono</option>
                            <option value="manual">Manual</option>
                          </select>
                        ) : (
                          <input
                            {...common}
                            type="text"
                            inputMode={"numeric" in column ? "decimal" : "text"}
                            autoComplete="off"
                          />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <div className="row-actions">
                      {canWrite && (
                        <>
                          <button
                            disabled={busy}
                            title="Recalcular previsto: horas × precio − pagado − anticipo"
                            aria-label={`Recalcular previsto de ${name(row)}`}
                            onClick={() => recalculate(row)}
                          >
                            <Calculator size={16} />
                          </button>
                          <button
                            disabled={pending > 0 || busy}
                            title="Registrar clase o bono"
                            aria-label={`Horas de ${name(row)}`}
                            onClick={() => onHours(row)}
                          >
                            <Clock3 size={16} />
                          </button>
                          <button
                            disabled={pending > 0 || busy}
                            title="Registrar cobro"
                            aria-label={`Cobro de ${name(row)}`}
                            onClick={() => onPayment(row)}
                          >
                            <Wallet size={16} />
                          </button>
                          <button
                            disabled={pending > 0 || busy}
                            title="Editar fila"
                            aria-label={`Editar fila de ${name(row)}`}
                            onClick={() => onEdit(row)}
                          >
                            <Pencil size={16} />
                          </button>
                        </>
                      )}
                      <button
                        title="Historial de horas"
                        aria-label={`Historial de ${name(row)}`}
                        onClick={() => onHistory(row)}
                      >
                        <History size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sheet-person">
                Total · {rows.length} filas visibles
              </th>
              {sheetColumns.map((column) => (
                <td key={column.key}>
                  {[
                    "units",
                    "pack_units",
                    "month_hours",
                    "paid",
                    "advance",
                    "expected",
                  ].includes(column.key)
                    ? total(column.key)
                    : ""}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="sheet-help">
        Las celdas resaltadas están pendientes de guardar. «Recalcular previsto»
        aplica horas × precio − pagado − anticipo en tarifas por hora. Para
        anotar una nueva clase o un cobro con fecha, usa sus botones después de
        guardar.
      </p>
    </div>
  );
}
