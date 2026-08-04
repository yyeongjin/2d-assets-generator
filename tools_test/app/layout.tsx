import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Forge — 4-Direction Character Test",
  description: "Generate one four-direction character sheet, then verify item-equipment consistency with RunPod Qwen Image Edit.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
