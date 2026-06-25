/**
 * doc_role（アップロード文書の役割）の定義・ラベル・多重度・受理拡張子。
 * doc_role 語彙の「単一の正」（PRD §8.1 / CLAUDE.md）。
 *
 * DB の CHECK 制約（case_files.doc_role in
 * ('applicant','oa','reference','claims')）および lib/database.types.ts と
 * 一致させること。補正書・意見書は新しい role を増やさず claims に格納する
 * （docs/phase1-plan.md）。本ファイルは秘密値を持たず、2b のクライアント
 * コンポーネント（FileUpload）からも import される想定なので server-only にしない。
 */

export type DocRole = "applicant" | "oa" | "reference" | "claims";

/** 役割ごとのメタ情報。UI（2b）はこの順序・ラベルで表示する。 */
export type DocRoleMeta = {
  role: DocRole;
  /** UI 表示用の日本語ラベル。 */
  label: string;
  /** true なら1案件につき1件のみ（applicant）。false は複数可。 */
  single: boolean;
};

/** 表示順を持つ doc_role メタ一覧（applicant → oa → reference → claims）。 */
export const DOC_ROLES: readonly DocRoleMeta[] = [
  { role: "applicant", label: "本願明細書", single: true },
  { role: "oa", label: "OA（拒絶理由）", single: false },
  { role: "reference", label: "引用文献", single: false },
  { role: "claims", label: "現クレーム", single: false },
] as const;

/** 指定 role のメタを返す（未知の role は undefined）。 */
function metaFor(role: DocRole): DocRoleMeta | undefined {
  return DOC_ROLES.find((m) => m.role === role);
}

/** 指定 role が単一（applicant のみ）かどうか。 */
export function isSingleRole(role: DocRole): boolean {
  return metaFor(role)?.single ?? false;
}

/** 指定 role の日本語ラベル。 */
export function labelForRole(role: DocRole): string {
  return metaFor(role)?.label ?? role;
}

/** 任意の文字列が DocRole か検証する（Server Action 入力の検証用）。 */
export function isDocRole(value: string): value is DocRole {
  return DOC_ROLES.some((m) => m.role === value);
}

/**
 * 受理する拡張子（小文字・ドットなし）。
 * PDF は Claude ネイティブ読込（Files API）、その他はサーバー側でテキスト抽出
 * （PRD §7.3、CLAUDE.md ガードレール5）。
 */
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "txt", "md", "csv"] as const;
export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

/** input[type=file] の accept 属性などに使える文字列（".pdf,.docx,..."）。 */
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** ファイル名から拡張子（小文字・ドットなし）を取り出す。拡張子なしは ""。 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** 受理拡張子かどうか。 */
export function isAcceptedExtension(ext: string): ext is AcceptedExtension {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}
