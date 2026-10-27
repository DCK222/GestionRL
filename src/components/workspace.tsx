"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  ChartNoAxesCombined,
  ReceiptText,
  GraduationCap,
  Users,
  Settings as SettingsIcon,
  FolderArchive,
  Sun,
  Moon,
  LogOut,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Wallet,
  Clock3,
  Menu,
  RefreshCw,
  ShieldCheck,
  ChevronRight,
  CalendarDays,
  Activity,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { supabase, readAll, readOptionalTable } from "@/lib/supabase";
import {
  money,
  qty,
  monthLabel,
  monthlyTotals,
  invoiceState,
  today,
  csvText,
  download,
} from "@/lib/finance";
import type { Data, Settings } from "@/lib/types";
import { Login } from "./auth";
import { Stat, Badge, Empty, LinkCard, SectionTitle } from "./ui";
import { Invoices } from "./invoices";
import { Academy } from "./academy";
import { Calendar } from "./calendar";
import { Contacts, Expenses, Cashbook } from "./records";
import { Configuration, Archive } from "./settings";
export type PageKey =
  | "home"
  | "finance"
  | "invoices"
  | "academy"
  | "calendar"
  | "clients"
  | "expenses"
  | "cash"
  | "archive"
  | "settings";
const nav = [
  { id: "home", label: "Inicio", icon: LayoutDashboard },
  { id: "finance", label: "Gestión financiera", icon: ChartNoAxesCombined },
  { id: "invoices", label: "Facturación", icon: ReceiptText },
  { id: "academy", label: "Clases e ingresos", icon: GraduationCap },
  { id: "calendar", label: "Calendario", icon: CalendarDays },
  { id: "clients", label: "Clientes y alumnos", icon: Users },
  { id: "cash", label: "Cobros", icon: Wallet },
  { id: "expenses", label: "Gastos", icon: ArrowUpRight },
  { id: "archive", label: "Archivo original", icon: FolderArchive },
  { id: "settings", label: "Configuración", icon: SettingsIcon },
] as const;
const initial: Data = {
  clients: [],
  students: [],
  invoices: [],
  quotes: [],
  enrollments: [],
  expenses: [],
  payments: [],
  sheets: [],
  fiscal: [],
  settings: null,
  members: [],
};
export type Shared = {
  data: Data;
  reload: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  canWrite: boolean;
  admin: boolean;
  setUnsavedChanges?: (value: boolean) => void;
};
export function Workspace() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [failure, setFailure] = useState(""),
    [data, setData] = useState<Data>(initial),
    [page, setPage] = useState<PageKey>("home"),
    [invoiceClient, setInvoiceClient] = useState("all"),
    [unsavedChanges, setUnsavedChanges] = useState(false),
    [theme, setTheme] = useState("light"),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(""),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [period, setPeriod] = useState(today().slice(0, 7));
  const requestSequence = useRef(0);
  const identity = useRef<string | null>(null);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const t = localStorage.getItem("rl-theme") || "light";
    setTheme(t);
    let active = true;
    let authEventReceived = false;
    function acceptSession(next: Session | null) {
      if (!active) return;
      if (identity.current !== (next?.user.id ?? null)) {
        requestSequence.current += 1;
        identity.current = next?.user.id ?? null;
        setData(initial);
        setFailure("");
        setPage("home");
        setUnsavedChanges(false);
      }
      setSession(next);
      setReady(true);
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      acceptSession(next);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return;
      if (error) notify("No se pudo recuperar la sesión. Vuelve a iniciar sesión.", true);
      acceptSession(data.session);
    }).catch(() => {
      if (active && !authEventReceived) acceptSession(null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("rl-theme", theme);
  }, [theme]);
  const reload = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const userId = identity.current;
    if (!userId) return;
    setLoading(true);
    try {
      const [
        clients,
        students,
        invoices,
        quotes,
        enrollments,
        expenses,
        payments,
        sheets,
        fiscal,
        settings,
        members,
      ] = await Promise.all([
        readAll<Data["clients"][number]>("rl_clients"),
        readAll<Data["students"][number]>("rl_students"),
        readAll<Data["invoices"][number]>("rl_invoices"),
        readOptionalTable<Data["quotes"][number]>("rl_quotes"),
        readAll<Data["enrollments"][number]>("rl_enrollments"),
        readAll<Data["expenses"][number]>("rl_expenses"),
        readAll<Data["payments"][number]>("rl_payments"),
        readAll<Data["sheets"][number]>(
          "rl_sheets",
          "id,name,period,period_inferred,summary,position",
        ),
        readAll<Data["fiscal"][number]>("rl_fiscal_records"),
        readAll<Settings>("rl_settings"),
        supabase.from("rl_members").select("*").abortSignal(AbortSignal.timeout(20000)),
      ]);
      if (sequence !== requestSequence.current || userId !== identity.current) return;
      if (members.error) throw members.error;
      if (!settings.length)
        throw new Error(
          "Este usuario no tiene acceso. Comprueba que has ejecutado supabase-roboticlab.sql y que el usuario tiene permisos.",
        );
      setData({
        clients,
        students,
        invoices,
        quotes: quotes ?? [],
        quotesUnavailable: quotes === null,
        enrollments,
        expenses,
        payments,
        sheets: sheets.sort((a, b) => a.position - b.position),
        fiscal,
        settings: settings[0],
        members: members.data,
      });
      setFailure("");
    } catch (e) {
      if (sequence !== requestSequence.current || userId !== identity.current) return;
      setFailure(
        e instanceof Error ? e.message : "No se pudieron cargar los datos",
      );
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (session) void reload();
  }, [session?.user.id, reload]);
  const role = data.members.find((m) => m.email === session?.user.email?.toLowerCase())?.role;
  const shared: Shared = {
    data,
    reload,
    notify,
    canWrite: role === "admin" || role === "staff",
    admin: role === "admin",
    setUnsavedChanges,
  };
  function go(p: PageKey) {
    if (
      p !== page &&
      unsavedChanges &&
      !window.confirm(
        "Hay cambios sin guardar en la hoja. ¿Quieres salir y descartarlos?",
      )
    )
      return;
    if (p === "invoices") setInvoiceClient("all");
    setPage(p);
    setMobile(false);
    setSearch("");
  }
  if (!ready)
    return (
      <div className="boot">
        <img src="/logo.webp" alt="Roboticlab" />
        <span>Cargando tu espacio…</span>
      </div>
    );
  if (!session) return <Login />;
  const results = search.trim()
    ? [
        ...data.clients
          .filter((c) =>
            `${c.name} ${c.tax_id}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .slice(0, 4)
          .map((c) => ({
            title: c.name,
            subtitle: "Cliente",
            page: "clients" as PageKey,
          })),
        ...data.students
          .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 4)
          .map((c) => ({
            title: c.name,
            subtitle: "Alumno",
            page: "academy" as PageKey,
          })),
        ...data.invoices
          .filter((c) =>
            `${c.number} ${c.client_snapshot.name}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .slice(0, 4)
          .map((c) => ({
            title: c.number || "Borrador",
            subtitle: c.client_snapshot.name,
            page: "invoices" as PageKey,
          })),
      ]
    : [];
  return (
    <div className="app-shell" key={session.user.id}>
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <img src="/logo.webp" alt="Roboticlab" />
          <span>GESTIÓN & ADMINISTRACIÓN</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">R</span>
          <div>
            Mi academia<small>Roboticlab Madrid</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-caption">ESPACIO DE TRABAJO</div>
        <nav>
          {nav.slice(0, 8).map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              className={page === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "invoices" && (
                <span className="nav-count">{data.invoices.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-caption">ADMINISTRACIÓN</div>
        <nav>
          {nav.slice(8).map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              className={page === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="fiscal-indicator">
            <ShieldCheck size={18} />
            <div>
              VeriFactu
              <small>
                {data.settings?.verifactu_enabled
                  ? data.settings.verifactu_environment === "test"
                    ? "Entorno de pruebas"
                    : "Producción"
                  : "Desactivado"}
              </small>
            </div>
            <span
              className={data.settings?.verifactu_enabled ? "dot green" : "dot"}
            />
          </div>
          <button className="profile" onClick={() => go("settings")}>
            <span className="avatar">A</span>
            <div>
              {session.user.email === "admin@roboticlab.internal"
                ? "Administrador"
                : session.user.email}
              <small>{role === "viewer" ? "Solo lectura" : "Roboticlab"}</small>
            </div>
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-overlay" onClick={() => setMobile(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir menú"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Mi academia <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="Buscar en la aplicación"
              placeholder="Buscar clientes, alumnos, facturas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <div className="search-results">
                {results.length ? (
                  results.map((r, i) => (
                    <button key={i} onClick={() => go(r.page)}>
                      <span>
                        {r.title}
                        <small>{r.subtitle}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))
                ) : (
                  <p>No hay coincidencias.</p>
                )}
              </div>
            )}
          </div>
          <button
            className="icon-button"
            title="Actualizar"
            aria-label="Actualizar datos"
            disabled={loading}
            onClick={() => void reload()}
          >
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
          <button
            className="icon-button"
            title="Cambiar tema"
            aria-label="Cambiar tema"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <button
            className="icon-button"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            onClick={() => {
              if (unsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Quieres cerrar sesión y descartarlos?")) return;
              void supabase.auth.signOut().then(({ error }) => {
                if (error) notify("No se pudo cerrar sesión. Inténtalo de nuevo.", true);
              });
            }}
          >
            <LogOut size={18} />
          </button>
        </header>
        <main>
          {failure && (
            <div className="alert error">
              <h3>No se han podido cargar los datos</h3>
              <p>{failure}</p>
              <button onClick={() => void reload()}>Reintentar</button>
            </div>
          )}
          {!data.settings ? (
            <div className="loading-panel">
              <RefreshCw className="spin" />
              {failure ? "Conservamos tu sesión. Pulsa Reintentar para volver a cargar." : "Conectando con Supabase…"}
            </div>
          ) : (
            <>
              {page === "home" && (
                <Home
                  {...shared}
                  period={period}
                  setPeriod={setPeriod}
                  go={go}
                />
              )}
              {page === "finance" && (
                <Finance {...shared} period={period} setPeriod={setPeriod} />
              )}
              {page === "invoices" && (
                <Invoices {...shared} initialClientId={invoiceClient} />
              )}
              {page === "academy" && (
                <Academy {...shared} period={period} setPeriod={setPeriod} />
              )}
              {page === "clients" && (
                <Contacts
                  {...shared}
                  onInvoices={(id) => {
                    setInvoiceClient(id);
                    setPage("invoices");
                  }}
                />
              )}
              {page === "expenses" && <Expenses {...shared} period={period} />}
              {page === "cash" && <Cashbook {...shared} />}
              {page === "calendar" && <Calendar {...shared} />}
              {page === "archive" && <Archive {...shared} />}
              {page === "settings" && <Configuration {...shared} />}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>Roboticlab · Tu academia, conectada</span>
          <span>
            <span className="dot green" /> Supabase{" "}
            {loading ? "· actualizando" : failure ? "· no se pudo actualizar" : "· datos cargados"}
          </span>
        </footer>
      </div>
      {toast && (
        <div className={"toast " + (toast.error ? "error" : "")} role="status">
          {toast.error ? (
            <TriangleAlert size={20} />
          ) : (
            <CheckCircle2 size={20} />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
function Period({
  period,
  onChange,
}: {
  period: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="period-picker">
      <CalendarDays size={17} />
      <input
        aria-label="Mes"
        type="month"
        value={period}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Home({
  data,
  period,
  setPeriod,
  go,
}: Shared & {
  period: string;
  setPeriod: (v: string) => void;
  go: (p: PageKey) => void;
}) {
  const t = monthlyTotals(
    period,
    data.enrollments,
    data.payments,
    data.expenses,
    data.invoices,
  );
  const year = period.slice(0, 4);
  const chart = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return {
      month: new Date(month + "-01T12:00:00").toLocaleDateString("es-ES", {
        month: "short",
      }),
      ...monthlyTotals(
        month,
        data.enrollments,
        data.payments,
        data.expenses,
        data.invoices,
      ),
    };
  });
  const latest = [...data.invoices]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const classes = data.enrollments.filter((e) => e.period === period);
  const pending = classes.filter((e) => (e.expected || 0) > 0);
  return (
    <>
      <SectionTitle
        eyebrow="TU ACADEMIA, DE UN VISTAZO"
        title="Todo empieza aquí"
        description="Un espacio para organizar tu día y hacer crecer Roboticlab."
        actions={
          <>
            <Period period={period} onChange={setPeriod} />
            <button className="primary" onClick={() => go("invoices")}>
              <Plus size={17} /> Nueva factura
            </button>
          </>
        }
      />
      <div className="welcome-banner">
        <div>
          <Badge tone="blue">ROBOTICLAB · GESTIÓN</Badge>
          <h2>
            Más tiempo para enseñar.
            <br />
            Menos tiempo para gestionar.
          </h2>
          <p>
            Conecta tus clases, tus ingresos y tu facturación en un solo lugar.
          </p>
          <button onClick={() => go("academy")}>
            Gestionar mis clases <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="banner-visual">
          <div className="visual-orbit" />
          <div className="visual-card">
            <GraduationCap size={31} />
            <span>Aprendizaje en marcha</span>
            <strong>
              {classes.filter((c) => c.student_id).length}
              <small>inscripciones este mes</small>
            </strong>
          </div>
          <span className="mini-card">
            <CheckCircle2 size={18} /> Todo en tu espacio
          </span>
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="Ingresos registrados"
          value={money(t.cash)}
          detail={monthLabel(period)}
          icon={<ArrowDownLeft size={19} />}
          accent
        />
        <Stat
          label="Pendiente de clases"
          value={money(t.expected)}
          detail={`${pending.length} registros con saldo previsto`}
          icon={<Wallet size={19} />}
        />
        <Stat
          label="Facturación del mes"
          value={money(t.billed)}
          detail="Facturas emitidas · importe neto"
          icon={<ReceiptText size={19} />}
        />
        <Stat
          label="Horas registradas"
          value={qty(t.hours)}
          detail="Solo columnas identificadas como horas"
          icon={<Clock3 size={19} />}
        />
      </div>
      <div className="link-grid">
        <LinkCard
          title="Gestión financiera"
          text="Tu evolución, gastos e ingresos en perspectiva."
          icon={<ChartNoAxesCombined size={23} />}
          onClick={() => go("finance")}
        />
        <LinkCard
          title="Facturación"
          text="Crea, consulta y organiza todas tus facturas."
          icon={<ReceiptText size={23} />}
          onClick={() => go("invoices")}
        />
        <LinkCard
          title="Clases e ingresos"
          text="Alumnos, horas y bonos. Todo al día."
          icon={<GraduationCap size={23} />}
          onClick={() => go("academy")}
        />
      </div>
      <div className="home-bottom">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Evolución de ingresos</h3>
              <p>Ingresos registrados y gastos pagados · {year}</p>
            </div>
            <Badge>{year}</Badge>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="income" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2e65d1" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#2e65d1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 5"
                  vertical={false}
                  stroke="var(--line)"
                />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={48}
                />
                <Tooltip
                  formatter={(v) => money(Number(v))}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                  }}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="cash"
                  name="Ingresos"
                  stroke="#2e65d1"
                  fill="url(#income)"
                  strokeWidth={2.5}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="expenses"
                  name="Gastos"
                  stroke="#c08a47"
                  fill="transparent"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Últimas facturas</h3>
              <p>Tu actividad más reciente</p>
            </div>
            <button className="text-button" onClick={() => go("invoices")}>
              Ver todas <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="recent-list">
            {latest.map((i) => (
              <button key={i.id} onClick={() => go("invoices")}>
                <span className="recent-icon">
                  <ReceiptText size={18} />
                </span>
                <span className="recent-name">
                  <strong>{i.client_snapshot.name}</strong>
                  <small>
                    {i.number || "Borrador"} · {invoiceState(i, data.payments)}
                  </small>
                </span>
                <strong>{money(i.total)}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="subtle-note">
        <Activity size={15} /> Los cobros del Excel y la facturación se muestran
        por separado. Concilia las facturas históricas antes de registrar nuevos
        cobros.
      </div>
    </>
  );
}
function Finance({
  data,
  period,
  setPeriod,
}: Shared & { period: string; setPeriod: (s: string) => void }) {
  const year = period.slice(0, 4);
  const rows = Array.from({ length: 12 }, (_, n) => {
    const m = `${year}-${String(n + 1).padStart(2, "0")}`;
    return {
      month: m,
      label: monthLabel(m).split(" ")[0],
      ...monthlyTotals(
        m,
        data.enrollments,
        data.payments,
        data.expenses,
        data.invoices,
      ),
    };
  });
  const t = rows.find((r) => r.month === period)!;
  const plan = data.expenses
    .filter((e) => e.date.startsWith(period) && e.status === "planned")
    .reduce((a, e) => a + e.amount, 0);
  const taxable = data.invoices.filter(
    (i) =>
      i.date.startsWith(year) &&
      i.status !== "draft" &&
      i.environment === "production",
  );
  return (
    <>
      <SectionTitle
        eyebrow="GESTIÓN FINANCIERA"
        title="Tus números, claros"
        description="Consulta la actividad real, los importes previstos y la facturación."
        actions={
          <>
            <Period period={period} onChange={setPeriod} />
            <button
              onClick={() =>
                download(
                  `finanzas-${year}.csv`,
                  csvText(
                    rows.map((r) => ({
                      Mes: r.month,
                      Ingresos: r.cash,
                      Gastos: r.expenses,
                      Resultado: r.net,
                      Previsto: r.expected,
                      Facturado: r.billed,
                    })),
                  ),
                )
              }
            >
              Exportar CSV
            </button>
          </>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Ingresos registrados"
          value={money(t.cash)}
          detail={monthLabel(period)}
          icon={<ArrowDownLeft />}
          accent
        />
        <Stat
          label="Gastos pagados"
          value={money(t.expenses)}
          detail={`${money(plan)} de gastos previstos`}
          icon={<ArrowUpRight />}
        />
        <Stat
          label="Saldo de actividad"
          value={money(t.net)}
          detail="Ingresos registrados menos gastos pagados"
          icon={<Wallet />}
        />
        <Stat
          label="Pendiente de clases"
          value={money(t.expected)}
          detail="Saldo previsto en el registro mensual"
          icon={<Clock3 />}
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Balance anual · {year}</h3>
            <p>
              Los gastos previstos no se descuentan hasta registrarlos como
              pagados.
            </p>
          </div>
          <Badge tone="blue">Ingresos y gastos</Badge>
        </div>
        <div className="chart tall">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 5"
                vertical={false}
                stroke="var(--line)"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={12}
              />
              <YAxis tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip
                formatter={(v) => money(Number(v))}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                }}
              />
              <Legend />
              <Bar
                isAnimationActive={false}
                dataKey="cash"
                name="Ingresos"
                fill="#3269cb"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                isAnimationActive={false}
                dataKey="expenses"
                name="Gastos pagados"
                fill="#c6d5f0"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <div className="two-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Resumen de facturas · {year}</h3>
              <p>Información de las facturas emitidas e importadas</p>
            </div>
          </div>
          <div className="summary-lines">
            <div>
              Base imponible
              <strong>
                {money(taxable.reduce((a, i) => a + i.subtotal, 0))}
              </strong>
            </div>
            <div>
              IVA repercutido
              <strong>{money(taxable.reduce((a, i) => a + i.vat, 0))}</strong>
            </div>
            <div>
              Retenciones IRPF
              <strong>
                {money(taxable.reduce((a, i) => a + i.withholding, 0))}
              </strong>
            </div>
            <div className="total">
              Importe neto facturado
              <strong>{money(taxable.reduce((a, i) => a + i.total, 0))}</strong>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Cómo se calculan los ingresos</h3>
              <p>Una lectura transparente de tus datos</p>
            </div>
          </div>
          <div className="info-copy">
            <p>
              Se suman «Pagado» y «Anticipos» de cada fila del mes, más los
              cobros independientes registrados. Los cobros vinculados a clases
              ya están incluidos en su fila.
            </p>
            <p>
              Las facturas históricas están <strong>por conciliar</strong>: no
              se supone que estén cobradas ni se añaden automáticamente a los
              ingresos.
            </p>
            <p>
              Las anotaciones y resúmenes auxiliares del Excel se conservan en
              Archivo original, sin sumarlos de nuevo.
            </p>
          </div>
        </section>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Ingresos</th>
              <th className="num">Gastos</th>
              <th className="num">Saldo</th>
              <th className="num">Pendiente clases</th>
              <th className="num">Facturación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="capitalize">{r.label}</td>
                <td className="num">{money(r.cash)}</td>
                <td className="num">{money(r.expenses)}</td>
                <td className={"num " + (r.net < 0 ? "negative" : "positive")}>
                  {money(r.net)}
                </td>
                <td className="num">{money(r.expected)}</td>
                <td className="num">{money(r.billed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
