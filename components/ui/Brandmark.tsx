import { Bricolage_Grotesque, Space_Grotesk, Syne } from "next/font/google";

// ロゴ専用フォント（このコンポーネントにスコープ）。
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-bricolage",
  display: "swap",
});
const syne = Syne({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-syne",
  display: "swap",
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-space-grotesk",
  display: "swap",
});

type Size = "sm" | "md" | "lg";
type Layout = "row" | "stack";

type BrandmarkProps = {
  size?: Size;
  layout?: Layout;
  tagline?: string;
  className?: string;
};

// サイズごとの寸法（claude.ai/design: Brandmark.dc.html 由来）
const SIZES: Record<
  Size,
  {
    tile: number;
    rad: number;
    mono: number;
    name: number;
    tag: number;
    gap: number;
    sub: number;
    dot: number;
    dgap: number;
  }
> = {
  sm: { tile: 32, rad: 9, mono: 15, name: 15.5, tag: 7.5, gap: 11, sub: 4, dot: 4, dgap: 5 },
  md: { tile: 42, rad: 12, mono: 20, name: 20, tag: 9, gap: 13, sub: 5, dot: 5, dgap: 6 },
  lg: { tile: 54, rad: 16, mono: 26, name: 25, tag: 10.5, gap: 16, sub: 7, dot: 6, dgap: 7 },
};

/**
 * アプリのロゴ（タイル「oa」＋ワードマーク「Office Action App」＋タグライン）。
 * デザインの正は claude.ai/design の office-action-app-ui / Brandmark。
 */
export function Brandmark({
  size = "lg",
  layout = "row",
  tagline = "OA Response Assistant",
  className,
}: BrandmarkProps) {
  const s = SIZES[size];
  const stack = layout === "stack";
  const gap = stack ? Math.round(s.gap * 0.95) : s.gap;

  return (
    <div
      className={`${bricolage.variable} ${syne.variable} ${spaceGrotesk.variable} ${className ?? ""}`}
      style={{
        display: "flex",
        flexDirection: stack ? "column" : "row",
        alignItems: "center",
        gap: `${gap}px`,
        fontFamily: "var(--font-space-grotesk), -apple-system, sans-serif",
      }}
    >
      {/* タイル */}
      <div
        style={{
          width: `${s.tile}px`,
          height: `${s.tile}px`,
          borderRadius: `${s.rad}px`,
          background: "#1F1E1D",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-bricolage), sans-serif",
            fontWeight: 800,
            fontSize: `${s.mono}px`,
            letterSpacing: "-0.06em",
            color: "#F4F2EC",
            lineHeight: 1,
          }}
        >
          o<span style={{ color: "#E08A63" }}>a</span>
        </span>
      </div>

      {/* ワードマーク */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: stack ? "center" : "flex-start",
          gap: `${s.sub}px`,
          lineHeight: 1,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontWeight: 700,
            fontSize: `${s.name}px`,
            letterSpacing: "-0.025em",
            lineHeight: 1.12,
            color: "#1F1E1D",
            whiteSpace: "nowrap",
          }}
        >
          Office Action App
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: `${s.dgap}px` }}>
          <span
            style={{
              width: `${s.dot}px`,
              height: `${s.dot}px`,
              borderRadius: "50%",
              background: "#C4633F",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-space-grotesk), sans-serif",
              fontWeight: 600,
              fontSize: `${s.tag}px`,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#A09A90",
              whiteSpace: "nowrap",
            }}
          >
            {tagline}
          </span>
        </div>
      </div>
    </div>
  );
}
