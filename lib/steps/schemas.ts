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

/**
 * VALIDITY_SCHEMA に対応する TypeScript 型。
 * runValidity の戻り値（パース後）と ValidityChart の props で共有する（client/server 両用）。
 * 構造は VALIDITY_SCHEMA と一致させること（スキーマ変更時は両方更新）。
 */

/** 5 段階スコア。5=審査官主張が妥当（開示あり・反論困難）, 1=妥当でない（反論余地大）。 */
export type ValidityScore = 1 | 2 | 3 | 4 | 5;

/** 構成要件 × 1 引用文献の評価。 */
export type ValidityAssessment = {
  /** 引用文献の名称／番号。 */
  reference: string;
  score: ValidityScore;
  /** 根拠（引用文献の実開示と審査官主張の対比。過大解釈・欠落要素の指摘を含む）。 */
  rationale: string;
};

/** 請求項を分解した構成要件（文節）。 */
export type ValidityElement = {
  /** 構成要件（文節）の記載。 */
  text: string;
  /** 各引用文献に対する 5 段階評価。 */
  assessments: ValidityAssessment[];
};

/** 請求項単位の構成要件分解＋引用文献照合。 */
export type ValidityClaim = {
  /** 請求項番号（例: "1", "2"）。 */
  claim_no: string;
  elements: ValidityElement[];
};

/** 拒絶理由ごとの妥当性と審査官の強い点／弱い点。 */
export type ValidityRejection = {
  /** 拒絶理由の種類（新規性／進歩性／記載要件／特許適格性／MPF 等）。 */
  type: string;
  target_claims: string[];
  examiner_strong_points: string[];
  /** 弱点（過大解釈／クレーム解釈の誤り／欠落要素／動機付け欠如／阻害要因／後知恵 等）。 */
  examiner_weak_points: string[];
  notes: string;
};

/** Step4-S5 妥当性評価の構造化結果（VALIDITY_SCHEMA のルート）。 */
export type ValidityResult = {
  claims: ValidityClaim[];
  rejections: ValidityRejection[];
  overall: string;
};

/**
 * S6 応答方針（PRD §11-S6・最重要）。
 * 拒絶理由を覆せる範囲で「最も広いクレーム」を狙う。広狭の幅を持つ 3 案以上を、各案の根拠
 * （Step4 で挙げた審査官の弱点をどう突くか）／権利範囲／リスク／補正の方向性とともに提示する。
 * ※ 3 案以上・広狭の幅は strict schema では minItems で強制できないため description とプロンプトで担保する。
 */
export const STRATEGY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["strategies", "recommendation", "overall"],
  properties: {
    strategies: {
      type: "array",
      description:
        "応答方針の案。広狭の幅を持たせ 3 案以上。最も広い権利範囲を狙う案（breadth=broad）を必ず含める。",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "breadth",
          "approach",
          "rationale",
          "claim_scope",
          "risks",
          "amendment_outline",
        ],
        properties: {
          label: { type: "string", description: "案の識別名（例: 案A）" },
          breadth: {
            type: "string",
            enum: ["broad", "medium", "narrow"],
            description:
              "狙う権利範囲の広さ。broad=最も広い, medium=中間, narrow=最も狭く確実",
          },
          approach: {
            type: "string",
            description:
              "方針の概要（意見書のみで反論／補正で対応／両者の組合せ。何をどう主張するか）",
          },
          rationale: {
            type: "string",
            description:
              "拒絶理由を覆せる根拠。Step4 の妥当性評価で挙げた審査官の弱点・誤り（過大解釈／クレーム解釈の誤り／欠落要素／動機付け欠如／阻害要因／後知恵）のどれをどう突くかを具体的に。",
          },
          claim_scope: {
            type: "string",
            description:
              "この案で得られる権利範囲（どこまで広く取れるか・どの限定が入るか）",
          },
          risks: {
            type: "array",
            items: { type: "string" },
            description:
              "リスク（許可されない可能性／新規事項の懸念／過剰な限定 等）",
          },
          amendment_outline: {
            type: "string",
            description:
              "必要な補正の方向性の概要（具体的な補正文は Step8 で作成）。補正不要なら『補正なし（意見書のみ）』と記す。",
          },
        },
      },
    },
    recommendation: {
      type: "object",
      additionalProperties: false,
      required: ["recommended_label", "reason"],
      properties: {
        recommended_label: {
          type: "string",
          description: "推奨する案の label",
        },
        reason: {
          type: "string",
          description: "推奨理由（許可可能性と権利範囲の広さのバランス）",
        },
      },
    },
    overall: {
      type: "string",
      description: "総評と次ステップ（補正方針）への橋渡し",
    },
  },
};

