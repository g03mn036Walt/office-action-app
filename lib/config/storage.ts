/**
 * アップロード文書を置く Storage バケット（migration 0003、path = {user_id}/{case_id}/{uuid}.{ext}）。
 *
 * "use server" ファイル（lib/cases/actions.ts）内のローカル定数だと、route handler から import できない
 * （"use server" は全 export が async server action 必須）。ただの定数モジュールとしてここに集約し、
 * actions.ts と app/api/chat/route.ts の双方がここを参照する。
 */
export const CASE_FILES_BUCKET = "case-files";
