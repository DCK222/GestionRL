import type { CalendarEvent } from "./types";

export const eventCategories = {
  workshop: { label: "Taller", color: "blue" },
  birthday: { label: "Cumpleaños", color: "pink" },
  school: { label: "Colegio", color: "green" },
  meeting: { label: "Reunión", color: "purple" },
  other: { label: "Otro", color: "amber" },
} as const;
export const eventStatuses = {
  planned: "Pendiente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
} as const;

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarDays(month: string) {
  const first = new Date(`${month}-01T12:00:00`);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(first);
    day.setDate(first.getDate() + i);
    return dateKey(day);
  });
}
export function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return dateKey(date).slice(0, 7);
}
export function eventHours(
  event: Pick<CalendarEvent, "start_time" | "end_time">,
) {
  const minutes = (s: string) =>
    Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return (minutes(event.end_time) - minutes(event.start_time)) / 60;
}
// Extract only an allowlisted Google Maps URL; pasted HTML is never rendered.
export function mapEmbedUrl(input: string, location = "") {
  const value = input.trim();
  if (!value)
    return location.trim()
      ? `https://www.google.com/maps?q=${encodeURIComponent(location.trim())}&output=embed`
      : "";
  const source = value.startsWith("<")
    ? value.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    : value;
  if (!source) return null;
  try {
    const url = new URL(source.replace(/&amp;/g, "&"));
    if (
      url.protocol !== "https:" ||
      !["www.google.com", "maps.google.com", "www.google.es"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (
      url.pathname !== "/maps/embed" &&
      !url.pathname.startsWith("/maps/embed/") &&
      !(url.pathname === "/maps" && url.searchParams.get("output") === "embed")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function validateEvent(event: CalendarEvent) {
  if (!event.title.trim() || !event.client_id || !event.location.trim())
    return "Completa el título, el cliente y el lugar.";
  const parsed = new Date(`${event.date}T12:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
    !Number.isFinite(parsed.getTime()) ||
    dateKey(parsed) !== event.date
  )
    return "Selecciona una fecha válida.";
  const validTime = (value: string) =>
    /^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(value);
  if (
    !validTime(event.start_time) ||
    !validTime(event.end_time) ||
    eventHours(event) <= 0
  )
    return "La hora de fin debe ser posterior al inicio, en el mismo día.";
  if (
    !Number.isFinite(event.price) ||
    event.price < 0 ||
    event.price > 9999999999.99
  )
    return "Introduce un precio válido, igual o mayor que cero.";
  if (
    !Number.isInteger(event.participants) ||
    event.participants < 0 ||
    event.participants > 1000000
  )
    return "Introduce un número entero de participantes entre 0 y 1.000.000.";
  if (
    !Object.hasOwn(eventCategories, event.category) ||
    !Object.hasOwn(eventStatuses, event.status)
  )
    return "Selecciona un tipo y un estado válidos.";
  if (mapEmbedUrl(event.map_url) === null)
    return "Pega el iframe de Google Maps desde Compartir → Insertar un mapa, o deja el campo vacío para usar la dirección.";
  return "";
}
