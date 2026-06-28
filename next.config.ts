import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist は Node 固有機能（fs / createRequire / import.meta.url）を使うため Server バンドルに含めず、
  // ランタイムの require で読む（バンドルすると壊れやすい）。Next docs: serverExternalPackages。
  serverExternalPackages: ["pdfjs-dist"],
  // pdfjs の cMap/標準フォントは fs.readFile(動的パス) で読むため @vercel/nft が追えず、本番バンドルから
  // 漏れると CID フォント（例: UniJIS-UCS2-H）が文字化けする。/api/chat 関数へ明示同梱する
  // （dev では node_modules 直読みで通るが本番では必須。go/no-go 条件2）。
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
    ],
  },
};

export default nextConfig;
