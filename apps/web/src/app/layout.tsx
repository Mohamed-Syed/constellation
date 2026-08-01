import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Constellation",
  description: "Enterprise plugin platform — the single pane of glass over every module.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
