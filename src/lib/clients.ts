import type { Client, Invoice } from "./types";

export const searchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export const taxKey = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function invoiceMatchesClient(invoice: Invoice, client: Client) {
  if (invoice.client_id === client.id) return true;
  const tax = taxKey(client.tax_id);
  if (tax) return tax === taxKey(invoice.client_snapshot.tax_id || "");
  return (
    !invoice.client_id &&
    searchText(invoice.client_snapshot.name || "") ===
      searchText(client.name) &&
    searchText(invoice.client_snapshot.address || "") ===
      searchText(client.address)
  );
}
