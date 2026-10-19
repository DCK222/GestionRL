"use client";
import { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import Decimal from "decimal.js";
import type { Company, Data, Enrollment, Payment } from "@/lib/types";
import { money, monthLabel, qty } from "@/lib/finance";
import { supabase } from "@/lib/supabase";
import { Modal } from "./ui";

export type ClassMovement = {
  id: string;
  enrollment_id: string;
  date: string;
  kind: "class" | "pack" | "adjustment";
  units: number;
  note: string;
};
const movementLabels = {
  class: "Clase realizada",
  pack: "Recarga de bono",
  adjustment: "Ajuste de horas",
};
const dateLabel = (value: string) =>
  value.slice(0, 10).split("-").reverse().join("/");
const amount = (value: number | null) => (value == null ? "—" : money(value));
const units = (value: number | null) => (value == null ? "—" : qty(value));

export function StudentMonthReport({
  data,
  selected,
  onClose,
}: {
  data: Data;
  selected: Enrollment;
  onClose: () => void;
}) {
  const rows = useMemo(
    () =>
      data.enrollments.filter(
        (row) =>
          row.period === selected.period &&
          (selected.student_id
            ? row.student_id === selected.student_id
            : row.id === selected.id),
      ),
    [data.enrollments, selected],
  );
  const student = data.students.find((s) => s.id === selected.student_id);
  const name = student?.name || selected.schedule || "Otros ingresos";
  const [logs, setLogs] = useState<ClassMovement[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    setError("");
    async function load() {
      // Paginate per enrollment so a long history cannot silently be truncated.
      const all = await Promise.all(
        rows.map(async (row) => {
          const result: ClassMovement[] = [];
          for (let start = 0; ; start += 500) {
            const response = await supabase
              .from("rl_hours")
              .select("*")
              .eq("enrollment_id", row.id)
              .order("id", { ascending: true })
              .range(start, start + 499);
            if (response.error) throw new Error(response.error.message);
            result.push(...(response.data as ClassMovement[]));
            if (response.data.length < 500) break;
          }
          return result;
        }),
      );
      if (!cancelled)
        setLogs(
          all
            .flat()
            .sort(
              (a, b) =>
                a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
            ),
        );
    }
    void load().catch((e: Error) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [rows, attempt]);
  const rowIds = new Set(rows.map((row) => row.id));
  const payments = data.payments
    .filter((p) => p.enrollment_id && rowIds.has(p.enrollment_id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const ready = logs !== null && !error;
  return (
    <Modal wide title={`Registro mensual · ${name}`} onClose={onClose}>
      <div className="document-actions">
        <span>
          {monthLabel(selected.period)} · {rows.length}{" "}
          {rows.length === 1 ? "actividad" : "actividades"}
        </span>
        <button
          className="primary"
          disabled={!ready}
          onClick={async () => {
            await document.fonts.ready;
            await Promise.all(
              Array.from(
                document.querySelectorAll<HTMLImageElement>(
                  ".student-month-paper img",
                ),
              ).map((image) => image.decode().catch(() => undefined)),
            );
            window.print();
          }}
        >
          <Printer size={16} /> Imprimir / Guardar PDF
        </button>
      </div>
      {error ? (
        <div className="alert error" role="alert">
          No se pudo cargar el registro completo: {error}
          <button onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw size={15} /> Reintentar
          </button>
        </div>
      ) : !ready ? (
        <p className="modal-body" role="status">
          Cargando movimientos del mes…
        </p>
      ) : (
        <StudentMonthPaper
          name={name}
          period={selected.period}
          rows={rows}
          logs={logs!}
          payments={payments}
          company={data.settings?.company}
        />
      )}
    </Modal>
  );
}

export function StudentMonthPaper({
  name,
  period,
  rows,
  logs,
  payments,
  company,
}: {
  name: string;
  period: string;
  rows: Enrollment[];
  logs: ClassMovement[];
  payments: Payment[];
  company?: Company;
}) {
  const total = (key: "month_hours" | "paid" | "advance" | "expected") => {
    const values = rows.map((row) => row[key]).filter((n) => n != null);
    return values.length
      ? values
          .reduce<Decimal>((sum, n) => sum.plus(n), new Decimal(0))
          .toNumber()
      : null;
  };
  return (
    <article className="invoice-paper student-month-paper">
      <header className="student-report-heading">
        <img src="/logo.webp" alt="Roboticlab" width={185} height={55} />
        <div>
          <h2>Registro mensual</h2>
          <p>{monthLabel(period)}</p>
        </div>
      </header>
      <h3 className="student-report-name">{name}</h3>
      <div className="student-report-totals">
        <div>
          <span>Horas del mes</span>
          <strong>{units(total("month_hours"))}</strong>
        </div>
        <div>
          <span>Pagado</span>
          <strong>{amount(total("paid"))}</strong>
        </div>
        <div>
          <span>Anticipos</span>
          <strong>{amount(total("advance"))}</strong>
        </div>
        <div>
          <span>Pago previsto</span>
          <strong>{amount(total("expected"))}</strong>
        </div>
      </div>
      <h3>Actividades del mes</h3>
      <table className="invoice-lines student-report-table">
        <thead>
          <tr>
            <th>Actividad / horario</th>
            <th>Tarifa</th>
            <th>Horas</th>
            <th>Unidades</th>
            <th>Saldo bono</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.category}</strong>
                {row.schedule && <small>{row.schedule}</small>}
              </td>
              <td>
                {row.billing_mode === "hourly" && row.rate != null
                  ? `${money(row.rate)} / hora`
                  : row.rate_label || "—"}
              </td>
              <td>{units(row.month_hours)}</td>
              <td>{units(row.units)}</td>
              <td>{units(row.pack_units)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Días de clase anotados</h3>
      {rows.map((row) => (
        <div className="student-report-days" key={row.id}>
          <strong>
            {row.category}
            {row.schedule ? ` · ${row.schedule}` : ""}
          </strong>
          <p>{row.class_days || "Sin días anotados."}</p>
        </div>
      ))}
      <p className="student-report-note">
        Códigos del registro: L lunes · M martes · X miércoles · J jueves · V
        viernes · S sábado · D domingo. Se conservan las anotaciones originales.
      </p>
      <h3>Detalle de movimientos</h3>
      {logs.length ? (
        <table className="invoice-lines student-report-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Actividad</th>
              <th>Movimiento</th>
              <th>Horas / unidades</th>
              <th>Concepto</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{dateLabel(log.date)}</td>
                <td>
                  {rows.find((row) => row.id === log.enrollment_id)?.category}
                </td>
                <td>{movementLabels[log.kind]}</td>
                <td>{qty(log.units)}</td>
                <td>{log.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          No hay movimientos detallados registrados en la aplicación para este
          mes.
        </p>
      )}
      <p className="student-report-note">
        El resumen refleja los valores guardados del mes. El detalle muestra los
        movimientos registrados en la aplicación; los datos importados pueden no
        tener un desglose por clase.
      </p>
      <h3>Cobros asociados al registro</h3>
      {payments.length ? (
        <table className="invoice-lines student-report-table">
          <thead>
            <tr>
              <th>Fecha de cobro</th>
              <th>Concepto</th>
              <th>Método</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{dateLabel(p.date)}</td>
                <td>{p.description}</td>
                <td>{p.method}</td>
                <td>{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>
          Sin cobros desglosados. Consulta «Pagado» y «Anticipos» en el resumen
          del mes.
        </p>
      )}
      <p className="student-report-note">
        Los cobros detallados ya están incluidos en el resumen; no se suman de
        nuevo. «—» significa dato no indicado.
      </p>
      <footer>
        {company?.brand || "Roboticlab"}
        {company?.email ? ` · ${company.email}` : ""}
        <br />
        Registro de seguimiento mensual · No sustituye a una factura.
      </footer>
    </article>
  );
}
