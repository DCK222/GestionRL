import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseClipboard,
  parseSheetValue,
  expectedFromHours,
} from "../src/lib/academy-sheet";
import { invoiceMatchesClient, searchText } from "../src/lib/clients";
import type { Client, Invoice, Enrollment } from "../src/lib/types";
test("sheet paste preserves quoted tabs, line breaks, empty cells and decimal commas", () => {
  assert.deepEqual(
    parseClipboard(
      '12,50\t"martes\tjueves"\t"nota\nsegunda línea"\n8\t\tfin\n',
    ),
    [
      ["12,50", "martes\tjueves", "nota\nsegunda línea"],
      ["8", "", "fin"],
    ],
  );
  assert.equal(parseSheetValue("paid", "1.234,56 €"), 1234.56);
  assert.equal(parseSheetValue("rate", "12.50"), 12.5);
  assert.equal(parseSheetValue("units", ""), null);
  assert.equal(parseSheetValue("billing_mode", "Por hora"), "hourly");
  assert.throws(() => parseSheetValue("paid", "=1+2"), /válido/);
  assert.throws(() => parseSheetValue("month_hours", "-1"), /negativo/);
  assert.throws(() => parseClipboard('"sin cierre'), /comillas/);
});
test("explicit expected calculation subtracts paid and advances with decimal rounding", () => {
  assert.equal(
    expectedFromHours({
      billing_mode: "hourly",
      month_hours: 3,
      rate: 19.99,
      paid: 10,
      advance: 5,
    } as Enrollment),
    "44.97",
  );
  assert.throws(
    () => expectedFromHours({ billing_mode: "pack" } as Enrollment),
    /Por hora/,
  );
});
test("client invoice matching uses identifiers or normalized tax id and search ignores accents", () => {
  const client = {
    id: "client",
    name: "José",
    tax_id: "B-123 456",
    address: "Madrid",
  } as Client;
  assert.equal(
    invoiceMatchesClient(
      {
        client_id: null,
        client_snapshot: { tax_id: "b123456" },
      } as unknown as Invoice,
      client,
    ),
    true,
  );
  assert.equal(
    invoiceMatchesClient(
      {
        client_id: "another",
        client_snapshot: { name: "José", tax_id: "OTHER" },
      } as Invoice,
      client,
    ),
    false,
  );
  assert.equal(searchText("  José  "), "jose");
});
