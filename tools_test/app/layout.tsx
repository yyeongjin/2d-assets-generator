import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCAIL-2 4-View Walk Factory",
  description: "Prepare four canonical references and one synchronized master walk, then manage four SCAIL-2 motion-transfer jobs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
