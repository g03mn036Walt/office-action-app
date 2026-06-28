/**
 * Step4+ の構造化出力スキーマ（Anthropic `output_config` の json_schema 用）。
 *
 * 制約（route.ts の PDF_SCHEMA と同流儀。Anthropic strict schema のサブセット）:
 * - object は `additionalProperties: false` と、全プロパティを列挙した `required` が必須。
 * - 数値範囲は `minimum`/`maximum` ではなく `enum`（離散値）か description で表現する
 *   （strict モードは min/max を解釈しないため）。
 *
 * スキーマはプロンプト（lib/prompts/step*.ts）と対で改善する想定。文言・構造はチューニング前提。
 */

/**
 * S4-S5 妥当性評価（PRD §11-S4）。
 * 請求項 × 構成要件（文節）× 引用文献の 5 段階チャート＋拒絶理由ごとの審査官の強い点／弱い点。
 * 5=妥当（＝当該構成が実際に開示されている）, 1=全く妥当でない。
 */
export const VALIDITY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "rejections", "overall"],
  properties: {
    claims: {
      type: "array",
      description: "請求項ごとの構成要件分解と引用文献照合",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim_no", "elements"],
        properties: {
          claim_no: { type: "string", description: "請求項番号（例: 1, 2）" },
          elements: {
            type: "array",
            description: "構成要件（文節）ごとの評価",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "assessments"],
              properties: {
                text: { type: "string", description: "構成要件（文節）の記載" },
                assessments: {
                  type: "array",
                  description: "各引用文献に対する 5 段階評価",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["reference", "score", "rationale"],
                    properties: {
                      reference: {
                        type: "string",
                        description: "引用文献の名称／番号",
                      },
                      score: {
                        type: "integer",
                        enum: [1, 2, 3, 4, 5],
                        description:
                          "5=当該構成が実際に開示されており審査官主張は妥当, 1=全く妥当でない",
                      },
                      rationale: {
                        type: "string",
                        description:
                          "根拠（引用文献の実際の開示内容と審査官主張の対比。過大解釈・欠落要素の指摘を含む）",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    rejections: {
      type: "array",
      description: "拒絶理由ごとの妥当性と審査官の強い点／弱い点",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "target_claims",
          "examiner_strong_points",
          "examiner_weak_points",
          "notes",
        ],
        properties: {
          type: {
            type: "string",
            description: "拒絶理由の種類（新規性／進歩性／記載要件／特許適格性／MPF 等）",
          },
          target_claims: {
            type: "array",
            items: { type: "string" },
            description: "対象請求項",
          },
          examiner_strong_points: {
            type: "array",
            items: { type: "string" },
            description: "審査官の主張が強い点",
          },
          examiner_weak_points: {
            type: "array",
            items: { type: "string" },
            description:
              "審査官の主張の弱点・誤り（過大解釈／クレーム解釈の誤り／欠落要素／動機付け欠如／阻害要因／後知恵 等）",
          },
          notes: {
            type: "string",
            description: "記載要件・適格性・MPF 等の評価や補足",
          },
        },
      },
    },
    overall: {
      type: "string",
      description: "総評（反論の足がかり・全体方針の手掛かり）",
    },
  },
};
