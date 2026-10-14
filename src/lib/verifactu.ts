import { createHash } from "node:crypto";
import { request } from "node:https";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { FiscalRecord, Invoice } from "./types";
export const AEAT_ENDPOINTS = {
  test: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  production:
    "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};
export function hash(input: string) {
  return createHash("sha256").update(input, "utf8").digest("hex").toUpperCase();
}
export function fiscalDate(date: string) {
  return date.split("-").reverse().join("-");
}
const xml = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const tag = (name: string, value: unknown) =>
  `<sum1:${name}>${xml(value)}</sum1:${name}>`;
const amount = (n: number) => Number(n).toFixed(2);
export { qrUrl } from "./qr";
export type Producer = { name: string; nif: string; installation: string };
export function buildFiscalXml(
  r: FiscalRecord,
  producer: Producer,
  rectified?: Invoice,
) {
  const i = r.payload.invoice;
  const previous = r.payload.previous;
  if (hash(r.hash_input) !== r.hash)
    throw new Error("La huella del registro no coincide");
  if (!i.number || !producer.name || !producer.nif)
    throw new Error("Faltan datos del emisor del software o de la factura");
  const identity = (inv: Invoice) =>
    tag("IDEmisorFactura", inv.issuer_snapshot.tax_id) +
    tag("NumSerieFactura", inv.number) +
    tag("FechaExpedicionFactura", fiscalDate(inv.date));
  const groups = new Map<number, { base: number; vat: number }>();
  for (const l of i.lines) {
    const g = groups.get(l.vat_rate) || { base: 0, vat: 0 };
    g.base += Number(l.base || 0);
    g.vat += Number(l.vat || 0);
    groups.set(l.vat_rate, g);
  }
  const breakdown = [...groups.entries()]
    .map(
      ([rate, g]) =>
        "<sum1:DetalleDesglose>" +
        tag("Impuesto", "01") +
        tag("ClaveRegimen", "01") +
        (rate === 0
          ? tag("OperacionExenta", "E1")
          : tag("CalificacionOperacion", "S1") +
            tag("TipoImpositivo", amount(rate))) +
        tag("BaseImponibleOimporteNoSujeto", amount(g.base)) +
        (rate === 0 ? "" : tag("CuotaRepercutida", amount(g.vat))) +
        "</sum1:DetalleDesglose>",
    )
    .join("");
  let rectification = "";
  if (i.invoice_type !== "F1") {
    if (!rectified) throw new Error("Falta la factura rectificada");
    rectification =
      tag("TipoRectificativa", "I") +
      "<sum1:FacturasRectificadas><sum1:IDFacturaRectificada>" +
      identity(rectified) +
      "</sum1:IDFacturaRectificada></sum1:FacturasRectificadas>";
  }
  const body =
    tag("IDVersion", "1.0") +
    "<sum1:IDFactura>" +
    identity(i) +
    "</sum1:IDFactura>" +
    tag("NombreRazonEmisor", i.issuer_snapshot.name) +
    tag("TipoFactura", i.invoice_type) +
    rectification +
    (i.project_date && i.project_date !== i.date
      ? tag("FechaOperacion", fiscalDate(i.project_date))
      : "") +
    tag(
      "DescripcionOperacion",
      i.lines
        .map((l) => l.description)
        .join("; ")
        .slice(0, 500),
    ) +
    "<sum1:Destinatarios><sum1:IDDestinatario>" +
    tag("NombreRazon", i.client_snapshot.name) +
    tag("NIF", i.client_snapshot.tax_id) +
    "</sum1:IDDestinatario></sum1:Destinatarios><sum1:Desglose>" +
    breakdown +
    "</sum1:Desglose>" +
    tag("CuotaTotal", amount(i.vat)) +
    tag("ImporteTotal", amount(i.subtotal + i.vat)) +
    "<sum1:Encadenamiento>" +
    (previous
      ? "<sum1:RegistroAnterior>" +
        identity(previous) +
        tag("Huella", r.previous_hash) +
        "</sum1:RegistroAnterior>"
      : tag("PrimerRegistro", "S")) +
    "</sum1:Encadenamiento><sum1:SistemaInformatico>" +
    tag("NombreRazon", producer.name) +
    tag("NIF", producer.nif) +
    tag("NombreSistemaInformatico", "Roboticlab Gestion") +
    tag("IdSistemaInformatico", "RL") +
    tag("Version", "1.0.0") +
    tag("NumeroInstalacion", producer.installation) +
    tag("TipoUsoPosibleSoloVerifactu", "N") +
    tag("TipoUsoPosibleMultiOT", "N") +
    tag("IndicadorMultiplesOT", "N") +
    "</sum1:SistemaInformatico>" +
    tag("FechaHoraHusoGenRegistro", r.payload.timestamp) +
    tag("TipoHuella", "01") +
    tag("Huella", r.hash);
  const output = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd" xmlns:sum1="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd"><soapenv:Header/><soapenv:Body><sum:RegFactuSistemaFacturacion><sum:Cabecera><sum1:ObligadoEmision>${tag("NombreRazon", i.issuer_snapshot.name)}${tag("NIF", i.issuer_snapshot.tax_id)}</sum1:ObligadoEmision></sum:Cabecera><sum:RegistroFactura><sum1:RegistroAlta>${body}</sum1:RegistroAlta></sum:RegistroFactura></sum:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;
  if (XMLValidator.validate(output) !== true) throw new Error("XML no válido");
  return output;
}
export function parseAeatResponse(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Respuesta XML no permitida");
  if (XMLValidator.validate(text) !== true)
    throw new Error("La AEAT no devolvió un XML válido");
  const parsed = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: false,
  }).parse(text);
  const body = parsed?.Envelope?.Body;
  if (body?.Fault)
    throw new Error(`AEAT: ${body.Fault.faultstring || "Error SOAP"}`);
  const response = body?.RespuestaRegFactuSistemaFacturacion;
  const line = Array.isArray(response?.RespuestaLinea)
    ? response.RespuestaLinea[0]
    : response?.RespuestaLinea;
  const state = line?.EstadoRegistro;
  const duplicate = line?.RegistroDuplicado?.EstadoRegistroDuplicado;
  const status =
    state === "Correcto"
      ? "accepted"
      : state === "AceptadoConErrores"
        ? "accepted_with_errors"
        : duplicate === "Correcto"
          ? "accepted"
          : duplicate === "AceptadoConErrores"
            ? "accepted_with_errors"
            : state === "Incorrecto"
              ? "rejected"
              : "uncertain";
  return {
    status,
    csv: response?.CSV || null,
    wait: Number(response?.TiempoEsperaEnvio) || 60,
    code: line?.CodigoErrorRegistro || null,
    message: line?.DescripcionErrorRegistro || null,
  };
}
export function sendAeat(
  environment: "test" | "production",
  body: string,
  pfx: string,
  passphrase: string,
) {
  return new Promise<string>((resolve, reject) => {
    const req = request(
      AEAT_ENDPOINTS[environment],
      {
        method: "POST",
        pfx: Buffer.from(pfx, "base64"),
        passphrase,
        minVersion: "TLSv1.2",
        timeout: 25000,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let output = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          output += chunk;
          if (output.length > 1_000_000) {
            req.destroy(new Error("Respuesta excesiva"));
          }
        });
        res.on("end", () => {
          if (res.statusCode !== 200)
            reject(
              new Error(
                `AEAT devolvió HTTP ${res.statusCode}; comprobar el estado antes de repetir`,
              ),
            );
          else resolve(output);
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(
        new Error("Tiempo de espera agotado; resultado de envío desconocido"),
      ),
    );
    req.on("error", reject);
    req.end(body);
  });
}
