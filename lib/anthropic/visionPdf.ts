import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getAnthropic } from "@/lib/anthropic/client";
import { deleteFile, uploadPdf } from "@/lib/anthropic/files";
import { type DocRole, labelForRole } from "@/lib/config/docRoles";
import { modelForStep, type ModelPref } from "@/lib/config/models";
import { splitPdfByPages } from "@/lib/extract/pdfSplit";
import { S2_SYSTEM_PROMPT } from "@/lib/prompts/step2";

/**
 * スキャン PDF（テキスト層なし）の vision 文字起こしを「1頁ずつ分割 → 並列転写 → 連結」で行う
 * （PRD §7.5 / docs/slice3-step2-plan.md §2b）。
 *
 * 単一 vision 呼び出し（route の旧 analyzePdf）は大部スキャンで (1) 生成が本番 Hobby の maxDuration=60s を
 * 超えて打ち切られ、(2) 出力長プレッシャーで密頁を黙って圧縮し取りこぼす（引用文献1: 単一≈59,715字 ↔
 * 1頁分割≈100,409字、dev 実測）。1頁チャンクなら密でも出力 ~1,500トークン・~45s に収まり、ページ数ぶんを
 * 単一ウェーブで並列実行すれば壁時計は「最遅1頁＋オーバーヘッド」（32頁で実測 transcribe 45.4s）。
 *
 * full_text のみを構造化出力で得る（summary は route 側で抽出済みテキストから analyzeNonPdf が作る）。
 * チャンクは Files API へ一時 upload し、終わったら best-effort で削除する（原本は別途 anthropic_file_id で
 * 保持）。機密本文はログに出さない（CLAUDE.md ガードレール7）。
 */

const FILES_API_BETA = "files-api-2025-04-14";

/** 1頁/チャンク。密頁でも 60s 未満を保証する粒度（dev 実測で確定）。 */
const PAGES_PER_CHUNK = 1;
/**
 * 並列度の上限。ページ数ぶん（単一ウェーブ）で回したいので 32頁規模まで一気に並列化する
 * （32並列で 429 なし・aggregate 545 tok/s を実測）。これを大きく超える頁数の純スキャンは単一ウェーブに
 * 収まらず 60s を超えうる（既知の限界。将来ページ永続化で対応）。
 */
const MAX_CONCURRENCY = 32;
/** 1チャンク（1頁）の出力上限。密頁でも ~1,600 トークンなので十分な余裕。 */
const CHUNK_MAX_TOKENS = 16000;

/** full_text のみの構造化出力スキーマ（object は additionalProperties:false + required 必須）。 */
const FULL_TEXT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["full_text"],
  properties: {
    full_text: { type: "string" },
  },
};

/**
 * 一時的なエラー（過負荷 529 / レート 429 / 5xx / 接続）だけ指数バックオフで数回リトライする。
 * 32 チャンクを同時に投げるとバーストで `overloaded_error` 等が単発で起きやすく、リトライ無しだと1チャンクの
 * 一時失敗でファイル全体が失敗→再送で全頁やり直しになる。refusal / max_tokens / 4xx（429除く）は即時 throw。
 * 追加遅延は最大でも ~1.8s 程度（0.6s, 1.2s）で 60s 予算を圧迫しない。
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retriable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError;
      if (!retriable || i >= attempts - 1) throw err;
      const backoff = 600 * 2 ** i + Math.random() * 400;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

/** 並列度を limit に制限して順番を保持したまま map する（チャンク数 ≤ limit なら全並列＝単一ウェーブ）。 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 1チャンク（file_id）を full_text のみ文字起こしする。空頁は "" を返す（白紙/図のみは正常）。 */
async function transcribeChunk(
  fileId: string,
  role: DocRole,
  fileName: string,
  pageCount: number,
  start: number,
  end: number,
  model?: ModelPref,
): Promise<string> {
  const final = await withRetry(() =>
    getAnthropic()
      .beta.messages.stream({
        model: modelForStep(2, model),
        max_tokens: CHUNK_MAX_TOKENS,
        thinking: { type: "disabled" },
        betas: [FILES_API_BETA],
        system: S2_SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: FULL_TEXT_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "file", file_id: fileId } },
              {
                type: "text",
                text: `この PDF（${labelForRole(role)}「${fileName}」）は全${pageCount}頁中 第${start}〜${end}頁の範囲です。本文(full_text)のみを省略せず原文に忠実に文字起こししてください。スキャン画像や図中の文字も内容を読み取ってください。`,
              },
            ],
          },
        ],
      })
      .finalMessage(),
  );

  // 解析失敗を黙って通さない（route の guardStop と同方針）。
  if (final.stop_reason === "refusal") {
    throw new Error("解析が拒否されました。文書の内容をご確認ください。");
  }
  if (final.stop_reason === "max_tokens") {
    throw new Error("文書のページが長すぎて解析が途中で打ち切られました。");
  }
  const block = final.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : null;
  if (!raw) {
    throw new Error("全文テキストを取得できませんでした。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("解析結果の形式が不正です。");
  }
  const rec = parsed as Record<string, unknown>;
  return typeof rec.full_text === "string" ? rec.full_text : "";
}

/**
 * スキャン PDF（Blob）を 1頁ずつ分割して並列に文字起こしし、ページ順に連結した full_text を返す。
 * route の vision 分岐から呼ぶ（download 済みの blob を再利用）。1チャンクでも失敗したらその文書を失敗扱いに
 * して全体をやり直す（再送で冪等に再試行）＝頁の黙った欠落を作らない。
 */
export async function transcribePdfByPages(
  blob: Blob,
  role: DocRole,
  fileName: string,
  model?: ModelPref,
): Promise<{ full_text: string }> {
  const { chunks, pageCount, ranges } = await splitPdfByPages(blob, PAGES_PER_CHUNK);
  if (pageCount === 0 || chunks.length === 0) {
    throw new Error("PDF のページを読み取れませんでした。");
  }

  // upload が一部成功した段階で例外が出ても finally で確実に後始末できるよう、配列に逐次格納する。
  const fileIds: (string | null)[] = new Array(chunks.length).fill(null);
  try {
    // チャンクを Files API へ並列 upload（uploadPdf 再利用）。
    await mapLimit(chunks, MAX_CONCURRENCY, async (bytes, i) => {
      const [s, e] = ranges[i];
      fileIds[i] = await withRetry(() =>
        uploadPdf(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          `${fileName}#p${s}-${e}.pdf`,
        ),
      );
    });

    // 各チャンクを full_text のみ並列転写 → ページ順に連結。
    const texts = await mapLimit(fileIds, MAX_CONCURRENCY, async (fileId, i) => {
      const [s, e] = ranges[i];
      return transcribeChunk(fileId as string, role, fileName, pageCount, s, e, model);
    });

    const full_text = texts.join("\n");
    if (!full_text.trim()) {
      throw new Error("全文テキストを取得できませんでした。");
    }
    return { full_text };
  } finally {
    // 一時アップロードしたチャンクは保持不要。best-effort 削除（失敗は無視）。
    await Promise.allSettled(
      fileIds.filter((id): id is string => Boolean(id)).map((id) => deleteFile(id)),
    );
  }
}
