import "server-only";

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import type { DocxDocKind, DocxResult } from "@/lib/steps/schemas";

/**
 * S14 書面出力の .docx 生成（PRD §7.7 / §11-S14 / CLAUDE.md ガードレール6）。
 *
 * Claude にはバイナリを作らせず構造化テキスト（見出し・本文＝DocxResult）を出させ、ここで `docx` ライブラリを
 * 使って実ファイル（Buffer）を組み立てる。**純関数・I/O なし**（Storage 保存・署名 URL は dispatch 層の責務）。
 * server-only（実行はサーバーのみ。本文はログに出さない＝ガードレール7）。
 */

/** doc_kind → 日本語ラベル（ダウンロードファイル名・既定タイトルに使用）。 */
const DOC_KIND_LABEL: Record<DocxDocKind, string> = {
  amendment: "補正書",
  opinion: "意見書",
  view: "見解書",
};

/** 生成した 1 書面の .docx（Buffer）と表示用メタ。 */
export type DocxFile = {
  docKind: DocxDocKind;
  /** 書面タイトル。 */
  title: string;
  /** ダウンロード時のファイル名（例: 補正書.docx）。 */
  fileName: string;
  /** .docx バイナリ。 */
  buffer: Buffer;
};

/** 本文（改行区切り）を段落（Paragraph）の配列に変換する。 */
function bodyParagraphs(body: string): Paragraph[] {
  const lines = (body ?? "").split("\n");
  return lines.map(
    (line) => new Paragraph({ children: [new TextRun(line)] }),
  );
}

/**
 * DocxResult（構造化テキスト）から書面ごとに .docx Buffer を生成する。
 * 各書面 = タイトル（見出し）＋ 各節（見出し＋本文段落）。Storage 保存・署名 URL は呼び出し側で行う。
 */
export async function buildDocxFiles(result: DocxResult): Promise<DocxFile[]> {
  const documents = result.documents ?? [];
  return Promise.all(
    documents.map(async (doc) => {
      const label = DOC_KIND_LABEL[doc.doc_kind] ?? "書面";
      const title = doc.title?.trim() || label;

      const children: Paragraph[] = [
        new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
      ];
      for (const s of doc.sections ?? []) {
        if (s.heading?.trim()) {
          children.push(
            new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }),
          );
        }
        children.push(...bodyParagraphs(s.body));
      }

      const document = new Document({ sections: [{ children }] });
      const buffer = await Packer.toBuffer(document);
      return {
        docKind: doc.doc_kind,
        title,
        fileName: `${label}.docx`,
        buffer,
      };
    }),
  );
}
