import "server-only";

import mammoth from "mammoth";

import { extensionOf } from "@/lib/config/docRoles";

/**
 * 非 PDF 文書をプレーンテキストに抽出する（PRD §7.3、CLAUDE.md ガードレール5）。
 * - .docx → mammoth で本文抽出
 * - .txt / .md / .csv → デコードのみ
 * - .pdf → ここでは抽出しない（Claude ネイティブ読込／全文化は Slice 3 の Step2）
 *
 * 分岐は fileName の拡張子で判定する（ブラウザ提供の MIME は不正確なことがあるため）。
 * 抽出した本文はログ・レスポンスに垂れ流さない（機密保持、CLAUDE.md ガードレール7）。
 */
export async function extractText(blob: Blob, fileName: string): Promise<string> {
  const ext = extensionOf(fileName);
  switch (ext) {
    case "docx": {
      const buffer = Buffer.from(await blob.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case "txt":
    case "md":
    case "csv":
      return blob.text();
    case "pdf":
      throw new Error(
        "PDF はテキスト抽出の対象外です（Files API で参照し、全文化は Step2 で行います）",
      );
    default:
      throw new Error(`未対応の拡張子です: ${ext || "(なし)"}`);
  }
}
