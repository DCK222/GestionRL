import type { Invoice } from "./types";
export function qrUrl(i: Invoice) {
  const host =
    i.environment === "test"
      ? "https://prewww2.aeat.es"
      : "https://www2.agenciatributaria.gob.es";
  return (
    `${host}/wlpl/TIKE-CONT/ValidarQR?` +
    new URLSearchParams({
      nif: i.issuer_snapshot.tax_id,
      numserie: i.number || "",
      fecha: i.date.split("-").reverse().join("-"),
      importe: Number(i.subtotal + i.vat).toFixed(2),
    }).toString()
  );
}
