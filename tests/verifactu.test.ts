import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  hash,
  qrUrl,
  parseAeatResponse,
  buildFiscalXml,
} from "../src/lib/verifactu";
import type { FiscalRecord, Invoice } from "../src/lib/types";
test("AEAT official SHA256 example", () => {
  const input =
    "IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00";
  assert.equal(
    hash(input),
    "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
  );
});
test("SOAP response distinguishes acceptance, errors and rejection", () => {
  for (const [state, expected] of [
    ["Correcto", "accepted"],
    ["AceptadoConErrores", "accepted_with_errors"],
    ["Incorrecto", "rejected"],
  ]) {
    const response = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><r:RespuestaRegFactuSistemaFacturacion xmlns:r="urn:test"><r:CSV>123ABC</r:CSV><r:TiempoEsperaEnvio>90</r:TiempoEsperaEnvio><r:RespuestaLinea><r:EstadoRegistro>${state}</r:EstadoRegistro></r:RespuestaLinea></r:RespuestaRegFactuSistemaFacturacion></soap:Body></soap:Envelope>`;
    assert.equal(parseAeatResponse(response).status, expected);
    assert.equal(parseAeatResponse(response).wait, 90);
  }
});
test("malformed responses and external entities are not accepted", () => {
  assert.throws(() => parseAeatResponse("<html>unavailable"), /válido/);
  assert.throws(() => parseAeatResponse("<!DOCTYPE x><x/>"), /permitida/);
});
test("QR uses gross fiscal total before IRPF and URL-encodes series", () => {
  const i = {
    environment: "test",
    issuer_snapshot: { tax_id: "89890001K" },
    number: "F&1",
    date: "2026-10-01",
    subtotal: 100,
    vat: 21,
    total: 106,
  } as Invoice;
  const url = new URL(qrUrl(i));
  assert.equal(url.searchParams.get("importe"), "121.00");
  assert.equal(url.searchParams.get("numserie"), "F&1");
  assert.equal(url.hostname, "prewww2.aeat.es");
});
test("XML preserves hash and escapes content, generates XSD fixtures", () => {
  const i = {
    id: "id",
    number: "TEST-F-2026-0001",
    date: "2026-10-01",
    project_date: "2026-10-01",
    environment: "test",
    issuer_snapshot: { tax_id: "11811679Y", name: "Javier García de Torres" },
    client_snapshot: { tax_id: "B87855433", name: "Cliente & compañía" },
    invoice_type: "F1",
    lines: [
      {
        description: "Taller <robot>",
        quantity: 1,
        price: 100,
        discount: 0,
        vat_rate: 0,
        base: 100,
        vat: 0,
      },
    ],
    subtotal: 100,
    vat: 0,
    total: 85,
    withholding: 15,
  } as Invoice;
  const input = "sample";
  const r = {
    hash: hash(input),
    hash_input: input,
    previous_hash: "",
    payload: {
      invoice: i,
      timestamp: "2026-10-01T10:00:00+00:00",
      previous: null,
    },
  } as FiscalRecord;
  const xml = buildFiscalXml(r, {
    name: "Productor de prueba",
    nif: "89890001K",
    installation: "TEST-01",
  });
  assert.ok(xml.includes("Cliente &amp; compañía"));
  assert.ok(xml.includes("Taller &lt;robot&gt;"));
  assert.ok(xml.includes("<sum1:OperacionExenta>E1</sum1:OperacionExenta>"));
  fs.mkdirSync("private-import/test-results", { recursive: true });
  fs.writeFileSync("private-import/test-results/alta.xml", xml);
  const corrected = {
    ...r,
    payload: {
      ...r.payload,
      invoice: {
        ...i,
        number: "TEST-R-2026-0001",
        invoice_type: "R1" as const,
      },
    },
  };
  fs.writeFileSync(
    "private-import/test-results/rectificativa.xml",
    buildFiscalXml(
      corrected,
      {
        name: "Productor de prueba",
        nif: "89890001K",
        installation: "TEST-01",
      },
      i,
    ),
  );
  assert.throws(
    () =>
      buildFiscalXml(
        { ...r, hash: "INVALID" },
        { name: "X", nif: "X", installation: "1" },
      ),
    /huella/,
  );
});