/**
 * STRATEGY_SCHEMA に対応する TypeScript 型。
 * runStrategy の戻り値（パース後）と StrategyView の props で共有する（client/server 両用）。
 * 構造は STRATEGY_SCHEMA と一致させること（スキーマ変更時は両方更新）。
 */

/** 狙う権利範囲の広さ。broad=最も広い, medium=中間, narrow=最も狭く確実。 */
export type StrategyBreadth = "broad" | "medium" | "narrow";

/** 応答方針の 1 案。 */
export type StrategyOption = {
  /** 案の識別名（例: "案A"）。 */
  label: string;
  breadth: StrategyBreadth;
  /** 方針の概要（意見書のみ／補正／組合せ）。 */
  approach: string;
  /** 拒絶理由を覆せる根拠（審査官の弱点をどう突くか）。 */
  rationale: string;
  /** 得られる権利範囲。 */
  claim_scope: string;
  /** リスク。 */
  risks: string[];
  /** 必要な補正の方向性の概要（具体は Step8）。 */
  amendment_outline: string;
};

/** 推奨案とその理由。 */
export type StrategyRecommendation = {
  /** 推奨する案の label。 */
  recommended_label: string;
  reason: string;
};

/** S6 応答方針の構造化結果（STRATEGY_SCHEMA のルート）。 */
export type StrategyResult = {
  strategies: StrategyOption[];
  recommendation: StrategyRecommendation;
  overall: string;
};

/**
 * 補正後クレームを文節（segment）の列で表す 1 要素（PRD §9.4 の補正箇所ハイライトの素）。
 * change で keep（据置）/ add（追記）/ delete（削除）を区別する。S8 代表補正・S10 全文補正で共有。
 */
const AMENDMENT_SEGMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["text", "change"],
  properties: {
    text: { type: "string", description: "文節（クレームの一部の記載）" },
    change: {
      type: "string",
      enum: ["keep", "add", "delete"],
      description:
        "keep=現クレームから据置, add=補正で追記, delete=補正で削除。追記・削除は独立した segment に分ける。",
    },
  },
};

/**
 * S8 代表クレーム補正（PRD §11-S8・重要）。
 * 拒絶理由解消に必要最小限の補正のみ。代表請求項を対象に、補正後クレームを segment 列で表し
 * 追記/削除をハイライト可能にする。可能なら広狭の異なる最小限の 3 案を比較する。
 * ※ 3 案・広狭の幅は strict schema では minItems で強制できないため description とプロンプトで担保する。
 */
export const REP_AMENDMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["country", "representative_claim_no", "options", "recommendation", "overall"],
  properties: {
    country: {
      type: "string",
      description: "対象国（JP/US/EP/WO/CN）。補正運用ルールの基準。",
    },
    representative_claim_no: {
      type: "string",
      description: "代表として補正する請求項番号（通常は独立請求項）",
    },
    options: {
      type: "array",
      description:
        "最小限度の異なる補正案。可能なら広狭の幅を持たせた 3 案。各案は必要最小限の補正に徹する。",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "breadth",
          "segments",
          "basis",
          "addressed_rejections",
          "claim_scope",
          "rationale",
          "risks",
        ],
        properties: {
          label: { type: "string", description: "案の識別名（例: 案A）" },
          breadth: {
            type: "string",
            enum: ["broad", "medium", "narrow"],
            description:
              "得られる権利範囲の広さ。broad=最も広い, medium=中間, narrow=最も狭く確実",
          },
          segments: {
            type: "array",
            description: "補正後の代表請求項（文節列。change で補正箇所を区別）",
            items: AMENDMENT_SEGMENT_SCHEMA,
          },
          basis: {
            type: "string",
            description: "新規事項でない根拠（本願明細書の対応箇所・段落番号等）",
          },
          addressed_rejections: {
            type: "array",
            items: { type: "string" },
            description: "この案が解消する拒絶理由",
          },
          claim_scope: {
            type: "string",
            description: "この案で得られる権利範囲（どこまで広く取れるか・どの限定が入るか）",
          },
          rationale: {
            type: "string",
            description:
              "なぜこの補正で拒絶理由を覆せるか（Step4/Step6 で押さえた審査官の弱点との対応）",
          },
          risks: {
            type: "array",
            items: { type: "string" },
            description: "リスク（過剰な限定／新規事項の懸念／許可されない可能性 等）",
          },
        },
      },
    },
    recommendation: {
      type: "object",
      additionalProperties: false,
      required: ["recommended_label", "reason"],
      properties: {
        recommended_label: {
          type: "string",
          description: "推奨する案の label",
        },
        reason: {
          type: "string",
          description: "推奨理由（解消の確実性と権利範囲の広さのバランス）",
        },
      },
    },
    overall: {
      type: "string",
      description: "総評と次ステップ（全文補正）への橋渡し",
    },
  },
};

