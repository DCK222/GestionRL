"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { qrUrl } from "@/lib/qr";
import {
  Plus,
  Search,
  Download,
  Printer,
  ReceiptText,
  ArrowLeft,
  Copy,
  Check,
  Trash2,
  Send,
  Wallet,
} from "lucide-react";
import type { Shared } from "./workspace";
import type { Invoice, Line, Quote } from "@/lib/types";
import { supabase, rpc, api } from "@/lib/supabase";
import {
  money,
  dateLabel,
  today,
  calculateInvoice,
  invoiceState,
  invoicePaid,
  csvText,
  download,
} from "@/lib/finance";
import { SectionTitle, Badge, Empty, Modal, Field } from "./ui";
import { PaymentForm } from "./records";
import { invoiceMatchesClient, searchText } from "@/lib/clients";
import { Quotes } from "./quotes";
export async function downloadDocument(id: string) {
  const { data, error } = await supabase
    .from("rl_documents")
    .select("name,mime,content_base64")
    .eq("id", id)
    .single();
  if (error) throw error;
  const bytes = Uint8Array.from(atob(data.content_base64), (c) =>
    c.charCodeAt(0),
  );
  download(data.name, bytes, data.mime);
}
export function Invoices(shared: Shared & { initialClientId?: string }) {
  const [tab, setTab] = useState<"invoices" | "quotes">("invoices");
  const [invoiceId, setInvoiceId] = useState<string | undefined>();
  const [quoteId, setQuoteId] = useState<string | undefined>();
  return (
    <>
      <div className="tabs no-print" aria-label="Documentos de facturación">
        <button
          className={tab === "invoices" ? "active" : ""}
          aria-pressed={tab === "invoices"}
          onClick={() => {
            setQuoteId(undefined);
            setInvoiceId(undefined);
            setTab("invoices");
          }}
        >
          Facturas ({shared.data.invoices.length})
        </button>
        <button
          className={tab === "quotes" ? "active" : ""}
          aria-pressed={tab === "quotes"}
          onClick={() => {
            setInvoiceId(undefined);
            setQuoteId(undefined);
            setTab("quotes");
          }}
        >
          Presupuestos ({shared.data.quotes.length})
        </button>
      </div>
      {tab === "invoices" ? (
        <InvoiceList
          {...shared}
          initialInvoiceId={invoiceId}
          onQuote={(id) => {
            setInvoiceId(undefined);
            setQuoteId(id);
            setTab("quotes");
          }}
        />
      ) : (
        <Quotes
          {...shared}
          initialQuoteId={quoteId}
          onInvoice={(id) => {
            setQuoteId(undefined);
            setInvoiceId(id);
            setTab("invoices");
          }}
        />
      )}
    </>
  );
}
function InvoiceList(
  shared: Shared & {
    initialClientId?: string;
    initialInvoiceId?: string;
    onQuote: (id: string) => void;
  },
) {
  const { data, canWrite, notify, reload } = shared;
  const [search, setSearch] = useState(""),
    [clientId, setClientId] = useState(shared.initialClientId || "all"),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [sort, setSort] = useState("newest"),
    [status, setStatus] = useState("all"),
    [year, setYear] = useState("all"),
    [editing, setEditing] = useState<Partial<Invoice> | null>(null),
    [view, setView] = useState<string | null>(shared.initialInvoiceId || null),
    [pay, setPay] = useState<Invoice | null>(null),
    [busy, setBusy] = useState(false),
    [issue, setIssue] = useState<Invoice | null>(null);
  const canEdit = (invoice: Invoice) =>
    invoice.status === "draft" ||
    (!data.settings?.verifactu_enabled &&
      !data.fiscal.some((r) => r.invoice_id === invoice.id));
  const selected = data.invoices.find((i) => i.id === view);
  const sourceQuote =
    selected && data.quotes.find((q) => q.invoice_id === selected.id);
  const filterClient = data.clients.find((c) => c.id === clientId);
  const rows = data.invoices
    .filter(
      (i) =>
        searchText(
          `${i.number || "Borrador"} ${i.client_snapshot.name} ${i.client_snapshot.tax_id} ${i.notes} ${i.lines.map((l) => l.description).join(" ")}`,
        ).includes(searchText(search)) &&
        (clientId === "all" ||
          (filterClient && invoiceMatchesClient(i, filterClient))) &&
        (!dateFrom || i.date >= dateFrom) &&
        (!dateTo || i.date <= dateTo) &&
        (year === "all" || i.date.startsWith(year)) &&
        (status === "all" || invoiceState(i, data.payments) === status),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? a.date.localeCompare(b.date)
        : sort === "amount"
          ? b.total - a.total
          : b.date.localeCompare(a.date),
    );
  function draft() {
    setEditing({
      date: today(),
      due_date: "",
      project_date: today(),
      lines: [
        { description: "", quantity: 1, price: 0, discount: 0, vat_rate: 0 },
      ],
      withholding_rate: 0,
      invoice_type: "F1",
      client_id: filterClient?.id || data.clients[0]?.id || "",
      environment: data.settings?.verifactu_enabled
        ? data.settings.verifactu_environment
        : "production",
      exemption: data.settings?.company.exemption,
      payment_terms: data.settings?.company.payment_terms,
    });
  }
  function duplicate(i: Invoice, rectify = false) {
    setEditing({
      client_id: i.client_id,
      date: today(),
      due_date: "",
      project_date: today(),
      location: i.location,
      lines: i.lines.map((l) => ({
        ...l,
        quantity: l.historical_amount ? 1 : l.quantity,
        price:
          (l.historical_amount ? (l.base ?? 0) : l.price) * (rectify ? -1 : 1),
        historical_amount: false,
      })),
      withholding_rate: i.withholding_rate,
      invoice_type: rectify ? "R1" : "F1",
      rectifies: rectify ? i.id : null,
      notes: rectify ? `Rectificación por diferencias de ${i.number}` : "",
      exemption: i.exemption,
      payment_terms: i.payment_terms,
      environment: data.settings?.verifactu_enabled
        ? data.settings.verifactu_environment
        : "production",
    });
  }
  async function issueNow() {
    if (!issue || busy) return;
    let deliveryPending = false;
    setBusy(true);
    try {
      await rpc("rl_issue_invoice", { invoice: issue.id });
      if (data.settings?.verifactu_enabled) {
        try {
          await api("/api/verifactu", { action: "process" });
        } catch {
          deliveryPending = true;
        }
      }
      setIssue(null);
      await reload();
      if (!data.settings?.verifactu_enabled)
        notify(
          "Factura emitida. Puedes editarla mientras VeriFactu esté desactivado y no tenga registro fiscal.",
        );
      if (data.settings?.verifactu_enabled)
        notify(
          deliveryPending
            ? "Factura emitida. Envío pendiente en la cola VeriFactu. Consulta Configuración → VeriFactu."
            : "Registro fiscal creado. Consulta su envío en Configuración → VeriFactu.",
          deliveryPending,
        );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SectionTitle
        eyebrow="FACTURACIÓN"
        title="Tus facturas, en orden"
        description="Crea documentos con la identidad de Roboticlab y conserva su trazabilidad."
        actions={
          <>
            <button
              onClick={() =>
                download(
                  "facturas.csv",
                  csvText(
                    rows.map((i) => ({
                      Numero: i.number,
                      Fecha: i.date,
                      Cliente: i.client_snapshot.name,
                      NIF: i.client_snapshot.tax_id,
                      Base: i.subtotal,
                      IVA: i.vat,
                      IRPF: i.withholding,
                      Total: i.total,
                      Estado: invoiceState(i, data.payments),
                    })),
                  ),
                )
              }
            >
              <Download size={16} /> Exportar
            </button>
            {canWrite && (
              <button className="primary" onClick={draft}>
                <Plus size={17} /> Nueva factura
              </button>
            )}
          </>
        }
      />
      <div className="invoice-summary">
        <div>
          <span>Facturas</span>
          <strong>{data.invoices.length}</strong>
        </div>
        <div>
          <span>Importe neto emitido</span>
          <strong>
            {money(
              data.invoices
                .filter(
                  (i) => i.status !== "draft" && i.environment === "production",
                )
                .reduce((a, i) => a + i.total, 0),
            )}
          </strong>
        </div>
        <div>
          <span>Por conciliar</span>
          <strong>
            {
              data.invoices.filter(
                (i) => invoiceState(i, data.payments) === "Por conciliar",
              ).length
            }
          </strong>
        </div>
        <div>
          <span>Borradores</span>
          <strong>
            {data.invoices.filter((i) => i.status === "draft").length}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-search">
            <Search size={17} />
            <input
              aria-label="Buscar facturas"
              placeholder="Número, cliente, NIF o concepto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filters">
            <select
              aria-label="Cliente de factura"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="all">Todos los clientes</option>
              {[...data.clients]
                .sort((a, b) => a.name.localeCompare(b.name, "es"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              aria-label="Estado de factura"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "all",
                "Borrador",
                "Pendiente",
                "Por conciliar",
                "Cobrada",
                "Cobro parcial",
                "Vencida",
                "Prueba",
                "Rectificativa",
              ].map((x) => (
                <option key={x} value={x}>
                  {x === "all" ? "Todos los estados" : x}
                </option>
              ))}
            </select>
            <select
              aria-label="Año de factura"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="all">Todos los años</option>
              {[...new Set(data.invoices.map((i) => i.date.slice(0, 4)))]
                .sort()
                .map((y) => (
                  <option key={y}>{y}</option>
                ))}
            </select>
          </div>
        </div>
        <div className="invoice-filter-bar">
          <label>
            Desde{" "}
            <input
              type="date"
              aria-label="Facturas desde"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta{" "}
            <input
              type="date"
              aria-label="Facturas hasta"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <select
            aria-label="Ordenar facturas"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Más recientes</option>
            <option value="oldest">Más antiguas</option>
            <option value="amount">Mayor importe</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setClientId("all");
              setStatus("all");
              setYear("all");
              setDateFrom("");
              setDateTo("");
              setSort("newest");
            }}
          >
            Limpiar filtros
          </button>
          <strong>
            {rows.length} resultados ·{" "}
            {money(rows.reduce((sum, i) => sum + i.total, 0))}
          </strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Factura</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th className="num">Importe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => setView(i.id)}
                    >
                      <ReceiptText size={16} />
                      {i.number || "Borrador"}
                    </button>
                  </td>
                  <td>
                    <strong className="cell-title">
                      {i.client_snapshot.name}
                    </strong>
                    <small>{i.client_snapshot.tax_id}</small>
                  </td>
                  <td>{dateLabel(i.date)}</td>
                  <td>
                    <Badge
                      tone={
                        invoiceState(i, data.payments) === "Cobrada"
                          ? "green"
                          : i.status === "draft"
                            ? "neutral"
                            : "blue"
                      }
                    >
                      {invoiceState(i, data.payments)}
                    </Badge>
                  </td>
                  <td className="num strong">{money(i.total)}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setView(i.id)}
                    >
                      Ver factura →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty text="Crea una factura o cambia los filtros de búsqueda." />
          )}
        </div>
        <div className="table-footer">
          {rows.length} documentos{" "}
          <span>EUR · Importes con IVA y retención aplicados</span>
        </div>
      </section>
      {selected && (
        <Modal
          title={selected.number || "Borrador de factura"}
          onClose={() => setView(null)}
          wide
        >
          <div className="document-actions">
            {sourceQuote && (
              <button onClick={() => shared.onQuote(sourceQuote.id)}>
                Ver presupuesto {sourceQuote.number}
              </button>
            )}
            <button onClick={() => window.print()}>
              <Printer size={16} /> Imprimir / PDF
            </button>
            {selected.document_id && (
              <button
                onClick={() =>
                  void downloadDocument(selected.document_id!).catch((e) =>
                    notify(e.message, true),
                  )
                }
              >
                <Download size={16} /> PDF original
              </button>
            )}
            {canWrite && (
              <>
                <button onClick={() => duplicate(selected)}>
                  <Copy size={16} /> Duplicar
                </button>
                {canEdit(selected) && (
                  <button onClick={() => setEditing(selected)}>
                    {selected.status === "draft"
                      ? "Editar borrador"
                      : "Editar factura"}
                  </button>
                )}
                {selected.status === "draft" ? (
                  <>
                    <button
                      className="primary"
                      onClick={() => setIssue(selected)}
                    >
                      <Check size={16} /> Emitir
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => duplicate(selected, true)}>
                      Rectificar
                    </button>
                    {selected.total > 0 &&
                      selected.environment === "production" &&
                      invoicePaid(selected, data.payments) < selected.total && (
                        <button
                          className="primary"
                          onClick={() => setPay(selected)}
                        >
                          <Wallet size={16} /> Registrar cobro
                        </button>
                      )}
                  </>
                )}
              </>
            )}
          </div>
          {selected.status === "imported" && (
            <div className="alert info no-print">
              Documento histórico. El PDF original conserva exactamente el
              diseño y los importes de la factura aportada. Verifica los cobros
              antes de añadirlos para evitar duplicados con el Excel.
            </div>
          )}
          <InvoicePaper
            invoice={selected}
            fiscal={data.fiscal.some((r) => r.invoice_id === selected.id)}
          />
        </Modal>
      )}
      {pay && (
        <Modal title="Registrar cobro de factura" onClose={() => setPay(null)}>
          <PaymentForm
            {...shared}
            invoice={data.invoices.find((i) => i.id === pay.id) || pay}
            onClose={() => setPay(null)}
          />
        </Modal>
      )}
      {issue && (
        <Modal title="Emitir factura" onClose={() => setIssue(null)}>
          <div className="modal-body">
            <p>
              Se asignará el siguiente número de su serie a la factura de{" "}
              <strong>{issue.client_snapshot.name}</strong> por{" "}
              <strong>{money(issue.total)}</strong>.
            </p>
            <p>
              {data.settings?.verifactu_enabled
                ? "Una vez emitida, las correcciones se realizarán mediante una factura rectificativa."
                : "VeriFactu está desactivado. Podrás editar la factura conservando su número y el historial de cambios."}
            </p>
            <Badge tone={issue.environment === "test" ? "amber" : "blue"}>
              {issue.environment === "test"
                ? "PRUEBA · sin validez fiscal"
                : data.settings?.verifactu_enabled
                  ? "Producción · VeriFactu"
                  : "Sin VeriFactu"}
            </Badge>
            {data.settings?.verifactu_enabled && (
              <p>
                Se creará su registro VeriFactu encadenado y se pondrá en la
                cola de envío.
              </p>
            )}
          </div>
          <div className="modal-footer" aria-busy={busy}>
            <button
              data-dismiss-modal
              disabled={busy}
              onClick={() => setIssue(null)}
            >
              Volver
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void issueNow()}
            >
              {busy ? "Emitiendo…" : "Emitir factura"}
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <InvoiceEditor
          {...shared}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
type EditableDocument = Partial<Omit<Invoice, "status">> & {
  status?: Invoice["status"] | Quote["status"];
  valid_until?: string | null;
};
export function InvoiceEditor({
  initial,
  onClose,
  quote = false,
  ...shared
}: Shared & {
  initial: EditableDocument;
  onClose: () => void;
  quote?: boolean;
}) {
  const { data, notify, reload } = shared;
  const [form, setForm] = useState(() => ({
      ...initial,
      id: initial.id || crypto.randomUUID(),
      version: initial.version ?? 0,
      lines: initial.lines?.map((l) =>
        l.historical_amount
          ? {
              ...l,
              quantity: 1,
              price: l.base ?? 0,
              discount: 0,
              historical_amount: false,
            }
          : { ...l },
      ),
    })),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lines = form.lines || [];
  const lineEditor = useRef<HTMLTableElement>(null);
  const focusNewLine = useRef(false);
  useEffect(() => {
    if (!focusNewLine.current) return;
    focusNewLine.current = false;
    const inputs = lineEditor.current?.querySelectorAll("textarea");
    const input = inputs?.[inputs.length - 1];
    input?.focus();
    input?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);
  const existing = !!initial.id;
  const issued = !quote && !!initial.status && initial.status !== "draft";
  const submitting = useRef(false);
  const totals = calculateInvoice(lines, form.withholding_rate || 0);
  function field<K extends keyof EditableDocument>(
    key: K,
    v: EditableDocument[K],
  ) {
    setForm((f) => ({ ...f, [key]: v }));
  }
  function line(index: number, key: keyof Line, value: string | number) {
    setForm((f) => ({
      ...f,
      lines: (f.lines || []).map((l, i) =>
        i === index ? { ...l, [key]: value } : l,
      ),
    }));
  }
  function addLine() {
    focusNewLine.current = true;
    setForm((f) => ({
      ...f,
      lines: [
        ...(f.lines || []),
        { description: "", quantity: 1, price: 0, discount: 0, vat_rate: 0 },
      ],
    }));
  }
  return (
    <Modal
      title={
        quote
          ? existing
            ? "Editar presupuesto"
            : "Nuevo presupuesto"
          : issued
            ? "Editar factura"
            : existing
              ? "Editar borrador"
              : "Nueva factura"
      }
      onClose={onClose}
      wide
    >
      <form
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          setError("");
          try {
            await rpc(quote ? "rl_save_quote" : "rl_save_invoice", { p: form });
            await reload();
            notify(
              quote
                ? "Presupuesto guardado."
                : issued
                  ? "Factura actualizada. Se conserva su número y queda registrado el cambio."
                  : "Borrador guardado. Puedes revisarlo antes de emitir.",
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          {quote && existing && (
            <div className="alert info">
              Al guardar cambios, el presupuesto vuelve a borrador para revisar
              su contenido antes de marcarlo como enviado o aceptado.
            </div>
          )}
          {issued && (
            <div className="alert info">
              Editando {initial.number}. Se conserva la numeración, los cobros y
              el historial. El PDF original, si existe, conserva el documento
              importado.
            </div>
          )}
          <div className="form-grid three">
            <Field label="Cliente">
              <select
                required
                value={form.client_id || ""}
                onChange={(e) => field("client_id", e.target.value)}
              >
                <option value="">Seleccionar cliente</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={quote ? "Fecha de presupuesto" : "Fecha de factura"}>
              <input
                type="date"
                required
                max={today()}
                value={form.date || ""}
                onChange={(e) => field("date", e.target.value)}
              />
            </Field>
            <Field label={quote ? "Válido hasta" : "Vencimiento"}>
              <input
                type="date"
                min={quote ? form.date : undefined}
                value={(quote ? form.valid_until : form.due_date) || ""}
                onChange={(e) =>
                  field(quote ? "valid_until" : "due_date", e.target.value)
                }
              />
            </Field>
            <Field label="Fecha del proyecto">
              <input
                type="date"
                value={form.project_date || ""}
                onChange={(e) => field("project_date", e.target.value)}
              />
            </Field>
            <Field label="Ubicación del proyecto">
              <input
                value={form.location || ""}
                onChange={(e) => field("location", e.target.value)}
              />
            </Field>
            {!quote && (
              <Field label="Entorno">
                <select
                  value={form.environment}
                  disabled={issued}
                  onChange={(e) =>
                    field(
                      "environment",
                      e.target.value as Invoice["environment"],
                    )
                  }
                >
                  <option value="production">Producción</option>
                  <option value="test">Pruebas · sin validez fiscal</option>
                </select>
              </Field>
            )}
          </div>
          {form.rectifies && (
            <div className="alert info">
              Rectificativa por diferencias de{" "}
              {data.invoices.find((i) => i.id === form.rectifies)?.number}.
              Indica el motivo en las observaciones.
            </div>
          )}
          <div className="invoice-lines-toolbar">
            <div>
              <h3>
                {quote
                  ? "Conceptos del presupuesto"
                  : "Conceptos de la factura"}
              </h3>
              <span aria-live="polite">
                {lines.length} {lines.length === 1 ? "línea" : "líneas"} · Añade
                un concepto por servicio o producto.
              </span>
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={addLine}
            >
              <Plus size={17} /> Añadir línea
            </button>
          </div>
          <div className="table-wrap">
            <table className="line-editor" ref={lineEditor}>
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>Cantidad</th>
                  <th>Precio €</th>
                  <th>Dto. %</th>
                  <th>IVA %</th>
                  <th className="num">Base</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td data-label={`Descripción ${i + 1}`}>
                      <textarea
                        aria-label={`Descripción ${i + 1}`}
                        required
                        value={l.description}
                        onChange={(e) => line(i, "description", e.target.value)}
                      />
                    </td>
                    <td data-label="Cantidad">
                      <input
                        aria-label={`Cantidad ${i + 1}`}
                        required
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={l.quantity}
                        onChange={(e) =>
                          line(i, "quantity", Number(e.target.value))
                        }
                      />
                    </td>
                    <td data-label="Precio €">
                      <input
                        aria-label={`Precio ${i + 1}`}
                        required
                        type="number"
                        step="0.0001"
                        min={form.invoice_type === "F1" ? 0 : undefined}
                        value={l.price}
                        onChange={(e) =>
                          line(i, "price", Number(e.target.value))
                        }
                      />
                    </td>
                    <td data-label="Dto. %">
                      <input
                        aria-label={`Descuento ${i + 1}`}
                        required
                        type="number"
                        min="0"
                        max="100"
                        value={l.discount}
                        onChange={(e) =>
                          line(i, "discount", Number(e.target.value))
                        }
                      />
                    </td>
                    <td data-label="IVA %">
                      <select
                        aria-label={`IVA ${i + 1}`}
                        value={l.vat_rate}
                        onChange={(e) =>
                          line(i, "vat_rate", Number(e.target.value))
                        }
                      >
                        {[0, 4, 10, 21].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num" data-label="Base">
                      {money(calculateInvoice([l], 0).subtotal)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Eliminar línea ${i + 1}`}
                        disabled={busy || lines.length === 1}
                        onClick={() =>
                          field(
                            "lines",
                            lines.filter((_, n) => i !== n),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="add-invoice-line"
            disabled={busy}
            onClick={addLine}
          >
            <Plus size={16} /> Añadir otra línea
          </button>
          <div className="form-grid">
            <div>
              <Field label="Retención IRPF (%)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.withholding_rate || 0}
                  onChange={(e) =>
                    field("withholding_rate", Number(e.target.value))
                  }
                />
              </Field>
              <Field label="Motivo de exención de IVA">
                <textarea
                  value={form.exemption || ""}
                  onChange={(e) => field("exemption", e.target.value)}
                />
              </Field>
              <Field label="Forma y condiciones de pago">
                <textarea
                  value={form.payment_terms || ""}
                  onChange={(e) => field("payment_terms", e.target.value)}
                />
              </Field>
              <Field
                label={
                  quote
                    ? "Observaciones del presupuesto"
                    : "Observaciones / motivo de rectificación"
                }
              >
                <textarea
                  required={!!form.rectifies}
                  value={form.notes || ""}
                  onChange={(e) => field("notes", e.target.value)}
                />
              </Field>
            </div>
            <div className="invoice-totals">
              <div>
                Base imponible<strong>{money(totals.subtotal)}</strong>
              </div>
              <div>
                IVA<strong>{money(totals.vat)}</strong>
              </div>
              <div>
                Retención IRPF<strong>−{money(totals.withholding)}</strong>
              </div>
              <div className="total">
                {quote ? "Total del presupuesto" : "Total a cobrar"}
                <strong>{money(totals.total)}</strong>
              </div>
            </div>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" data-dismiss-modal onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !data.clients.length}>
            {busy
              ? "Guardando…"
              : quote
                ? "Guardar presupuesto"
                : issued
                  ? "Guardar cambios"
                  : "Guardar borrador"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function InvoicePaper({
  invoice: i,
  fiscal = false,
  quote = false,
}: {
  invoice: Invoice | Quote;
  fiscal?: boolean;
  quote?: boolean;
}) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    setQr("");
    if (fiscal && !quote)
      void QRCode.toDataURL(qrUrl(i as Invoice), {
        width: 160,
        margin: 2,
        errorCorrectionLevel: "M",
      }).then(setQr);
  }, [i.id, fiscal, quote]);
  return (
    <article className="invoice-paper" id="invoice-print">
      <div className="invoice-head">
        <div>
          <img src="/logo.webp" alt="Roboticlab" />
          <strong>{i.issuer_snapshot.name}</strong>
          <span>NIF {i.issuer_snapshot.tax_id}</span>
          <span className="pre-line">{i.issuer_snapshot.address}</span>
          <span>{i.issuer_snapshot.email}</span>
          <span>{i.issuer_snapshot.website}</span>
        </div>
        <div className="invoice-client">
          <strong>{i.client_snapshot.name}</strong>
          <span className="pre-line">{i.client_snapshot.address}</span>
          <span>CIF / NIF: {i.client_snapshot.tax_id}</span>
        </div>
      </div>
      {(quote || i.status === "draft" || i.environment === "test") && (
        <div className="watermark">
          {quote
            ? "PRESUPUESTO · SIN VALIDEZ FISCAL"
            : i.environment === "test"
              ? "PRUEBA · SIN VALIDEZ FISCAL"
              : "BORRADOR · SIN VALIDEZ FISCAL"}
        </div>
      )}
      <div className="invoice-heading">
        <div>
          <h2>
            {quote ? "Presupuesto" : "Factura"} nº {i.number || "BORRADOR"}
          </h2>
          {i.invoice_type !== "F1" && (
            <b>Factura rectificativa por diferencias</b>
          )}
          {i.location && <span>Ubicación del proyecto: {i.location}</span>}
          {i.project_date && (
            <span>Fecha proyecto: {dateLabel(i.project_date)}</span>
          )}
        </div>
        <span>A fecha de {dateLabel(i.date)}</span>
      </div>
      {quote && "valid_until" in i && i.valid_until && (
        <p>Válido hasta: {dateLabel(i.valid_until)}</p>
      )}
      <table className="invoice-lines">
        <thead>
          <tr>
            <th>Nº</th>
            <th>Descripción</th>
            <th className="num">P/Unidad</th>
            <th className="num">Cantidad</th>
            <th className="num">PVP</th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l, n) => (
            <tr key={n}>
              <td>{n + 1}</td>
              <td>
                {l.description}
                {l.discount > 0 && <small>Descuento {l.discount}%</small>}
              </td>
              <td className="num">{money(l.price)}</td>
              <td className="num">
                {l.quantity} {l.unit || ""}
              </td>
              <td className="num">
                {money(l.base ?? calculateInvoice([l], 0).subtotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-totals">
        <div>
          Base imponible<strong>{money(i.subtotal)}</strong>
        </div>
        {i.vat !== 0 && (
          <div>
            IVA<strong>{money(i.vat)}</strong>
          </div>
        )}
        {i.withholding !== 0 && (
          <div>
            Retención IRPF −{i.withholding_rate}%
            <strong>−{money(i.withholding)}</strong>
          </div>
        )}
        <div className="total">
          Total<strong>{money(i.total)}</strong>
        </div>
      </div>
      <div className="invoice-payment">
        <strong>Condiciones y forma de pago:</strong>
        <p>{i.payment_terms}</p>
        <p>Número de cuenta: {i.issuer_snapshot.iban}</p>
        <p>{i.issuer_snapshot.name}</p>
        {i.due_date && <p>Vencimiento: {dateLabel(i.due_date)}</p>}
        <em>{i.exemption}</em>
        {i.notes && !i.document_id && <p className="pre-line">{i.notes}</p>}
      </div>
      {qr && (
        <div className="fiscal-qr">
          <img src={qr} alt="Código QR de verificación AEAT" />
          <span>
            VERI*FACTU
            <br />
            Factura verificable en la sede electrónica de la AEAT
            {i.environment === "test" && <strong>ENTORNO DE PRUEBAS</strong>}
          </span>
        </div>
      )}
      <footer>
        ROBOTICLAB
        <br />
        email: {i.issuer_snapshot.email}
      </footer>
    </article>
  );
}
