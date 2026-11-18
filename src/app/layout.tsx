import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inception Tree Map",
  description: "Every tree, school and community of Inception e.V. in Uganda",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