/**
 * REP_AMENDMENT_SCHEMA / FULL_AMENDMENT_SCHEMA に対応する TypeScript 型。
 * run* の戻り値（パース後）と各 View の props で共有する（client/server 両用）。
 * 構造はスキーマと一致させること（スキーマ変更時は両方更新）。
 */

/** 補正の種別。keep=据置, add=追記, delete=削除。 */
export type AmendmentChange = "keep" | "add" | "delete";

/** 補正後クレームの 1 文節（change で補正箇所を区別＝ハイライトの素）。 */
export type AmendmentSegment = {
  /** 文節（クレームの一部の記載）。 */
  text: string;
  change: AmendmentChange;
};

/** 代表補正の 1 案（広狭の幅を持つ。必要最小限の補正）。 */
export type AmendmentOption = {
  /** 案の識別名（例: "案A"）。 */
  label: string;
  breadth: StrategyBreadth;
  /** 補正後の代表請求項（文節列）。 */
  segments: AmendmentSegment[];
  /** 新規事項でない根拠（明細書の対応箇所）。 */
  basis: string;
  /** この案が解消する拒絶理由。 */
  addressed_rejections: string[];
  /** 得られる権利範囲。 */
  claim_scope: string;
  /** 拒絶理由を覆せる根拠（審査官の弱点との対応）。 */
  rationale: string;
  /** リスク。 */
  risks: string[];
};

/** S8 代表クレーム補正の構造化結果（REP_AMENDMENT_SCHEMA のルート）。 */
export type RepAmendmentResult = {
  /** 対象国（JP/US/EP/WO/CN）。 */
  country: string;
  /** 代表として補正する請求項番号。 */
  representative_claim_no: string;
  options: AmendmentOption[];
  recommendation: StrategyRecommendation;
  overall: string;
};

/**
 * S10 全文クレーム補正（PRD §11-S10）。
 * 代表補正案に基づき全クレームを補正する。S8 の原則（必要最小限）を全クレームに適用し、各クレームを
 * segment 列でハイライト可能にする。補正後の全請求項を漏れなく含める。
 */
export const FULL_AMENDMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["country", "claims", "summary_of_changes", "addressed_rejections", "overall"],
  properties: {
    country: {
      type: "string",
      description: "対象国（JP/US/EP/WO/CN）。補正運用ルールの基準。",
    },
    claims: {
      type: "array",
      description: "補正後の全クレーム（補正の有無に関わらず全請求項を含める）",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim_no", "claim_type", "depends_on", "segments", "basis"],
        properties: {
          claim_no: { type: "string", description: "請求項番号" },
          claim_type: {
            type: "string",
            enum: ["independent", "dependent"],
            description: "independent=独立項, dependent=従属項",
          },
          depends_on: {
            type: "string",
            description: "従属項の従属先（例: 請求項1）。独立項は空文字。",
          },
          segments: {
            type: "array",
            description: "補正後クレーム（文節列。change で補正箇所を区別）",
            items: AMENDMENT_SEGMENT_SCHEMA,
          },
          basis: {
            type: "string",
            description:
              "補正が新規事項でない根拠（明細書の対応箇所）。補正なしの場合は据置である旨。",
          },
        },
      },
    },
    summary_of_changes: {
      type: "string",
      description: "補正の要点（どのクレームをどう補正したかの概要）",
    },
    addressed_rejections: {
      type: "array",
      items: { type: "string" },
      description: "この全文補正で解消する拒絶理由",
    },
    overall: {
      type: "string",
      description: "総評と次ステップ（意見書）への橋渡し",
    },
  },
};

/** 補正後の 1 クレーム（独立項／従属項。segment 列でハイライト）。 */
export type AmendedClaim = {
  /** 請求項番号。 */
  claim_no: string;
  /** 独立項か従属項か。 */
  claim_type: "independent" | "dependent";
  /** 従属項の従属先（独立項は空文字）。 */
  depends_on: string;
  /** 補正後クレーム（文節列）。 */
  segments: AmendmentSegment[];
  /** 新規事項でない根拠（明細書の対応箇所）。 */
  basis: string;
};

/** S10 全文クレーム補正の構造化結果（FULL_AMENDMENT_SCHEMA のルート）。 */
export type FullAmendmentResult = {
  /** 対象国（JP/US/EP/WO/CN）。 */
  country: string;
  claims: AmendedClaim[];
  /** 補正の要点。 */
  summary_of_changes: string;
  /** 解消する拒絶理由。 */
  addressed_rejections: string[];
  overall: string;
};
