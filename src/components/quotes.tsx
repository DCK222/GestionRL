"use client";
import { useRef, useState } from "react";
import { ArrowRight, Download, Plus, Printer, Search } from "lucide-react";
import type { Quote } from "@/lib/types";
import { rpc } from "@/lib/supabase";
import { csvText, dateLabel, download, money, today } from "@/lib/finance";
import { searchText } from "@/lib/clients";
import type { Shared } from "./workspace";
import { Badge, Empty, Modal, SectionTitle } from "./ui";
import { InvoiceEditor, InvoicePaper } from "./invoices";

const states: Record<Quote["status"], string> = {
  draft: "Borrador",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  converted: "Convertido en factura",
};
export function Quotes({
  onInvoice,
  initialClientId,
  initialQuoteId,
  ...shared
}: Shared & {
  initialClientId?: string;
  initialQuoteId?: string;
  onInvoice: (id: string) => void;
}) {
  const { data, canWrite, reload, notify } = shared;
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState(initialClientId || "all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<Partial<Quote> | null>(null);
  const [view, setView] = useState<string | null>(initialQuoteId || null);
  const [convert, setConvert] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const selected = data.quotes.find((q) => q.id === view);
  const invoice = data.invoices.find((i) => i.id === selected?.invoice_id);
  const expired = (q: Quote) =>
    q.status !== "converted" &&
    q.status !== "rejected" &&
    !!q.valid_until &&
    q.valid_until < today();
  const label = (q: Quote) =>
    expired(q) ? `${states[q.status]} · Caducado` : states[q.status];
  const rows = data.quotes
    .filter(
      (q) =>
        searchText(
          `${q.number} ${q.client_snapshot.name} ${q.client_snapshot.tax_id} ${q.notes} ${q.lines.map((l) => l.description).join(" ")}`,
        ).includes(searchText(search)) &&
        (clientId === "all" || q.client_id === clientId) &&
        (status === "all" ||
          (status === "expired" ? expired(q) : q.status === status)) &&
        (!from || q.date >= from) &&
        (!to || q.date <= to),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.number.localeCompare(a.number),
    );
  function create() {
    setEditing({
      date: today(),
      valid_until: "",
      project_date: today(),
      client_id: clientId === "all" ? data.clients[0]?.id || "" : clientId,
      lines: [
        { description: "", quantity: 1, price: 0, discount: 0, vat_rate: 0 },
      ],
      withholding_rate: 0,
      invoice_type: "F1",
      environment: "production",
      exemption: data.settings?.company.exemption,
      payment_terms: data.settings?.company.payment_terms,
    });
  }
  async function changeState(q: Quote, next: Quote["status"]) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await rpc("rl_set_quote_status", {
        quote: q.id,
        expected_version: q.version,
        next_status: next,
      });
      await reload();
      notify(`Presupuesto marcado como ${states[next].toLowerCase()}.`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function convertNow() {
    if (!convert || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const id = await rpc<string>("rl_convert_quote", {
        quote: convert.id,
        expected_version: convert.version,
      });
      setConvert(null);
      await reload();
      notify(
        "Borrador de factura creado a partir del presupuesto. Revísalo y emítelo cuando esté listo.",
      );
      onInvoice(id);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <SectionTitle
        eyebrow="FACTURACIÓN"
        title="Tus presupuestos, listos para facturar"
        description="Prepara una propuesta y conviértela en factura conservando todos sus conceptos e importes."
        actions={
          <>
            <button
              onClick={() =>
                download(
                  "presupuestos.csv",
                  csvText(
                    rows.map((q) => ({
                      Numero: q.number,
                      Fecha: q.date,
                      Cliente: q.client_snapshot.name,
                      NIF: q.client_snapshot.tax_id,
                      Validez: q.valid_until,
                      Base: q.subtotal,
                      IVA: q.vat,
                      IRPF: q.withholding,
                      Total: q.total,
                      Estado: label(q),
                      Factura:
                        data.invoices.find((i) => i.id === q.invoice_id)
                          ?.number || (q.invoice_id ? "Borrador" : ""),
                    })),
                  ),
                )
              }
            >
              <Download size={16} /> Exportar
            </button>
            {canWrite && (
              <button className="primary" onClick={create}>
                <Plus size={17} /> Nuevo presupuesto
              </button>
            )}
          </>
        }
      />
      <div className="invoice-summary">
        <div>
          <span>Presupuestos</span>
          <strong>{data.quotes.length}</strong>
        </div>
        <div>
          <span>Pendientes de respuesta</span>
          <strong>
            {
              data.quotes.filter((q) => q.status === "sent" && !expired(q))
                .length
            }
          </strong>
        </div>
        <div>
          <span>Aceptados por facturar</span>
          <strong>
            {data.quotes.filter((q) => q.status === "accepted").length}
          </strong>
        </div>
        <div>
          <span>Convertidos en factura</span>
          <strong>
            {data.quotes.filter((q) => q.status === "converted").length}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-search">
            <Search size={17} />
            <input
              aria-label="Buscar presupuestos"
              placeholder="Número, cliente, NIF o concepto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filters">
            <select
              aria-label="Cliente de presupuesto"
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
              aria-label="Estado de presupuesto"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Todos los estados</option>
              {Object.entries(states).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
              <option value="expired">Caducado</option>
            </select>
          </div>
        </div>
        <div className="invoice-filter-bar">
          <label>
            Desde{" "}
            <input
              type="date"
              aria-label="Presupuestos desde"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta{" "}
            <input
              type="date"
              aria-label="Presupuestos hasta"
              min={from || undefined}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              setSearch("");
              setClientId("all");
              setStatus("all");
              setFrom("");
              setTo("");
            }}
          >
            Limpiar filtros
          </button>
          <strong>
            {rows.length} resultados ·{" "}
            {money(rows.reduce((sum, q) => sum + q.total, 0))}
          </strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Presupuesto</th>
                <th>Cliente</th>
                <th>Fecha / validez</th>
                <th>Estado</th>
                <th className="num">Importe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => setView(q.id)}
                    >
                      {q.number}
                    </button>
                  </td>
                  <td>
                    <strong className="cell-title">
                      {q.client_snapshot.name}
                    </strong>
                    <small>{q.client_snapshot.tax_id}</small>
                  </td>
                  <td>
                    {dateLabel(q.date)}
                    {q.valid_until && (
                      <small>Válido hasta {dateLabel(q.valid_until)}</small>
                    )}
                  </td>
                  <td>
                    <Badge
                      tone={
                        expired(q) || q.status === "rejected"
                          ? "amber"
                          : q.status === "converted" || q.status === "accepted"
                            ? "green"
                            : "neutral"
                      }
                    >
                      {label(q)}
                    </Badge>
                  </td>
                  <td className="num strong">{money(q.total)}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setView(q.id)}
                    >
                      Ver presupuesto →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              text="Crea un presupuesto o cambia los filtros de búsqueda."
              action={
                canWrite && (
                  <button className="primary" onClick={create}>
                    <Plus size={16} /> Nuevo presupuesto
                  </button>
                )
              }
            />
          )}
        </div>
        <div className="table-footer">
          {rows.length} presupuestos{" "}
          <span>EUR · Importes con IVA y retención aplicados</span>
        </div>
      </section>
      {selected && (
        <Modal title={selected.number} onClose={() => setView(null)} wide>
          <div className="document-actions" aria-busy={busy}>
            <button onClick={() => window.print()}>
              <Printer size={16} /> Imprimir / PDF
            </button>
            {selected.invoice_id ? (
              <button
                className="primary"
                onClick={() => onInvoice(selected.invoice_id!)}
              >
                <ArrowRight size={16} /> Ver factura{" "}
                {invoice?.number || "en borrador"}
              </button>
            ) : (
              canWrite && (
                <>
                  <button disabled={busy} onClick={() => setEditing(selected)}>
                    Editar presupuesto
                  </button>
                  {selected.status !== "sent" && (
                    <button
                      disabled={busy}
                      onClick={() => void changeState(selected, "sent")}
                    >
                      Marcar enviado
                    </button>
                  )}
                  {selected.status !== "accepted" && (
                    <button
                      disabled={busy || expired(selected)}
                      onClick={() => void changeState(selected, "accepted")}
                    >
                      Marcar aceptado
                    </button>
                  )}
                  {selected.status !== "rejected" && (
                    <button
                      disabled={busy}
                      onClick={() => void changeState(selected, "rejected")}
                    >
                      Marcar rechazado
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      expired(selected) ||
                      selected.status === "rejected"
                    }
                    onClick={() => setConvert(selected)}
                  >
                    <ArrowRight size={16} /> Convertir a factura
                  </button>
                </>
              )
            )}
          </div>
          <div className="alert info no-print">
            Estado: {label(selected)}.{" "}
            {selected.invoice_id
              ? "El presupuesto se conserva vinculado a su factura."
              : expired(selected)
                ? "Actualiza la validez antes de convertirlo en factura."
                : "Marcar enviado registra el estado del presupuesto; el envío al cliente se realiza fuera de la aplicación."}
          </div>
          <InvoicePaper invoice={selected} quote />
        </Modal>
      )}
      {editing && (
        <InvoiceEditor
          {...shared}
          initial={editing}
          quote
          onClose={() => setEditing(null)}
        />
      )}
      {convert && (
        <Modal
          title="Convertir presupuesto a factura"
          onClose={() => setConvert(null)}
        >
          <div className="modal-body">
            <p>
              Se creará un borrador de factura de {convert.number} para{" "}
              {convert.client_snapshot.name}, por {money(convert.total)}.
            </p>
            <p>
              Se copiarán los conceptos, descuentos, impuestos, observaciones y
              condiciones de pago. La factura tendrá fecha de hoy y podrás
              revisarla antes de emitirla.
            </p>
            <p>
              El presupuesto se conservará y quedará vinculado a la factura.
            </p>
          </div>
          <div className="modal-footer" aria-busy={busy}>
            <button
              data-dismiss-modal
              disabled={busy}
              onClick={() => setConvert(null)}
            >
              Volver
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void convertNow()}
            >
              {busy ? "Convirtiendo…" : "Crear borrador de factura"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
