import type { Metadata } from "next";
import { Newsreader, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// 見出し用セリフ（Claude Design の heading フォント）
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// 本文用（日本語）。CJK は巨大なので preload しない。
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "Office Action App",
  description: "各国特許庁のオフィスアクション応答を Claude で支援する社内アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${newsreader.variable} ${notoSansJP.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
