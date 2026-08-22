import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "@/components/side-nav";

export const metadata: Metadata = {
  title: "mine-brain · 思考伙伴",
  description: "个人生活的第二大脑：记住你、对照你、挑战你。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <div className="flex h-dvh overflow-hidden">
          <SideNav />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
