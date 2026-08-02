import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Forge — 2D Asset Workbench",
  description: "Local layout, option, and history prototype for the 2D asset generator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
