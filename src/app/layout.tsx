import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SideNav } from "@/components/side-nav";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "mine-brain · 思考伙伴",
  description: "个人生活的第二大脑：记住你、对照你、挑战你。",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#101014" },
    { media: "(prefers-color-scheme: light)", color: "#fcf9f2" },
  ],
};

const themeInitScript = `(function(){try{var s=localStorage.getItem('mb_theme');if(s&&['obsidian','parchment','forest','roast','eink'].indexOf(s)!==-1){document.documentElement.setAttribute('data-theme',s);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
          suppressHydrationWarning
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <Providers>
          <div className="flex h-dvh flex-col-reverse md:flex-row overflow-hidden bg-background text-foreground">
            <SideNav />
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden relative">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
