"use client";
import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Download,
  Clock3,
  Wallet,
  GraduationCap,
  Copy,
} from "lucide-react";
import type { Shared } from "./workspace";
import type { Enrollment } from "@/lib/types";
import { supabase, rpc } from "@/lib/supabase";
import {
  money,
  qty,
  monthLabel,
  today,
  csvText,
  download,
} from "@/lib/finance";
import { SectionTitle, Stat, Badge, Empty, Field, Modal } from "./ui";
import { PaymentForm } from "./records";
import { AcademySheet } from "./academy-sheet";
import { searchText } from "@/lib/clients";
import { StudentMonthReport } from "./student-month-report";
export function Academy(
  shared: Shared & { period: string; setPeriod: (s: string) => void },
) {
  const { data, period, setPeriod, canWrite, notify } = shared;
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("all"),
    [edit, setEdit] = useState<Partial<Enrollment> | null>(null),
    [hours, setHours] = useState<Enrollment | null>(null),
    [payment, setPayment] = useState<Enrollment | null>(null),
    [clone, setClone] = useState(false),
    [history, setHistory] = useState<Record<string, unknown>[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [report, setReport] = useState<Enrollment | null>(null);
  const periods = [
    ...new Set([...data.enrollments.map((e) => e.period), period]),
  ]
    .sort()
    .reverse();
  const monthRows = data.enrollments
    .filter((e) => e.period === period)
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category, "es") ||
        (a.source_row ?? 9999) - (b.source_row ?? 9999),
    );
  const categories = [...new Set(monthRows.map((e) => e.category))];
  const student = (id: string | null) => data.students.find((s) => s.id === id);
  const rows = monthRows.filter(
    (e) =>
      (category === "all" || e.category === category) &&
      searchText(
        `${student(e.student_id)?.name} ${student(e.student_id)?.phone} ${e.schedule} ${e.notes}`,
      ).includes(searchText(search)),
  );
  const sum = (k: "paid" | "expected" | "month_hours" | "advance") =>
    monthRows.reduce((a, e) => a + Number(e[k] || 0), 0);
  async function showHistory(e: Enrollment) {
    const { data: logs, error } = await supabase
      .from("rl_hours")
      .select("*")
      .eq("enrollment_id", e.id)
      .order("created_at", { ascending: false });
    if (error) notify(error.message, true);
    else setHistory(logs);
  }
  return (
    <>
      <SectionTitle
        eyebrow="CLASES E INGRESOS"
        title="Tu academia, al día"
        description="El registro mensual de siempre, conectado con tus alumnos, horas y cobros."
        actions={
          <>
            <input
              aria-label="Mes de clases"
              type="month"
              disabled={dirty}
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setCategory("all");
              }}
            />
            {canWrite && (
              <button
                className="primary"
                disabled={dirty}
                onClick={() =>
                  setEdit({
                    period,
                    category: categories[0] || "Clases de Ciencias",
                    billing_mode: "hourly",
                    rate: 0,
                    student_id: data.students.find((s) => s.active)?.id,
                  })
                }
              >
                <Plus size={17} /> Añadir fila
              </button>
            )}
          </>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Registrado como pagado"
          value={money(sum("paid") + sum("advance"))}
          detail="Pagado + anticipos del mes"
          icon={<Wallet size={19} />}
          accent
        />
        <Stat
          label="Pago previsto"
          value={money(sum("expected"))}
          detail="Importes pendientes del registro"
          icon={<Wallet size={19} />}
        />
        <Stat
          label="Horas del mes"
          value={qty(sum("month_hours"))}
          detail="Las unidades de bonos se muestran aparte"
          icon={<Clock3 size={19} />}
        />
        <Stat
          label="Inscripciones"
          value={String(monthRows.length)}
          detail={monthLabel(period)}
          icon={<GraduationCap size={19} />}
        />
      </div>
      <div className="tabs">
        <button
          className={category === "all" ? "active" : ""}
          onClick={() => setCategory("all")}
        >
          Todas las actividades
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={category === c ? "active" : ""}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="sheet-month-tabs" aria-label="Meses del registro">
          {periods.map((m) => (
            <button
              key={m}
              disabled={dirty && m !== period}
              aria-pressed={period === m}
              className={period === m ? "active" : ""}
              onClick={() => {
                setPeriod(m);
                setCategory("all");
              }}
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
        <div className="table-toolbar">
          <div className="input-search">
            <Search size={17} />
            <input
              placeholder="Buscar alumno o anotación…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="actions">
            <button
              disabled={dirty}
              onClick={() =>
                download(
                  `clases-${period}.csv`,
                  csvText(
                    rows.map((e) => ({
                      Alumno: student(e.student_id)?.name,
                      Actividad: e.category,
                      Horario: e.schedule,
                      Tarifa: e.rate_label,
                      Horas: e.month_hours,
                      Unidades: e.units,
                      Bono: e.pack_units,
                      Pagado: e.paid,
                      Anticipo: e.advance,
                      Previsto: e.expected,
                      Dias: e.class_days,
                      Notas: e.notes,
                    })),
                  ),
                )
              }
            >
              <Download size={16} /> Exportar
            </button>
            {canWrite && (
              <button disabled={dirty} onClick={() => setClone(true)}>
                <Copy size={16} /> Preparar otro mes
              </button>
            )}
          </div>
        </div>
        <AcademySheet
          {...shared}
          rows={rows}
          onHours={setHours}
          onPayment={setPayment}
          onEdit={setEdit}
          onHistory={(row) => void showHistory(row)}
          onReport={setReport}
          onDirty={setDirty}
        />
        {!rows.length && (
          <Empty
            title="Un mes por organizar"
            text="Añade filas o prepara el mes copiando las actividades de otro periodo."
          />
        )}
        <div className="table-footer">
          {rows.length} registros{" "}
          <span>Una celda vacía significa dato no indicado.</span>
        </div>
      </section>
      <div className="subtle-note">
        Los importes históricos conservan el valor del Excel. Registrar una
        clase calcula su importe solo si eliges «Por hora». Un bono descuenta
        unidades y los apuntes manuales mantienen sus importes.
      </div>
      {edit && (
        <EnrollmentEditor
          {...shared}
          initial={edit}
          onClose={() => setEdit(null)}
        />
      )}
      {hours && (
        <HoursForm
          {...shared}
          row={hours}
          name={student(hours.student_id)?.name || hours.schedule}
          onClose={() => setHours(null)}
        />
      )}
      {payment && (
        <Modal
          title="Registrar cobro de clases"
          onClose={() => setPayment(null)}
        >
          <PaymentForm
            {...shared}
            enrollment={payment}
            onClose={() => setPayment(null)}
          />
        </Modal>
      )}
      {clone && <CloneMonth {...shared} onClose={() => setClone(false)} />}
      {report && (
        <StudentMonthReport
          data={data}
          selected={report}
          onClose={() => setReport(null)}
        />
      )}
      {history && (
        <Modal
          title="Historial de horas y bonos"
          onClose={() => setHistory(null)}
        >
          <div className="modal-body">
            {history.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Unidades</th>
                    <th>Concepto</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={String(h.id)}>
                      <td>{String(h.date)}</td>
                      <td>{String(h.kind)}</td>
                      <td>{String(h.units)}</td>
                      <td>{String(h.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty text="Los movimientos nuevos aparecerán aquí. El histórico del Excel está en Archivo original." />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function EnrollmentEditor({
  initial,
  onClose,
  data,
  reload,
  notify,
}: Shared & { initial: Partial<Enrollment>; onClose: () => void }) {
  const [f, setF] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal
      title={f.id ? "Editar registro mensual" : "Añadir inscripción"}
      onClose={onClose}
    >
      <form aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await rpc("rl_save_enrollment", { p: f });
            await reload();
            notify("Registro mensual guardado");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            <Field label="Alumno / contacto">
              <select
                required
                disabled={!!f.id}
                value={f.student_id || ""}
                onChange={(e) => set("student_id", e.target.value)}
              >
                <option value="">Seleccionar</option>
                {data.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Actividad">
              <input
                required
                value={f.category || ""}
                onChange={(e) => set("category", e.target.value)}
              />
            </Field>
            <Field label="Horario / grupo">
              <input
                value={f.schedule || ""}
                onChange={(e) => set("schedule", e.target.value)}
              />
            </Field>
            <Field label="Cálculo de nuevas clases">
              <select
                value={f.billing_mode}
                onChange={(e) => set("billing_mode", e.target.value)}
              >
                <option value="hourly">Por hora</option>
                <option value="pack">Descontar del bono</option>
                <option value="manual">Importe manual</option>
              </select>
            </Field>
            <Field label="Precio por hora (€)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={f.rate ?? ""}
                onChange={(e) => {
                  set(
                    "rate",
                    e.target.value === "" ? null : Number(e.target.value),
                  );
                }}
              />
            </Field>
            <Field label="Texto de tarifa / bono">
              <input
                placeholder="Ej. 80 € / 4 clases"
                value={f.rate_label || ""}
                onChange={(e) => set("rate_label", e.target.value)}
              />
            </Field>
            {f.id &&
              (
                [
                  "units",
                  "month_hours",
                  "pack_units",
                  "paid",
                  "advance",
                  "expected",
                ] as const
              ).map((k, n) => (
                <Field
                  key={k}
                  label={
                    [
                      "Unidades registradas",
                      "Horas del mes",
                      "Unidades restantes del bono",
                      "Pagado (€)",
                      "Anticipo (€)",
                      "Pago previsto (€)",
                    ][n]
                  }
                >
                  <input
                    type="number"
                    step="0.01"
                    min={k === "month_hours" ? 0 : undefined}
                    value={f[k] ?? ""}
                    onChange={(e) =>
                      set(
                        k,
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </Field>
              ))}
          </div>
          <Field label="Días de clase">
            <input
              value={f.class_days || ""}
              onChange={(e) => set("class_days", e.target.value)}
            />
          </Field>
          <Field label="Observaciones">
            <textarea
              value={f.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          {f.id && (
            <p className="subtle-note">
              Una edición corrige el registro y queda en la auditoría. Para
              nuevas clases y cobros, utiliza sus botones específicos.
            </p>
          )}
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" data-dismiss-modal onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar registro"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function HoursForm({
  row,
  name,
  onClose,
  reload,
  notify,
}: Shared & { row: Enrollment; name: string; onClose: () => void }) {
  const [kind, setKind] = useState("class"),
    [units, setUnits] = useState(1),
    [date, setDate] = useState(
      today().startsWith(row.period) ? today() : row.period + "-01",
    ),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useMemo(() => crypto.randomUUID(), []);
  return (
    <Modal title={`Horas y bonos · ${name}`} onClose={onClose}>
      <form aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await rpc("rl_log_hours", {
              p: {
                enrollment_id: row.id,
                units,
                kind,
                date,
                note,
                request_id: requestId,
              },
            });
            await reload();
            notify("Movimiento registrado");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            <Field label="Movimiento">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="class">Clase realizada</option>
                <option value="pack">Añadir unidades al bono</option>
                <option value="adjustment">Ajuste de horas</option>
              </select>
            </Field>
            <Field label="Fecha">
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field
              label={kind === "pack" ? "Unidades del bono" : "Horas / unidades"}
            >
              <input
                required
                type="number"
                step="0.25"
                min={kind === "adjustment" ? undefined : 0.25}
                value={units}
                onChange={(e) => setUnits(Number(e.target.value))}
              />
            </Field>
            <Field label="Concepto / motivo">
              <input
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Clase de matemáticas, bono de 4 clases…"
              />
            </Field>
          </div>
          <div className="alert info">
            {kind === "class"
              ? row.billing_mode === "hourly"
                ? `Se añadirán ${money(units * (row.rate || 0))} al pago previsto.`
                : row.billing_mode === "pack"
                  ? `Se descontarán ${units} unidades del bono. Saldo actual: ${qty(row.pack_units)}.`
                  : "La tarifa es manual. Las horas se anotan sin cambiar el importe previsto."
              : "Añadir un bono no registra un cobro. Usa «Registrar cobro» cuando recibas el pago."}
          </div>
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" data-dismiss-modal onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Guardando…" : "Registrar movimiento"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CloneMonth({
  period,
  setPeriod,
  onClose,
  reload,
  notify,
  data,
}: Shared & {
  period: string;
  setPeriod: (s: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState(period),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Preparar un nuevo mes" onClose={onClose}>
      <form aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const n = await rpc<number>("rl_clone_month", {
              source_period: source,
              target_period: target,
            });
            await reload();
            setPeriod(target);
            notify(`${n} inscripciones preparadas`);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Copiar actividades desde">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {[...new Set(data.enrollments.map((e) => e.period))]
                .sort()
                .reverse()
                .map((m) => (
                  <option key={m}>{m}</option>
                ))}
            </select>
          </Field>
          <Field label="Nuevo mes">
            <input
              type="month"
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          <p>
            Se copian los alumnos activos, sus tarifas y horarios. Horas, cobros
            y previsiones empiezan a cero. Se conserva el saldo de los bonos.
          </p>
          {error && <div className="alert error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" data-dismiss-modal onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            Preparar mes
          </button>
        </div>
      </form>
    </Modal>
  );
}
