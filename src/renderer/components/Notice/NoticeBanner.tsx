import React from "react";
import { CheckIcon, CloseIcon, ShieldCheckIcon, WifiIcon } from "../icons";

export type NoticeTone = "success" | "warning" | "error" | "info";

interface NoticeBannerProps {
  message: string;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const TONE_STYLES: Record<
  NoticeTone,
  { accent: string; border: string; tint: string }
> = {
  success: {
    accent: "var(--success)",
    border: "rgba(95, 191, 154, 0.42)",
    tint: "rgba(95, 191, 154, 0.16)",
  },
  warning: {
    accent: "var(--warning)",
    border: "rgba(224, 176, 74, 0.42)",
    tint: "rgba(224, 176, 74, 0.16)",
  },
  error: {
    accent: "var(--danger)",
    border: "rgba(224, 122, 122, 0.42)",
    tint: "rgba(224, 122, 122, 0.16)",
  },
  info: {
    accent: "var(--mist-200)",
    border: "rgba(204, 208, 207, 0.2)",
    tint: "rgba(204, 208, 207, 0.12)",
  },
};

/**
 * One notification vocabulary for the whole app: the same card, icon badge,
 * tone colors and wrapping wherever a status message surfaces, so a message
 * reads the same in the setup guide and over the live stream.
 */
export function resolveNoticeTone(message: string): NoticeTone {
  const text = message.toLowerCase();
  if (message.trimStart().startsWith("✓")) return "success";
  if (
    text.includes("fail") ||
    text.includes("error") ||
    text.includes("lost") ||
    text.includes("✕")
  ) {
    return "error";
  }
  if (
    text.includes("disconnect") ||
    text.includes("not found") ||
    text.includes("no device") ||
    text.includes("unauthorized") ||
    text.includes("in use") ||
    text.includes("busy")
  ) {
    return "warning";
  }
  if (
    text.includes("connected") ||
    text.includes("online") ||
    text.includes("switched") ||
    text.includes("detected") ||
    text.includes("ready")
  ) {
    return "success";
  }
  return "info";
}

export const NoticeBanner: React.FC<NoticeBannerProps> = ({
  message,
  icon,
  className,
  style,
}) => {
  const tone = resolveNoticeTone(message);
  const colors = TONE_STYLES[tone];

  // Strip the status glyphs used as prefixes, then split the first sentence
  // into the title and keep the rest as the body.
  const clean = message.replace(/^[✓✕]\s*/, "").trim();
  const splitAt = clean.indexOf(". ");
  const title = splitAt >= 0 ? clean.slice(0, splitAt) : clean;
  const body = splitAt >= 0 ? clean.slice(splitAt + 2) : "";

  const glyph =
    icon ??
    (tone === "success" ? (
      <CheckIcon size={14} />
    ) : tone === "error" ? (
      <CloseIcon size={13} />
    ) : tone === "warning" ? (
      <ShieldCheckIcon size={14} />
    ) : (
      <WifiIcon size={14} />
    ));

  return (
    <div
      className={className ? `phone-notice ${className}` : "phone-notice"}
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: "var(--space-2)",
        left: "var(--space-3)",
        right: "var(--space-3)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "9px 11px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${colors.border}`,
        backgroundColor: "rgba(17, 33, 45, 0.97)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 10px 28px -8px rgba(0, 0, 0, 0.7)",
        pointerEvents: "none",
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "26px",
          height: "26px",
          borderRadius: "15px",
          backgroundColor: colors.tint,
          color: colors.accent,
          border: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {glyph}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              lineHeight: 1.35,
              color: colors.accent,
              overflowWrap: "anywhere",
            }}
          >
            {title}
          </span>
          <span
            className="mono-data"
            style={{
              marginLeft: "auto",
              fontSize: "9px",
              color: "var(--mist-400)",
              flexShrink: 0,
            }}
          >
            now
          </span>
        </div>
        {body && (
          <div
            style={{
              fontSize: "10px",
              lineHeight: 1.45,
              color: "var(--mist-300)",
              marginTop: "2px",
              overflowWrap: "anywhere",
            }}
          >
            {body}
          </div>
        )}
      </div>
    </div>
  );
};
