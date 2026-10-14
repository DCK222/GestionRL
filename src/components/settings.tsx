"use client";
import { useEffect, useState } from "react";
import {
  Save,
  ShieldCheck,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Send,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  UserPlus,
} from "lucide-react";
import type { Shared } from "./workspace";
import type { Company, Cell, Audit } from "@/lib/types";
import { supabase, rpc, api, readAll } from "@/lib/supabase";
import { download, money } from "@/lib/finance";
import { SectionTitle, Badge, Field, Empty, Modal } from "./ui";
import { downloadDocument } from "./invoices";
export function Configuration(shared: Shared) {
  const { data, admin, notify, reload } = shared;
  const [tab, setTab] = useState("company"),
    [company, setCompany] = useState<Company>(data.settings!.company),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(data.settings!.verifactu_enabled),
    [environment, setEnvironment] = useState(
      data.settings!.verifactu_environment,
    ),
    [readiness, setReadiness] = useState<{
      checks: { label: string; ok: boolean }[];
      productionReady: boolean;
      testReady: boolean;
    } | null>(null),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("staff"),
    [audit, setAudit] = useState<Audit[]>([]),
    [inspect, setInspect] = useState<unknown | null>(null);
  useEffect(() => {
    if (tab === "verifactu")
      api("/api/verifactu")
        .then(setReadiness)
        .catch((e) => notify(e.message, true));
    if (tab === "audit")
      supabase
        .from("rl_audit")
        .select("*")
        .order("id", { ascending: false })
        .limit(200)
        .then(({ data, error }) => {
          if (error) notify(error.message, true);
          else setAudit(data);
        });
  }, [tab, notify]);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      await reload();
      notify(message);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const statusLabel: Record<string, string> = {
    pending: "Pendiente",
    sending: "Enviando",
    accepted: "Aceptado",
    accepted_with_errors: "Aceptado con errores",
    rejected: "Rechazado",
    uncertain: "Respuesta incierta",
  };
  return (
    <>
      <SectionTitle
        eyebrow="ADMINISTRACIÓN"
        title="A tu manera"
        description="Datos fiscales, acceso y configuración de tu espacio de trabajo."
      />
      <div className="tabs">
        {[
          ["company", "Datos de la empresa"],
          ["verifactu", "VeriFactu"],
          ["security", "Acceso y usuarios"],
          ["audit", "Auditoría"],
          ["backup", "Copias de datos"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "company" && (
        <section className="panel settings-panel">
          <div className="panel-heading">
            <div>
              <h3>Identidad de facturación</h3>
              <p>
                Los documentos emitidos conservan los datos con los que se
                crearon.
              </p>
            </div>
            <img className="settings-logo" src="/logo.webp" alt="Roboticlab" />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => rpc("rl_save_company", { p: company }),
                "Datos de empresa guardados",
              );
            }}
          >
            <fieldset disabled={!admin || busy}>
              <div className="form-grid">
                {(
                  [
                    ["name", "Nombre / razón social"],
                    ["brand", "Nombre comercial"],
                    ["tax_id", "NIF"],
                    ["email", "Correo"],
                    ["phone", "Teléfono / Bizum"],
                    ["website", "Web"],
                    ["iban", "IBAN"],
                  ] as const
                ).map(([k, l]) => (
                  <Field key={k} label={l}>
                    <input
                      required={k === "name" || k === "tax_id"}
                      value={company[k] || ""}
                      onChange={(e) =>
                        setCompany({ ...company, [k]: e.target.value })
                      }
                    />
                  </Field>
                ))}
              </div>
              <Field label="Dirección fiscal">
                <textarea
                  value={company.address}
                  onChange={(e) =>
                    setCompany({ ...company, address: e.target.value })
                  }
                />
              </Field>
              <Field label="Condiciones de pago predeterminadas">
                <textarea
                  value={company.payment_terms}
                  onChange={(e) =>
                    setCompany({ ...company, payment_terms: e.target.value })
                  }
                />
              </Field>
              <Field label="Exención de IVA predeterminada">
                <textarea
                  value={company.exemption}
                  onChange={(e) =>
                    setCompany({ ...company, exemption: e.target.value })
                  }
                />
              </Field>
              {admin && (
                <button className="primary">
                  <Save size={16} /> Guardar datos
                </button>
              )}
            </fieldset>
          </form>
        </section>
      )}
      {tab === "verifactu" && (
        <>
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <h3>
                  <ShieldCheck size={21} /> VeriFactu
                </h3>
                <p>
                  Remisión de registros de facturación a la Agencia Tributaria.
                </p>
              </div>
              <Badge
                tone={data.settings?.verifactu_enabled ? "green" : "neutral"}
              >
                {data.settings?.verifactu_enabled ? "Activado" : "Desactivado"}
              </Badge>
            </div>
            <div className="alert warning">
              La integración necesita un certificado válido y validación previa
              en el portal de pruebas de la AEAT. Esta entrega no acredita
              conformidad ni incluye una declaración responsable del productor.
              El modo desactivado no constituye una implementación certificada
              de la modalidad «NO VERI*FACTU».
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () =>
                    api("/api/verifactu", {
                      action: "configure",
                      enabled,
                      environment,
                    }),
                  "Configuración VeriFactu guardada",
                );
              }}
            >
              <fieldset disabled={!admin || busy}>
                <div className="form-grid">
                  <Field label="Estado">
                    <select
                      value={enabled ? "on" : "off"}
                      onChange={(e) => setEnabled(e.target.value === "on")}
                    >
                      <option value="off">Desactivado</option>
                      <option value="on">Activar remisión</option>
                    </select>
                  </Field>
                  <Field label="Entorno">
                    <select
                      value={environment}
                      onChange={(e) =>
                        setEnvironment(e.target.value as "test" | "production")
                      }
                    >
                      <option value="test">Pruebas AEAT</option>
                      <option value="production">Producción AEAT</option>
                    </select>
                  </Field>
                </div>
                <p>
                  Las pruebas usan una serie TEST y registros separados. Tras
                  iniciar la remisión en producción, se impide desactivarla o
                  volver a pruebas durante el mismo año natural.
                </p>
                {readiness && (
                  <div className="readiness">
                    {readiness.checks.map((c) => (
                      <div key={c.label}>
                        {c.ok ? (
                          <CheckCircle2 size={17} />
                        ) : (
                          <AlertCircle size={17} />
                        )}
                        <span>{c.label}</span>
                        <Badge tone={c.ok ? "green" : "amber"}>
                          {c.ok ? "Configurado" : "Pendiente"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {admin && (
                  <button className="primary" disabled={busy}>
                    <Save size={16} /> Guardar configuración
                  </button>
                )}
              </fieldset>
            </form>
            <a
              className="documentation-link"
              href="https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html"
              target="_blank"
              rel="noreferrer"
            >
              Documentación técnica de la AEAT <ExternalLink size={14} />
            </a>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Registros y cola de envío</h3>
                <p>
                  Se conservan la huella, la respuesta de la AEAT y los intentos
                  de cada envío.
                </p>
              </div>
              {shared.canWrite && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api("/api/verifactu", { action: "process" }),
                      "Cola procesada",
                    )
                  }
                >
                  <Send size={16} /> Procesar pendientes
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Entorno</th>
                    <th>Estado</th>
                    <th>Intentos</th>
                    <th>CSV AEAT</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...data.fiscal]
                    .sort((a, b) => b.seq - a.seq)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          {
                            data.invoices.find((i) => i.id === r.invoice_id)
                              ?.number
                          }
                        </td>
                        <td>
                          {r.environment === "test" ? "Pruebas" : "Producción"}
                        </td>
                        <td>
                          <Badge>{statusLabel[r.status] || r.status}</Badge>
                        </td>
                        <td>{r.attempts}</td>
                        <td>{r.csv || "—"}</td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setInspect(r)}
                          >
                            Detalle
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!data.fiscal.length && (
                <Empty text="Al activar VeriFactu, las nuevas facturas emitidas generarán un registro aquí. Las facturas históricas no se remiten automáticamente." />
              )}
            </div>
          </section>
        </>
      )}
      {tab === "security" && (
        <div className="two-columns">
          <section className="panel settings-panel">
            <h3>
              <KeyRound size={20} /> Cambiar mi contraseña
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (password !== confirm)
                  return notify("Las contraseñas no coinciden", true);
                await run(async () => {
                  const { error } = await supabase.auth.updateUser({
                    password,
                  });
                  if (error) throw error;
                  setPassword("");
                  setConfirm("");
                }, "Contraseña cambiada");
              }}
            >
              <Field label="Nueva contraseña">
                <input
                  autoComplete="new-password"
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Repetir contraseña">
                <input
                  autoComplete="new-password"
                  type="password"
                  required
                  minLength={12}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <button className="primary" disabled={busy}>
                Cambiar contraseña
              </button>
            </form>
          </section>
          <section className="panel settings-panel">
            <h3>
              <UserPlus size={20} /> Usuarios autorizados
            </h3>
            <div className="member-list">
              {data.members.map((m) => (
                <div key={m.email}>
                  <strong>
                    {m.email === "admin@roboticlab.internal"
                      ? "admin"
                      : m.email}
                  </strong>
                  <Badge>{m.role}</Badge>
                </div>
              ))}
            </div>
            {admin && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      rpc("rl_set_member", {
                        member_email: email,
                        member_role: role,
                      }),
                    "Permisos guardados",
                  );
                }}
              >
                <Field label="Correo del usuario">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Permisos">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="staff">Gestión</option>
                    <option value="viewer">Solo lectura</option>
                    <option value="admin">Administración</option>
                  </select>
                </Field>
                <p className="subtle-note">
                  Crea antes la cuenta en Authentication → Users de Supabase. No
                  hay registro público en la aplicación.
                </p>
                <button disabled={busy}>Guardar permisos</button>
              </form>
            )}
          </section>
        </div>
      )}
      {tab === "audit" && (
        <section className="panel table-wrap">
          <div className="panel-heading">
            <div>
              <h3>Últimos 200 cambios</h3>
              <p>
                Historial de operaciones y valores anteriores. Los usuarios no
                pueden borrarlo.
              </p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Acción</th>
                <th>Sección</th>
                <th>Usuario</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>
                    {new Date(a.at).toLocaleString("es-ES", {
                      timeZone: "Europe/Madrid",
                    })}
                  </td>
                  <td>
                    <Badge>{a.action}</Badge>
                  </td>
                  <td>{a.entity.replace("rl_", "")}</td>
                  <td>
                    {a.user_id
                      ? a.user_id.slice(0, 8)
                      : "Importación / servidor"}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setInspect(a)}
                    >
                      Ver cambio
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === "backup" && (
        <section className="panel settings-panel">
          <h3>Exportar una copia de tus datos</h3>
          <p>
            Descarga un JSON con los registros de trabajo, las hojas originales,
            el historial y los documentos adjuntos. El archivo contiene
            información personal: guárdalo en un lugar privado.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const [documents, sheets, audit, hours] = await Promise.all([
                  readAll("rl_documents"),
                  readAll("rl_sheets"),
                  readAll("rl_audit"),
                  readAll("rl_hours"),
                ]);
                download(
                  `roboticlab-copia-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(
                    {
                      format: "roboticlab-backup-v1",
                      exported_at: new Date().toISOString(),
                      data,
                      documents,
                      sheets,
                      audit,
                      hours,
                    },
                    null,
                    2,
                  ),
                  "application/json",
                );
              }, "Copia descargada")
            }
          >
            <Download size={16} /> Descargar copia completa
          </button>
          <p className="subtle-note">
            Esta exportación no incluye contraseñas ni certificados. Para
            restaurar toda la infraestructura y usuarios utiliza las copias de
            seguridad de Supabase.
          </p>
        </section>
      )}
      {inspect !== null && (
        <Modal
          title="Detalle del registro"
          onClose={() => setInspect(null)}
          wide
        >
          <div className="modal-body">
            <pre className="json-preview">
              {JSON.stringify(inspect, null, 2)}
            </pre>
            <button
              onClick={() =>
                download(
                  "registro.json",
                  JSON.stringify(inspect, null, 2),
                  "application/json",
                )
              }
            >
              <Download size={16} /> Descargar registro
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Archive({ data, notify }: Shared) {
  const [selected, setSelected] = useState(data.sheets.at(-1)?.id || ""),
    [cells, setCells] = useState<Cell[][]>([]),
    [loading, setLoading] = useState(false),
    [formulas, setFormulas] = useState(false),
    [documents, setDocuments] = useState<
      { id: string; name: string; mime: string; sha256: string }[]
    >([]);
  const sheet = data.sheets.find((s) => s.id === selected);
  useEffect(() => {
    supabase
      .from("rl_documents")
      .select("id,name,mime,sha256")
      .order("name")
      .then(({ data, error }) => {
        if (error) notify(error.message, true);
        else setDocuments(data);
      });
  }, [notify]);
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    supabase
      .from("rl_sheets")
      .select("cells")
      .eq("id", selected)
      .single()
      .then(({ data, error }) => {
        if (error) notify(error.message, true);
        else setCells(data.cells.rows);
        setLoading(false);
      });
  }, [selected, notify]);
  function col(s: string) {
    return s.replace(/\d/g, "");
  }
  function columnIndex(s: string) {
    return [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  }
  const columns = [...new Set(cells.flat().map((c) => col(c.cell)))].sort(
    (a, b) => columnIndex(a) - columnIndex(b),
  );
  return (
    <>
      <SectionTitle
        eyebrow="ARCHIVO ORIGINAL"
        title="Tu historia, conservada"
        description="Consulta los 61 meses del libro original y descarga los documentos aportados."
      />
      <div className="archive-layout">
        <section className="panel archive-documents">
          <div className="panel-heading">
            <div>
              <h3>Documentos originales</h3>
              <p>PDF y Excel almacenados en privado</p>
            </div>
          </div>
          {documents.map((d) => (
            <button
              key={d.id}
              onClick={() =>
                void downloadDocument(d.id).catch((e) =>
                  notify(e.message, true),
                )
              }
            >
              {d.mime.includes("pdf") ? (
                <FileText size={18} />
              ) : (
                <FileSpreadsheet size={18} />
              )}
              <span>{d.name}</span>
              <Download size={15} />
            </button>
          ))}
        </section>
        <section className="panel archive-sheet">
          <div className="table-toolbar">
            <select
              aria-label="Hoja original"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {[...data.sheets].reverse().map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="check-field">
              <input
                type="checkbox"
                checked={formulas}
                onChange={(e) => setFormulas(e.target.checked)}
              />{" "}
              Ver fórmulas originales
            </label>
          </div>
          {sheet?.period_inferred && (
            <div className="alert warning">
              Esta pestaña no indica el año. El periodo {sheet.period} se ha
              inferido por su posición en el libro; revisa el original si
              necesitas confirmarlo.
            </div>
          )}
          {sheet?.summary.combined_months && (
            <div className="alert info">
              La pestaña agrupa julio y agosto. Se conserva completa bajo julio,
              sin repartir importes entre meses.
            </div>
          )}
          <div className="subtle-note">
            Vista de conservación. Los valores de fórmulas son los resultados
            guardados en Excel; la gestión actual se realiza en Clases e
            ingresos.
          </div>
          {loading ? (
            <div className="loading-panel">Leyendo hoja…</div>
          ) : (
            <div className="original-grid">
              <table>
                <thead>
                  <tr>
                    <th />{" "}
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cells.map((r, index) => (
                    <tr key={index}>
                      <th>{r[0]?.cell.replace(/\D/g, "")}</th>
                      {columns.map((c) => {
                        const cell = r.find((x) => col(x.cell) === c);
                        return (
                          <td
                            key={c}
                            title={cell ? `${cell.cell}: ${cell.value}` : ""}
                            className={
                              typeof cell?.value === "string" &&
                              cell.value.startsWith("=")
                                ? "formula-cell"
                                : ""
                            }
                          >
                            {String(
                              (formulas ? cell?.value : cell?.cached) ?? "",
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
