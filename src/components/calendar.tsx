"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Euro,
  ExternalLink,
  List,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import type { Shared } from "./workspace";
import type { CalendarEvent } from "@/lib/types";
import { readAll, rpc } from "@/lib/supabase";
import { money, monthLabel, qty, today } from "@/lib/finance";
import { searchText } from "@/lib/clients";
import {
  calendarDays,
  eventCategories,
  eventHours,
  eventStatuses,
  mapEmbedUrl,
  shiftMonth,
  validateEvent,
} from "@/lib/calendar";
import { Empty, Field, Modal, SectionTitle, Stat } from "./ui";

const longDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const timeRange = (event: CalendarEvent) =>
  `${event.start_time.slice(0, 5)} – ${event.end_time.slice(0, 5)}`;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "No se pudo completar la operación.";

export function Calendar({ data, canWrite, notify }: Shared) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [day, setDay] = useState(today);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const rows = await readAll<CalendarEvent>("rl_events");
      if (sequence !== request.current) return;
      setEvents(
        rows.sort((a, b) =>
          `${a.date} ${a.start_time}`.localeCompare(
            `${b.date} ${b.start_time}`,
          ),
        ),
      );
      setFailure("");
    } catch (error) {
      if (sequence !== request.current) return;
      const message = errorMessage(error);
      setFailure(
        /rl_events|schema cache/.test(message)
          ? "Para activar el calendario, aplica migrations/033_calendario.sql en el SQL Editor de Supabase y pulsa Actualizar."
          : message,
      );
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  const clientName = (id: string) =>
    data.clients.find((c) => c.id === id)?.name || "Cliente no disponible";
  const filtered = events.filter(
    (event) =>
      (category === "all" || event.category === category) &&
      (status === "all" || event.status === status) &&
      searchText(
        `${event.title} ${clientName(event.client_id)} ${event.location} ${event.participant_names}`,
      ).includes(searchText(query)),
  );
  const monthEvents = filtered.filter((event) => event.date.startsWith(month));
  const activeEvents = monthEvents.filter(
    (event) => event.status !== "cancelled",
  );
  const dayEvents = filtered.filter((event) => event.date === day);
  const detail = events.find((event) => event.id === selected);
  const clients = [...data.clients].sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );
  function newEvent(date = day) {
    setFormError("");
    setEdit({
      id: crypto.randomUUID(),
      version: 0,
      title: "",
      client_id: "",
      date,
      start_time: "10:00",
      end_time: "12:00",
      location: "",
      map_url: "",
      price: 0,
      participants: 0,
      participant_names: "",
      category: "workshop",
      status: "planned",
      notes: "",
    });
  }
  function changeMonth(next: string) {
    if (!/^\d{4}-\d{2}$/.test(next)) return;
    setMonth(next);
    setDay(`${next}-01`);
  }
  function chooseDay(next: string) {
    setDay(next);
    setMonth(next.slice(0, 7));
  }
  function update<K extends keyof CalendarEvent>(
    key: K,
    value: CalendarEvent[K],
  ) {
    setEdit((current) => (current ? { ...current, [key]: value } : null));
  }
  async function save() {
    if (!edit || !canWrite || busy) return;
    const validation = validateEvent(edit);
    if (validation) {
      setFormError(validation);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await rpc("rl_save_event", {
        p: {
          ...edit,
          title: edit.title.trim(),
          location: edit.location.trim(),
          map_url: edit.map_url.trim() ? mapEmbedUrl(edit.map_url) : "",
        },
      });
      chooseDay(edit.date);
      setEdit(null);
      setSelected(null);
      notify("Evento guardado");
      await load();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove(event: CalendarEvent) {
    if (
      !canWrite ||
      busy ||
      !window.confirm(`¿Eliminar «${event.title}» del calendario?`)
    )
      return;
    setBusy(true);
    try {
      await rpc("rl_delete_event", {
        p_id: event.id,
        p_version: event.version,
      });
      setSelected(null);
      notify("Evento eliminado");
      await load();
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }
  function eventCard(event: CalendarEvent) {
    return (
      <button
        key={event.id}
        className={`event-card event-${eventCategories[event.category].color} ${event.status === "cancelled" ? "event-cancelled" : ""}`}
        onClick={() => setSelected(event.id)}
      >
        <span className="event-card-top">
          <span className="event-type">
            {eventCategories[event.category].label}
          </span>
          <span className={`event-status status-${event.status}`}>
            {eventStatuses[event.status]}
          </span>
        </span>
        <strong>{event.title}</strong>
        <span className="event-client">{clientName(event.client_id)}</span>
        <span className="event-card-meta">
          <span>
            <Clock3 size={13} />
            {timeRange(event)}
          </span>
          <span>
            <Users size={13} />
            {event.participants}
          </span>
        </span>
        <span className="event-card-bottom">
          <span>
            <MapPin size={13} />
            {event.location}
          </span>
          <b>{money(event.price)}</b>
        </span>
      </button>
    );
  }
  return (
    <>
      <SectionTitle
        eyebrow="CADA PLAN, EN SU SITIO"
        title="Calendario de eventos"
        description="Talleres, celebraciones y encuentros. Todo listo para el próximo gran día."
        actions={
          <>
            <button onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              Actualizar
            </button>
            {canWrite && (
              <button
                className="primary"
                onClick={() => newEvent()}
                disabled={loading || !!failure}
              >
                <Plus size={17} />
                Nuevo evento
              </button>
            )}
          </>
        }
      />
      {failure && (
        <div className="alert error" role="alert">
          {failure}
        </div>
      )}
      <div className="stats-grid calendar-stats">
        <Stat
          label="Eventos del mes"
          value={String(monthEvents.length)}
          detail="Según los filtros seleccionados"
          icon={<CalendarDays size={18} />}
          accent
        />
        <Stat
          label="Horas programadas"
          value={`${qty(activeEvents.reduce((sum, event) => sum + eventHours(event), 0))} h`}
          detail="Duración total · sin cancelados"
          icon={<Clock3 size={18} />}
        />
        <Stat
          label="Participantes previstos"
          value={qty(
            activeEvents.reduce((sum, event) => sum + event.participants, 0),
          )}
          detail="Suma de plazas · sin cancelados"
          icon={<Users size={18} />}
        />
        <Stat
          label="Importe previsto"
          value={money(
            activeEvents.reduce((sum, event) => sum + Number(event.price), 0),
          )}
          detail="Precio total de eventos · sin cancelados"
          icon={<Euro size={18} />}
        />
      </div>
      <section
        className="panel calendar-controls"
        aria-label="Controles del calendario"
      >
        <div className="calendar-toolbar">
          <div className="calendar-month-nav">
            <button
              className="icon-button"
              aria-label="Mes anterior"
              onClick={() => changeMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={20} />
            </button>
            <h2 className="capitalize">{monthLabel(month)}</h2>
            <button
              className="icon-button"
              aria-label="Mes siguiente"
              onClick={() => changeMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={20} />
            </button>
            <button onClick={() => chooseDay(today())}>Hoy</button>
          </div>
          <div className="calendar-view">
            <button
              aria-pressed={view === "month"}
              onClick={() => setView("month")}
            >
              <CalendarDays size={15} />
              Mes
            </button>
            <button
              aria-pressed={view === "agenda"}
              onClick={() => setView("agenda")}
            >
              <List size={15} />
              Agenda
            </button>
          </div>
        </div>
        <div className="calendar-filters">
          <div className="input-search">
            <Search size={16} />
            <input
              aria-label="Buscar eventos"
              placeholder="Buscar evento, cliente o lugar…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <input
            type="month"
            aria-label="Mes del calendario"
            value={month}
            onChange={(e) => changeMonth(e.target.value)}
          />
          <select
            aria-label="Tipo de evento"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Todos los tipos</option>
            {Object.entries(eventCategories).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Estado del evento"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Todos los estados</option>
            {Object.entries(eventStatuses).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </section>
      {loading && (
        <p className="calendar-loading" role="status">
          Cargando eventos…
        </p>
      )}
      {!failure && (
        <div className="calendar-layout" aria-busy={loading}>
          <section className="panel calendar-main">
            {view === "month" ? (
              <div className="calendar-scroll">
                <div className="calendar-grid">
                  {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(
                    (label) => (
                      <div className="calendar-weekday" key={label}>
                        {label}
                      </div>
                    ),
                  )}
                  {calendarDays(month).map((date) => {
                    const rows = filtered.filter(
                      (event) => event.date === date,
                    );
                    return (
                      <div
                        key={date}
                        className={`calendar-day ${!date.startsWith(month) ? "outside" : ""} ${date === day ? "selected" : ""} ${date === today() ? "today" : ""}`}
                      >
                        <button
                          className="calendar-day-number"
                          aria-label={`Ver ${longDate(date)}`}
                          aria-pressed={day === date}
                          aria-current={date === today() ? "date" : undefined}
                          onClick={() => chooseDay(date)}
                        >
                          {Number(date.slice(-2))}
                          <span className="calendar-day-count">
                            {rows.length > 0 ? `${rows.length} ev.` : ""}
                          </span>
                        </button>
                        <div className="calendar-day-events">
                          {rows.slice(0, 3).map((event) => (
                            <button
                              key={event.id}
                              title={`${event.title} · ${clientName(event.client_id)} · ${timeRange(event)} · ${eventStatuses[event.status]}`}
                              className={`calendar-chip event-${eventCategories[event.category].color} ${event.status === "cancelled" ? "event-cancelled" : ""}`}
                              onClick={() => {
                                setDay(date);
                                setSelected(event.id);
                              }}
                            >
                              <span>{event.start_time.slice(0, 5)}</span>
                              <strong>{event.title}</strong>
                            </button>
                          ))}
                        </div>
                        {rows.length > 3 && (
                          <button
                            className="calendar-more"
                            onClick={() => chooseDay(date)}
                          >
                            +{rows.length - 3} más
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="calendar-agenda">
                {monthEvents.length ? (
                  Array.from(
                    new Set(monthEvents.map((event) => event.date)),
                  ).map((date) => (
                    <section className="agenda-group" key={date}>
                      <h3 className="capitalize">{longDate(date)}</h3>
                      <div className="agenda-cards">
                        {monthEvents
                          .filter((event) => event.date === date)
                          .map(eventCard)}
                      </div>
                    </section>
                  ))
                ) : (
                  <Empty
                    title="Tu agenda tiene espacio"
                    text="No hay eventos este mes con los filtros actuales."
                    action={
                      canWrite && (
                        <button onClick={() => newEvent()}>
                          <Plus size={15} />
                          Crear evento
                        </button>
                      )
                    }
                  />
                )}
              </div>
            )}
            <div className="calendar-legend">
              {Object.entries(eventCategories).map(([key, value]) => (
                <span className={`event-${value.color}`} key={key}>
                  <i />
                  {value.label}
                </span>
              ))}
              <small>Horario de Madrid</small>
            </div>
          </section>
          <aside className="panel calendar-day-panel">
            <div className="calendar-day-heading">
              <span className="eyebrow">TU DÍA, DE UN VISTAZO</span>
              <h3 className="capitalize">{longDate(day)}</h3>
              <p>
                {dayEvents.length}{" "}
                {dayEvents.length === 1 ? "evento" : "eventos"} en la agenda
              </p>
            </div>
            <div className="calendar-day-list">
              {dayEvents.length ? (
                dayEvents.map(eventCard)
              ) : (
                <div className="calendar-free">
                  <CalendarDays size={32} />
                  <h3>Un día por planear</h3>
                  <p>Selecciona otro día o añade un evento para empezar.</p>
                </div>
              )}
            </div>
            {canWrite && (
              <button
                className="calendar-add-day"
                disabled={loading}
                onClick={() => newEvent()}
              >
                <Plus size={16} />
                Añadir a este día
              </button>
            )}
          </aside>
        </div>
      )}
      {detail && !edit && (
        <Modal
          title="Detalle del evento"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
          wide
        >
          <div
            className={`modal-body event-detail event-${eventCategories[detail.category].color}`}
            aria-busy={busy}
          >
            <div className="event-detail-banner">
              <span className="event-type">
                {eventCategories[detail.category].label}
              </span>
              <h2>{detail.title}</h2>
              <p>{clientName(detail.client_id)}</p>
              <span className={`event-status status-${detail.status}`}>
                {eventStatuses[detail.status]}
              </span>
            </div>
            <div className="event-detail-facts">
              <div>
                <CalendarDays size={18} />
                <span>
                  Fecha
                  <strong className="capitalize">
                    {longDate(detail.date)} de {detail.date.slice(0, 4)}
                  </strong>
                </span>
              </div>
              <div>
                <Clock3 size={18} />
                <span>
                  Horario · Madrid
                  <strong>
                    {timeRange(detail)} · {qty(eventHours(detail))} h
                  </strong>
                </span>
              </div>
              <div>
                <Users size={18} />
                <span>
                  Participantes<strong>{detail.participants} personas</strong>
                </span>
              </div>
              <div>
                <Euro size={18} />
                <span>
                  Precio total<strong>{money(detail.price)}</strong>
                </span>
              </div>
            </div>
            {detail.participant_names && (
              <div className="event-notes">
                <h3>Participantes y grupos</h3>
                <p className="pre-line">{detail.participant_names}</p>
              </div>
            )}
            <div className="event-location">
              <h3>
                <MapPin size={17} />
                {detail.location}
              </h3>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detail.location)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir en Google Maps <ExternalLink size={13} />
              </a>
            </div>
            {mapEmbedUrl(detail.map_url, detail.location) && (
              <iframe
                className="event-map"
                title={`Mapa de ${detail.location}`}
                src={mapEmbedUrl(detail.map_url, detail.location)!}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            )}
            {detail.notes && (
              <div className="event-notes">
                <h3>Notas del evento</h3>
                <p className="pre-line">{detail.notes}</p>
              </div>
            )}
          </div>
          {canWrite && (
            <div className="modal-footer">
              <button
                disabled={busy}
                className="event-delete"
                onClick={() => void remove(detail)}
              >
                <Trash2 size={15} />
                Eliminar
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={() => {
                  setFormError("");
                  setEdit({
                    ...detail,
                    start_time: detail.start_time.slice(0, 5),
                    end_time: detail.end_time.slice(0, 5),
                  });
                }}
              >
                <Pencil size={15} />
                Editar evento
              </button>
            </div>
          )}
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit.version ? "Editar evento" : "Nuevo evento"}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
          wide
        >
          <form
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy} className="modal-body event-form">
              <div className="event-form-intro">
                <CalendarDays size={24} />
                <div>
                  <strong>Prepara un día especial</strong>
                  <p>
                    Los detalles claros, para que solo tengas que disfrutar del
                    evento.
                  </p>
                </div>
              </div>
              {formError && (
                <div className="alert error" role="alert">
                  {formError}
                </div>
              )}
              {!clients.length && (
                <div className="alert">
                  Crea primero un cliente en «Clientes y alumnos» para vincular
                  el evento.
                </div>
              )}
              <Field label="Nombre del evento">
                <input
                  required
                  maxLength={200}
                  placeholder="Ej. Taller de robótica creativa"
                  value={edit.title}
                  onChange={(e) => update("title", e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Cliente">
                  <select
                  required
                  aria-label="Cliente"
                  value={edit.client_id}
                    onChange={(e) => update("client_id", e.target.value)}
                  >
                    <option value="">Selecciona un cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                        {client.active === false ? " (inactivo)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Estado">
                  <select
                  aria-label="Estado"
                  value={edit.status}
                    onChange={(e) =>
                      update(
                        "status",
                        e.target.value as CalendarEvent["status"],
                      )
                    }
                  >
                    {Object.entries(eventStatuses).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <fieldset className="event-category-picker">
                <legend>Tipo de evento · color en el calendario</legend>
                <div>
                  {Object.entries(eventCategories).map(([key, value]) => (
                    <label
                      className={`event-category-option event-${value.color} ${edit.category === key ? "chosen" : ""}`}
                      key={key}
                    >
                      <input
                        type="radio"
                        name="event-category"
                        value={key}
                        checked={edit.category === key}
                        onChange={() =>
                          update("category", key as CalendarEvent["category"])
                        }
                      />
                      <i />
                      {value.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="form-grid three">
                <Field label="Fecha">
                  <input
                    required
                    type="date"
                    value={edit.date}
                    onChange={(e) => update("date", e.target.value)}
                  />
                </Field>
                <Field label="Hora de inicio">
                  <input
                    required
                    type="time"
                    value={edit.start_time}
                    onChange={(e) => update("start_time", e.target.value)}
                  />
                </Field>
                <Field label="Hora de fin">
                  <input
                    required
                    type="time"
                    value={edit.end_time}
                    onChange={(e) => update("end_time", e.target.value)}
                  />
                </Field>
              </div>
              <p className="event-duration">
                <Clock3 size={14} />
                {eventHours(edit) > 0
                  ? `Duración: ${qty(eventHours(edit))} horas`
                  : "La hora de fin debe ser posterior al inicio"}{" "}
                · mismo día · horario de Madrid
              </p>
              <div className="form-grid">
                <Field
                  label="Precio total (€)"
                  hint="Importe previsto del evento, no por participante."
                >
                  <input
                    required
                    type="number"
                    min="0"
                    max="9999999999.99"
                    step="0.01"
                    value={Number.isNaN(edit.price) ? "" : edit.price}
                    onChange={(e) =>
                      update(
                        "price",
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                </Field>
                <Field label="Número de participantes">
                  <input
                    required
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    value={
                      Number.isNaN(edit.participants) ? "" : edit.participants
                    }
                    onChange={(e) =>
                      update(
                        "participants",
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                </Field>
              </div>
              <Field label="Participantes y grupos (opcional)">
                <textarea
                  placeholder="Nombres, grupos o información para organizar la actividad…"
                  value={edit.participant_names}
                  onChange={(e) => update("participant_names", e.target.value)}
                />
              </Field>
              <Field
                label="Lugar y dirección"
                hint="El mapa se genera con esta dirección. Incluye calle, número y ciudad."
              >
                <input
                  required
                  maxLength={1000}
                  placeholder="Ej. Centro cultural, Calle Mayor 10, Madrid"
                  value={edit.location}
                  onChange={(e) => update("location", e.target.value)}
                />
              </Field>
              <Field
                label="Iframe de Google Maps (opcional)"
                hint="Para fijar un punto exacto: Google Maps → Compartir → Insertar un mapa. Pega el iframe o su URL."
              >
                <textarea
                  placeholder='<iframe src="https://www.google.com/maps/embed?pb=…"></iframe>'
                  value={edit.map_url}
                  onChange={(e) => update("map_url", e.target.value)}
                />
              </Field>
              <Field label="Notas (opcional)">
                <textarea
                  placeholder="Material necesario, contacto en el lugar, indicaciones…"
                  value={edit.notes}
                  onChange={(e) => update("notes", e.target.value)}
                />
              </Field>
            </fieldset>
            <div className="modal-footer">
              <button type="button" disabled={busy} data-dismiss-modal>
                Cancelar
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || !clients.length}
              >
                {busy ? "Guardando…" : "Guardar evento"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
