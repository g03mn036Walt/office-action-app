import "server-only";

import { PDFDocument } from "pdf-lib";

/**
 * スキャン PDF（テキスト層なし）を vision 文字起こしする際の「ページ分割」（PRD §7.5 / docs/slice3-step2-plan.md §2b）。
 *
 * 単一 vision 呼び出しで大部スキャンの全文を一度に転写させると、(1) 生成時間が本番 Vercel(Hobby) の
 * maxDuration=60s を超えて関数が打ち切られ、(2) 出力長プレッシャーで密な頁を黙って圧縮し取りこぼす
 * （引用文献1: 単一呼び出し≈59,715字 ↔ 1頁分割≈100,409字、dev 実測）。そこで PDF を 1頁ずつのチャンクへ
 * 分割し、各チャンクを並列に文字起こしして連結する（lib/anthropic/visionPdf.ts）。1頁なら密でも出力
 * ~1,500トークン・~45s に収まり 60s 未満を保証できる。
 *
 * これは OCR ではなくページの物理分割（CLAUDE.md ガードレール5整合）。描画はせず canvas も使わない。
 * pdf-lib は純 JS（ネイティブ/動的 fs 依存なし）でそのままバンドルでき、next.config.ts の変更は不要
 * （pdfjs の serverExternalPackages / outputFileTracingIncludes には影響しない）。
 */

/** 分割結果。ranges[i] は 1始まりの包含範囲 [開始頁, 終了頁]（プロンプトの「第X〜Y頁」表示に使う）。 */
export type PdfSplit = {
  chunks: Uint8Array[];
  pageCount: number;
  ranges: [number, number][];
};

/**
 * PDF（Blob）を pagesPerChunk ページごとのチャンク（それぞれ独立した PDF バイト列）に分割する。
 * 既定は 1頁/チャンク（大部スキャンを 60s 未満で並列転写するため）。
 */
export async function splitPdfByPages(
  blob: Blob,
  pagesPerChunk = 1,
): Promise<PdfSplit> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // 暗号化（権利情報のみの軽い保護）でも読めるように ignoreEncryption。描画はしないので安全。
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = src.getPageCount();

  const chunks: Uint8Array[] = [];
  const ranges: [number, number][] = [];
  const step = Math.max(1, pagesPerChunk);
  for (let start = 0; start < pageCount; start += step) {
    const end = Math.min(start + step, pageCount); // 排他的（0始まり）
    const dst = await PDFDocument.create();
    const indices: number[] = [];
    for (let p = start; p < end; p++) indices.push(p);
    const pages = await dst.copyPages(src, indices);
    pages.forEach((pg) => dst.addPage(pg));
    chunks.push(await dst.save());
    ranges.push([start + 1, end]); // 1始まりの包含範囲
  }

  return { chunks, pageCount, ranges };
}
