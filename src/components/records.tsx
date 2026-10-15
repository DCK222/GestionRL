"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Download,
  Pencil,
  Users,
  Wallet,
  ArrowUpRight,
} from "lucide-react";
import type { Shared } from "./workspace";
import type {
  Client,
  Student,
  Expense,
  Invoice,
  Enrollment,
} from "@/lib/types";
import { supabase, rpc } from "@/lib/supabase";
import {
  money,
  dateLabel,
  today,
  csvText,
  download,
  invoicePaid,
} from "@/lib/finance";
import { SectionTitle, Badge, Empty, Modal, Field } from "./ui";
import { invoiceMatchesClient, searchText } from "@/lib/clients";
export function Contacts({
  data,
  canWrite,
  reload,
  notify,
  onInvoices,
}: Shared & { onInvoices: (id: string) => void }) {
  const [tab, setTab] = useState<"clients" | "students">("clients"),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Partial<Client & Student> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState("");
  async function syncClients(manual = true) {
    setSyncing(true);
    setSyncError("");
    try {
      const changed = await rpc<number>("rl_sync_invoice_clients", {});
      if (changed) await reload();
      if (manual)
        notify(
          changed
            ? `${changed} fichas recuperadas o completadas desde las facturas`
            : "Todos los clientes de las facturas ya están en el directorio",
        );
    } catch (e) {
      setSyncError(
        /rl_sync_invoice_clients|schema cache/.test((e as Error).message)
          ? "Ejecuta la actualización 030_clientes_y_hoja.sql en Supabase para activar la recuperación de clientes."
          : (e as Error).message,
      );
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    if (canWrite) void syncClients(false);
  }, [canWrite]);
  const rows = (tab === "clients" ? data.clients : data.students)
    .filter((c) =>
      searchText(
        `${c.name} ${c.email} ${c.phone} ${"tax_id" in c ? c.tax_id : ""}`,
      ).includes(searchText(search)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return (
    <>
      <SectionTitle
        eyebrow="TU DIRECTORIO"
        title="Personas que conectan"
        description="Clientes de facturación, alumnos y contactos de tu academia."
        actions={
          canWrite && (
            <button
              className="primary"
              onClick={() => {
                setEdit({
                  name: "",
                  email: "",
                  phone: "",
                  tax_id: "",
                  address: "",
                  notes: "",
                  active: true,
                });
                setError("");
              }}
            >
              <Plus size={17} />{" "}
              {tab === "clients" ? "Nuevo cliente" : "Nuevo alumno"}
            </button>
          )
        }
      />
      <div className="tabs">
        <button
          className={tab === "clients" ? "active" : ""}
          onClick={() => setTab("clients")}
        >
          Clientes de facturación <Badge>{data.clients.length}</Badge>
        </button>
        <button
          className={tab === "students" ? "active" : ""}
          onClick={() => setTab("students")}
        >
          Alumnos y contactos <Badge>{data.students.length}</Badge>
        </button>
      </div>
      <section className="panel">
        {tab === "clients" && (
          <div className="client-import-bar">
            <span>
              Los datos fiscales de tus facturas se recuperan aquí. Abre sus
              facturas desde cada ficha.
            </span>
            {canWrite && (
              <button disabled={syncing} onClick={() => void syncClients()}>
                {syncing ? "Recuperando…" : "Recuperar clientes de facturas"}
              </button>
            )}
          </div>
        )}
        {syncError && (
          <div className="alert error" role="alert">
            {syncError}
          </div>
        )}
        <div className="table-toolbar">
          <div className="input-search">
            <Search size={17} />
            <input
              placeholder="Buscar nombre, teléfono, correo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() =>
              download(
                `${tab}.csv`,
                csvText(
                  rows.map((c) => ({
                    Nombre: c.name,
                    NIF: "tax_id" in c ? c.tax_id : "",
                    Direccion: "address" in c ? c.address : "",
                    Email: c.email,
                    Telefono: c.phone,
                    Notas: c.notes,
                  })),
                ),
              )
            }
          >
            <Download size={16} /> Exportar
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>{tab === "clients" ? "NIF / CIF" : "Estado"}</th>
                <th>Contacto</th>
                <th>{tab === "clients" ? "Dirección" : "Observaciones"}</th>
                {tab === "clients" && <th>Facturación</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="person-cell">
                      <span className="initials">
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <strong>{c.name}</strong>
                    </div>
                  </td>
                  <td>
                    {"tax_id" in c ? (
                      c.tax_id
                    ) : (
                      <Badge tone={c.active ? "green" : "neutral"}>
                        {c.active ? "Activo" : "Histórico"}
                      </Badge>
                    )}
                  </td>
                  <td>
                    {c.email || "—"}
                    <small>{c.phone}</small>
                  </td>
                  <td className="notes-cell">
                    {"address" in c ? c.address : c.notes}
                  </td>
                  {"tax_id" in c && (
                    <td>
                      <button
                        className="table-link"
                        onClick={() => onInvoices(c.id)}
                      >
                        {
                          data.invoices.filter((i) =>
                            invoiceMatchesClient(i, c),
                          ).length
                        }{" "}
                        facturas →
                      </button>
                      <small>
                        {money(
                          data.invoices
                            .filter(
                              (i) =>
                                invoiceMatchesClient(i, c) &&
                                i.status !== "draft" &&
                                i.environment === "production",
                            )
                            .reduce((sum, i) => sum + i.total, 0),
                        )}{" "}
                        emitidos
                      </small>
                    </td>
                  )}
                  <td>
                    {canWrite && (
                      <button
                        className="icon-button"
                        aria-label={`Editar ${c.name}`}
                        onClick={() => {
                          setEdit(c);
                          setError("");
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty text="Añade tu primer contacto para empezar." />
          )}
        </div>
        <div className="table-footer">{rows.length} contactos</div>
      </section>
      {edit && (
        <Modal
          title={`${edit.id ? "Editar" : "Nuevo"} ${tab === "clients" ? "cliente" : "alumno"}`}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const payload: Record<string, unknown> =
                  tab === "clients"
                    ? {
                        name: edit.name,
                        tax_id: edit.tax_id || "",
                        address: edit.address || "",
                        email: edit.email || "",
                        phone: edit.phone || "",
                        notes: edit.notes || "",
                        active: edit.active,
                      }
                    : {
                        name: edit.name,
                        email: edit.email || "",
                        phone: edit.phone || "",
                        notes: edit.notes || "",
                        active: edit.active,
                      };
                const result = edit.id
                  ? await supabase
                      .from("rl_" + tab)
                      .update(payload)
                      .eq("id", edit.id)
                  : await supabase.from("rl_" + tab).insert(payload);
                if (result.error) throw result.error;
                await reload();
                notify("Contacto guardado");
                setEdit(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body">
              <Field label="Nombre completo / razón social">
                <input
                  required
                  value={edit.name || ""}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              {tab === "clients" && (
                <>
                  <Field label="NIF / CIF">
                    <input
                      value={edit.tax_id || ""}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          tax_id: e.target.value
                            .toUpperCase()
                            .replaceAll(" ", ""),
                        })
                      }
                    />
                  </Field>
                  <Field label="Dirección fiscal">
                    <textarea
                      value={edit.address || ""}
                      onChange={(e) =>
                        setEdit({ ...edit, address: e.target.value })
                      }
                    />
                  </Field>
                </>
              )}
              <div className="form-grid">
                <Field label="Correo / correos de contacto">
                  <input
                    value={edit.email || ""}
                    onChange={(e) =>
                      setEdit({ ...edit, email: e.target.value })
                    }
                  />
                </Field>
                <Field label="Teléfono">
                  <input
                    value={edit.phone || ""}
                    onChange={(e) =>
                      setEdit({ ...edit, phone: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Observaciones">
                <textarea
                  value={edit.notes || ""}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                />
              </Field>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={edit.active ?? true}
                  onChange={(e) =>
                    setEdit({ ...edit, active: e.target.checked })
                  }
                />{" "}
                Contacto activo
              </label>
              {error && <div className="alert error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setEdit(null)}>
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                Guardar contacto
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Expenses({
  data,
  canWrite,
  reload,
  notify,
  period,
}: Shared & { period: string }) {
  const [month, setMonth] = useState(period),
    [filter, setFilter] = useState("all"),
    [edit, setEdit] = useState<Partial<Expense> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const rows = data.expenses
    .filter(
      (e) =>
        e.date.startsWith(month) && (filter === "all" || e.status === filter),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <SectionTitle
        eyebrow="GESTIÓN FINANCIERA"
        title="Gastos y previsiones"
        description="Distingue lo que planeas gastar de los pagos que ya has realizado."
        actions={
          <>
            <input
              aria-label="Mes de gastos"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            {canWrite && (
              <button
                className="primary"
                onClick={() => {
                  setEdit({
                    date: today(),
                    description: "",
                    category: "General",
                    amount: 0,
                    status: "paid",
                    notes: "",
                  });
                  setError("");
                }}
              >
                <Plus size={16} /> Nuevo gasto
              </button>
            )}
          </>
        }
      />
      <div className="tabs">
        {[
          ["all", "Todos"],
          ["paid", "Pagados"],
          ["planned", "Previsiones"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Fecha</th>
              <th>Categoría</th>
              <th>Estado</th>
              <th className="num">Importe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <strong>{e.description}</strong>
                  <small>{e.notes}</small>
                </td>
                <td>{dateLabel(e.date)}</td>
                <td>{e.category}</td>
                <td>
                  <Badge tone={e.status === "paid" ? "green" : "amber"}>
                    {e.status === "paid" ? "Pagado" : "Previsto"}
                  </Badge>
                </td>
                <td className="num strong">{money(e.amount)}</td>
                <td>
                  {canWrite && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setEdit(e);
                        setError("");
                      }}
                    >
                      {e.status === "planned"
                        ? "Revisar / registrar pago"
                        : "Editar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty text="No hay gastos en este periodo." />}
      </section>
      {edit && (
        <Modal
          title={edit.id ? "Revisar gasto" : "Nuevo gasto"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const payload = {
                  date: edit.date,
                  description: edit.description,
                  category: edit.category,
                  amount: edit.amount,
                  status: edit.status,
                  notes: edit.notes,
                };
                const result = edit.id
                  ? await supabase
                      .from("rl_expenses")
                      .update(payload)
                      .eq("id", edit.id)
                  : await supabase.from("rl_expenses").insert(payload);
                if (result.error) throw result.error;
                await reload();
                notify("Gasto guardado");
                setEdit(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body">
              <Field label="Concepto">
                <input
                  required
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                />
              </Field>
              <div className="form-grid">
                <Field label="Fecha">
                  <input
                    required
                    type="date"
                    value={edit.date}
                    onChange={(e) => setEdit({ ...edit, date: e.target.value })}
                  />
                </Field>
                <Field label="Importe (€)">
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={edit.amount}
                    onChange={(e) =>
                      setEdit({ ...edit, amount: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Categoría">
                  <input
                    required
                    value={edit.category}
                    onChange={(e) =>
                      setEdit({ ...edit, category: e.target.value })
                    }
                  />
                </Field>
                <Field label="Estado">
                  <select
                    value={edit.status}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        status: e.target.value as Expense["status"],
                      })
                    }
                  >
                    <option value="planned">
                      Previsto · todavía sin pagar
                    </option>
                    <option value="paid">Pagado</option>
                  </select>
                </Field>
              </div>
              <Field label="Observaciones">
                <textarea
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                />
              </Field>
              {error && <div className="alert error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setEdit(null)}>
                Cancelar
              </button>
              <button className="primary" disabled={busy}>
                Guardar gasto
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Cashbook(shared: Shared) {
  const { data, canWrite } = shared;
  const [open, setOpen] = useState(false);
  const rows = [...data.payments].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <SectionTitle
        eyebrow="COBROS"
        title="Cada pago, registrado"
        description="Recibos nuevos y cobros parciales vinculados a tus facturas o clases."
        actions={
          canWrite && (
            <button className="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> Registrar ingreso
            </button>
          )
        }
      />
      <div className="alert info">
        Los importes históricos «Pagado» del Excel están en Clases e ingresos.
        Aquí aparecen los cobros registrados desde la aplicación.
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Fecha</th>
              <th>Método</th>
              <th>Vinculado a</th>
              <th className="num">Importe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.description}</strong>
                  <small>{p.notes}</small>
                </td>
                <td>{dateLabel(p.date)}</td>
                <td>{p.method}</td>
                <td>
                  {p.invoice_id
                    ? data.invoices.find((i) => i.id === p.invoice_id)?.number
                    : p.enrollment_id
                      ? "Registro de clases"
                      : "Ingreso independiente"}
                </td>
                <td className="num positive">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty
            title="Todo preparado para el próximo cobro"
            text="Registra un ingreso desde aquí o desde su factura o inscripción."
          />
        )}
      </section>
      {open && (
        <Modal title="Registrar ingreso" onClose={() => setOpen(false)}>
          <PaymentForm {...shared} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
export function PaymentForm({
  invoice,
  enrollment,
  onClose,
  data,
  reload,
  notify,
}: Shared & {
  invoice?: Invoice;
  enrollment?: Enrollment;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(
      invoice
        ? Math.max(0, invoice.total - invoicePaid(invoice, data.payments))
        : enrollment?.expected || 0,
    ),
    [date, setDate] = useState(today()),
    [method, setMethod] = useState("Transferencia"),
    [description, setDescription] = useState(
      invoice
        ? `Cobro ${invoice.number}`
        : enrollment
          ? `Clases · ${data.students.find((s) => s.id === enrollment.student_id)?.name || enrollment.category}`
          : "",
    ),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const id = useMemo(() => crypto.randomUUID(), []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await rpc("rl_record_payment", {
            p: {
              id,
              amount,
              date,
              method,
              description,
              notes,
              invoice_id: invoice?.id || null,
              enrollment_id: enrollment?.id || null,
            },
          });
          await reload();
          notify("Cobro registrado");
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
          <Field label="Importe recibido (€)">
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              max={
                invoice
                  ? invoice.total - invoicePaid(invoice, data.payments)
                  : undefined
              }
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="Fecha de cobro">
            <input
              required
              type="date"
              max={today()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Método de pago">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {["Transferencia", "Bizum", "Efectivo", "Tarjeta", "Otro"].map(
                (m) => (
                  <option key={m}>{m}</option>
                ),
              )}
            </select>
          </Field>
          <Field label="Concepto">
            <input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Referencia / observaciones">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {invoice?.status === "imported" && (
          <label className="check-field alert warning">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            He comprobado que este cobro no está ya incluido en los importes del
            Excel.
          </label>
        )}
        {enrollment && (
          <p className="subtle-note">
            Se sumará a «Pagado» de la inscripción y reducirá su pago previsto.
            La operación quedará registrada.
          </p>
        )}
        {error && <div className="alert error">{error}</div>}
      </div>
      <div className="modal-footer">
        <button type="button" onClick={onClose}>
          Cancelar
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Registrando…" : "Registrar cobro"}
        </button>
      </div>
    </form>
  );
}
