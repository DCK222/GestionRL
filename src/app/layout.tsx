import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Roboticlab · Gestión",
  description: "Facturación, finanzas y gestión de clases de Roboticlab",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
