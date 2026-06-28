import "server-only";

import path from "node:path";

/**
 * テキスト層のある PDF をコードで全文抽出する（PRD §7.5 / docs/slice3-step2-plan.md）。
 *
 * Step2 解析で、テキスト層を持つ大部・日本語 PDF を Claude に vision 文字起こしさせると出力トークンが
 * 爆発し完走できない（実測: 引用文献2 で約6分・接続切断）。そこでテキスト層はコードで抽出し、Claude には
 * summary のみ生成させる（route 側で analyzeNonPdf 経路に合流）。スキャン/文字化け PDF だけ従来 vision に
 * 残すため、品質判定 ok:false を返して呼び出し側で vision にフォールバックさせる（回帰なし・安全側）。
 *
 * pdfjs はテキスト層抽出であり OCR ではない（CLAUDE.md ガードレール5）。描画はせず canvas も使わない。
 * 抽出本文はログに出さない（ガードレール7）。pdfjs-dist は next.config の serverExternalPackages で
 * バンドル対象外にし、cmaps/standard_fonts は outputFileTracingIncludes で /api/chat へ同梱する前提。
 */

/**
 * pdfjs v6 の factory URL（cMapUrl/standardFontDataUrl）は末尾「/」(前方スラッシュ) 必須で、Node factory は
 * `fs.readFile(`${url}${name}`)` で読む（pdfjs-dist/legacy/build/pdf.mjs）。よって file:// URL ではなく素の
 * ファイルパスを渡す。Windows の path.sep は「\」で getFactoryUrlProp に弾かれるため前方スラッシュへ正規化し
 * 末尾 / を付ける（Linux/Vercel では replaceAll は無害。fs.readFile は Windows でも前方スラッシュを受ける）。
 */
function pdfjsDataUrl(subdir: "cmaps" | "standard_fonts"): string {
  return path.join(process.cwd(), "node_modules", "pdfjs-dist", subdir).replaceAll("\\", "/") + "/";
}

/** 抽出結果。ok=false はスキャン/文字化けで、呼び出し側が vision にフォールバックする合図。 */
export type PdfTextResult = { text: string; ok: boolean; reason?: string };

// 品質しきい値（暫定。docs/slice3-step2-plan.md）。
const MIN_CHARS_PER_PAGE = 50; // 1ページ平均がこれ未満 = スキャン or 抽出失敗
const MAX_BAD_RATIO = 0.1; // 私用領域/置換文字/制御文字の比率がこれ超 = 文字化け

/** code point が「化け」（私用領域 U+E000–F8FF / U+FFFD / 制御文字。TAB・改行・復帰は除く）か。 */
function isBadCodePoint(c: number): boolean {
  if (c >= 0xe000 && c <= 0xf8ff) return true;
  if (c === 0xfffd) return true;
  if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  return false;
}

/**
 * PDF（Blob）の全ページからテキスト層を抽出し、品質判定を添えて返す。
 * 品質OK なら呼び出し側は extracted_text に保存して summary のみ生成、NG なら vision にフォールバックする。
 */
export async function extractPdfText(blob: Blob): Promise<PdfTextResult> {
  // pdfjs-dist は ESM 専用。動的 import で ESM をネイティブに読み込み、Next の server 出力が CJS でも
  // require(ESM) 失敗を避ける。読込/抽出に失敗してもストリーム内 try で捕捉され、該当文書のみ vision に
  // フォールバックする（ルート全体の 500 にしない）。serverExternalPackages でバンドル対象外。
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    cMapUrl: pdfjsDataUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfjsDataUrl("standard_fonts"),
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;

  const numPages = doc.numPages;
  try {
    let text = "";
    for (let p = 1; p <= numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const tc = await page.getTextContent();
        for (const item of tc.items) {
          if ("str" in item) {
            text += item.str;
            if (item.hasEOL) text += "\n";
          }
        }
        text += "\n";
      } finally {
        page.cleanup();
      }
    }

    // 品質判定（UTF-16 ではなく code point 単位で走査）。
    let cp = 0;
    let bad = 0;
    for (const ch of text) {
      cp += 1;
      if (isBadCodePoint(ch.codePointAt(0) ?? 0)) bad += 1;
    }
    if (cp / Math.max(1, numPages) < MIN_CHARS_PER_PAGE) {
      return { text, ok: false, reason: "low-text" };
    }
    if (bad / Math.max(1, cp) > MAX_BAD_RATIO) {
      return { text, ok: false, reason: "garbled" };
    }
    return { text, ok: true };
  } finally {
    // PDFDocumentLoadingTask.destroy() がドキュメントと（fake）worker をまとめて解放する。
    await loadingTask.destroy();
  }
}
