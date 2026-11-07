import React, { useState, useEffect, useMemo } from "react";
import QRCode from "qrcode";
import { QrCodeIcon, CopyIcon, CheckIcon, RefreshCwIcon } from "../icons";

interface QRCodeCardProps {
  onPairRequested?: (ipPort: string, code: string) => void;
}

export const QRCodeCard: React.FC<QRCodeCardProps> = () => {
  const [pairingCode, setPairingCode] = useState(() =>
    String(Math.floor(100000 + Math.random() * 900000))
  );
  const [serviceName] = useState(() => `PhoneFrame_${Math.random().toString(36).substring(2, 6).toUpperCase()}`);
  const [svgMarkup, setSvgMarkup] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Android 11+ Wireless Debugging QR code specification:
  // Schema: WIFI:T:ADB;S:<service_name>;P:<pairing_code>;;
  const qrPayload = useMemo(() => {
    return `WIFI:T:ADB;S:${serviceName};P:${pairingCode};;`;
  }, [serviceName, pairingCode]);

  useEffect(() => {
    let active = true;
    QRCode.toString(
      qrPayload,
      {
        type: "svg",
        margin: 1,
        color: {
          dark: "#06141B",
          light: "#CCD0CF",
        },
      },
      (err, svg) => {
        if (!err && svg && active) {
          setSvgMarkup(svg);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [qrPayload]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Failed to copy pairing code", e);
    }
  };

  const handleRefresh = () => {
    setPairingCode(String(Math.floor(100000 + Math.random() * 900000)));
    setCopied(false);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        padding: "12px",
        backgroundColor: "rgba(16, 27, 36, 0.75)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        width: "100%",
        maxWidth: "280px",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <QrCodeIcon size={14} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "var(--mist-100)",
              textTransform: "uppercase",
            }}
          >
            Pairing QR Code
          </span>
        </div>
        <button
          onClick={handleRefresh}
          title="Generate new pairing code"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: "10px",
            cursor: "pointer",
          }}
        >
          <RefreshCwIcon size={10} />
          <span>New</span>
        </button>
      </div>

      {/* SVG QR Code Display */}
      <div
        style={{
          width: "148px",
          height: "148px",
          padding: "6px",
          backgroundColor: "#CCD0CF",
          borderRadius: "8px",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>
          Pairing Code (if prompted)
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
          <span
            className="mono-data"
            style={{
              fontSize: "16px",
              fontWeight: 800,
              letterSpacing: "0.18em",
              color: "var(--accent)",
              backgroundColor: "rgba(0, 0, 0, 0.4)",
              padding: "2px 8px",
              borderRadius: "4px",
              border: "1px solid rgba(138, 230, 196, 0.2)",
            }}
          >
            {pairingCode}
          </span>
          <button
            onClick={handleCopyCode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              borderRadius: "4px",
              backgroundColor: copied ? "var(--success)" : "var(--ink-800)",
              border: "1px solid var(--border)",
              color: copied ? "#06141B" : "var(--mist-200)",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
        </div>
      </div>

      <div
        style={{
          fontSize: "9.5px",
          color: "var(--text-muted)",
          textAlign: "center",
          lineHeight: "1.35",
          marginTop: "2px",
        }}
      >
        On phone: <strong style={{ color: "var(--mist-200)" }}>Developer options</strong> →{" "}
        <strong style={{ color: "var(--mist-200)" }}>Wireless debugging</strong> →{" "}
        <em>Pair device with QR code</em>
      </div>
    </div>
  );
};

