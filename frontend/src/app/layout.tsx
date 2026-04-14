import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AMDC Admin",
  description: "Automated Monitor & Debugger with Claude - Admin Page",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={cn("font-sans", geist.variable)}>
      <body className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-background p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
