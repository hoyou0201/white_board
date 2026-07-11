import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memo Board",
  description: "An infinite whiteboard for notes, sticky ideas, and arrows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
