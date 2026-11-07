import React, { useState, useEffect } from "react";
import type { AdbStatusPayload } from "../../types/electron";
import {
  UsbIcon,
  WifiIcon,
  ToggleRightIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  QrCodeIcon,
} from "../icons";
import { QRCodeCard } from "../QRCode";

export type ConnectionMode = "usb" | "wifi";
export type WizardStepId =
  | "usb"
  | "developer_options"
  | "usb_debugging"
  | "rsa_auth"
  | "wifi_network"
  | "wifi_developer"
  | "wifi_pair"
  | "ready";

interface WizardStep {
  id: WizardStepId;
  badge: string;
  title: string;
  instruction: string;
  detail: string;
  statusText: string;
}

interface SetupWizardProps {
  adbStatus?: AdbStatusPayload;
  notice?: string | null;
  onComplete?: () => void;
  onDismiss?: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  adbStatus,
  notice,
  onComplete,
  onDismiss,
}) => {
  const [mode, setMode] = useState<ConnectionMode>("usb");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [tapCounter, setTapCounter] = useState(0);

  // Manual Wi-Fi input states
  const [manualTarget, setManualTarget] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [wifiPairTab, setWifiPairTab] = useState<"qr" | "manual" | "switch">("qr");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null);

  // Automatically react to real hardware state changes from ADB
  useEffect(() => {
    if (!adbStatus) return;

    if (adbStatus.state === "unauthorized") {
      // Prompt is currently appearing on phone screen!
      if (mode === "usb") {
        setCurrentStepIndex(3); // Step 4: RSA Auth
      }
    } else if (adbStatus.state === "device") {
      // If a wireless device connected, switch to Wi-Fi mode
      if (adbStatus.activeDevice?.isWireless) {
        setMode("wifi");
        setCurrentStepIndex(3); // Ready
      } else {
        setCurrentStepIndex(mode === "usb" ? 4 : 3); // Ready
      }
    }
  }, [adbStatus?.state, adbStatus?.activeDevice?.isWireless]);

  const activeDevice = adbStatus?.activeDevice;
  const isDeviceOnline = adbStatus?.state === "device";

  // USB Mode Steps (Classic flow)
  const usbSteps: WizardStep[] = [
    {
      id: "usb",
      badge: "STEP 1",
      title: "Connect USB Cable",
      instruction: "Plug your Android phone into this computer using a USB data cable.",
      detail: "Make sure you use a data-transfer capable cable (not a charge-only cable).",
      statusText:
        adbStatus?.state === "no-device" ? "Listening for hardware connection..." : "USB link detected",
    },
    {
      id: "developer_options",
      badge: "STEP 2",
      title: "Enable Developer Options",
      instruction: "Open phone Settings > About Phone, then tap 'Build number' 7 times.",
      detail: "You will see a toast notification: 'You are now a developer!'.",
      statusText: "Waiting for developer mode...",
    },
    {
      id: "usb_debugging",
      badge: "STEP 3",
      title: "Turn on USB Debugging",
      instruction: "Navigate to Settings > System > Developer options and toggle 'USB debugging' to ON.",
      detail: "This permits the desktop mirror client to send ADB commands.",
      statusText: "Waiting for ADB interface...",
    },
    {
      id: "rsa_auth",
      badge: "STEP 4",
      title: "Authorize Computer RSA Key",
      instruction: "Check your phone screen for an 'Allow USB debugging?' dialog.",
      detail: "Check 'Always allow from this computer' and tap 'Allow'.",
      statusText:
        adbStatus?.state === "unauthorized"
          ? "RSA prompt active on phone: Tap 'Allow'"
          : "Awaiting user RSA prompt confirmation on device...",
    },
    {
      id: "ready",
      badge: "READY",
      title: activeDevice?.model ? `${activeDevice.model} Connected` : "Device Connected & Verified",
      instruction: "Your phone is connected, authorized, and ready for video streaming.",
      detail: activeDevice
        ? `Serial: ${activeDevice.serial} • Resolution: ${activeDevice.width ? `${activeDevice.width}×${activeDevice.height}` : "Auto"}`
        : "The mirror engine will capture the display at native resolution.",
      statusText: "Status: Device Authorized (Online)",
    },
  ];

  // Wi-Fi Mode Steps (Wireless flow)
  const wifiSteps: WizardStep[] = [
    {
      id: "wifi_network",
      badge: "STEP 1",
      title: "Connect to Same Wi-Fi",
      instruction: "Ensure your phone and this PC are connected to the exact same Wi-Fi network.",
      detail: "For optimal 60 FPS performance, connect both to a 5 GHz Wi-Fi band.",
      statusText: "Checking local network...",
    },
    {
      id: "wifi_developer",
      badge: "STEP 2",
      title: "Enable Wireless Debugging",
      instruction: "In phone Settings > Developer options, turn ON 'Wireless debugging'.",
      detail: "If asked, check 'Always allow on this network' and tap Allow.",
      statusText: "Ready for pairing...",
    },
    {
      id: "wifi_pair",
      badge: "STEP 3",
      title: "Pair & Connect Device",
      instruction: "Scan the QR code below or enter your phone's wireless pairing IP & Port.",
      detail: "You can also plug USB once and click 'Switch to Wi-Fi' to auto-pair.",
      statusText: isDeviceOnline ? "Connected wirelessly!" : "Awaiting wireless pairing...",
    },
    {
      id: "ready",
      badge: "READY",
      title: activeDevice?.model ? `${activeDevice.model} (Wi-Fi)` : "Wireless Device Connected",
      instruction: "Your phone is connected over Wi-Fi and ready for untethered mirroring.",
      detail: activeDevice
        ? `Host: ${activeDevice.serial} • Resolution: ${activeDevice.width ? `${activeDevice.width}×${activeDevice.height}` : "Auto"}`
        : "Untethered low-latency stream ready.",
      statusText: "Status: Wireless Link Online",
    },
  ];

  const steps = mode === "usb" ? usbSteps : wifiSteps;
  const currentStep = steps[Math.min(currentStepIndex, steps.length - 1)];

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      onComplete?.();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleTapBuildNumber = () => {
    const next = tapCounter + 1;
    setTapCounter(next);
    if (next >= 7) {
      setTimeout(() => {
        handleNext();
      }, 300);
    }
  };

  const handleManualConnect = async () => {
    if (!manualTarget.trim() || !window.electronAPI) return;
    setIsConnecting(true);
    setConnectionFeedback(null);
    try {
      if (pairingCode.trim()) {
        const pairRes = await window.electronAPI.pairWireless(manualTarget, pairingCode);
        if (!pairRes.success) {
          setConnectionFeedback(`Pairing: ${pairRes.message}`);
          setIsConnecting(false);
          return;
        }
      }
      const connRes = await window.electronAPI.connectWireless(manualTarget);
      setConnectionFeedback(connRes.message);
      if (connRes.success) {
        setCurrentStepIndex(steps.length - 1);
      }
    } catch (e: any) {
      setConnectionFeedback(e?.message || "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSwitchFromUsb = async () => {
    if (!activeDevice || !window.electronAPI) return;
    setIsConnecting(true);
    setConnectionFeedback(null);
    try {
      const res = await window.electronAPI.enableWireless(activeDevice.serial);
      if (res.success && res.ip) {
        setConnectionFeedback(`Connected to ${res.ip}:5555! You can now unplug the USB cable.`);
        setCurrentStepIndex(steps.length - 1);
      } else {
        setConnectionFeedback(res.error || "Failed to switch to Wi-Fi mode");
      }
    } catch (e: any) {
      setConnectionFeedback(e?.message || "Error switching to Wi-Fi");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div
      className="setup-wizard"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        backgroundColor: "#050B0E",
        color: "var(--mist-200)",
        padding: "var(--space-4)",
        boxSizing: "border-box",
        position: "relative",
        userSelect: "none",
        overflowY: "auto",
      }}
    >
      {/* Mode Selector Segmented Bar */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          backgroundColor: "var(--ink-950)",
          padding: "3px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          marginBottom: "var(--space-3)",
        }}
      >
        <button
          onClick={() => {
            setMode("usb");
            setCurrentStepIndex(0);
          }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "5px 8px",
            borderRadius: "4px",
            backgroundColor: mode === "usb" ? "var(--ink-800)" : "transparent",
            color: mode === "usb" ? "var(--mist-100)" : "var(--text-muted)",
            border: mode === "usb" ? "1px solid var(--border)" : "1px solid transparent",
            fontSize: "11px",
            fontWeight: mode === "usb" ? 600 : 500,
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
        >
          <UsbIcon size={13} />
          <span>USB Cable</span>
        </button>
        <button
          onClick={() => {
            setMode("wifi");
            setCurrentStepIndex(0);
          }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "5px 8px",
            borderRadius: "4px",
            backgroundColor: mode === "wifi" ? "var(--ink-800)" : "transparent",
            color: mode === "wifi" ? "var(--accent)" : "var(--text-muted)",
            border: mode === "wifi" ? "1px solid rgba(138, 230, 196, 0.3)" : "1px solid transparent",
            fontSize: "11px",
            fontWeight: mode === "wifi" ? 600 : 500,
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
        >
          <WifiIcon size={13} />
          <span>Wi-Fi Wireless</span>
        </button>
      </div>

      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            className="mono-data"
            style={{
              fontSize: "10px",
              padding: "2px 6px",
              backgroundColor: "var(--ink-800)",
              borderRadius: "var(--radius-sm)",
              color: mode === "wifi" ? "var(--accent)" : "var(--mist-400)",
            }}
          >
            {currentStep.badge}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Step {currentStepIndex + 1} of {steps.length}
          </span>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              fontSize: "11px",
              color: "var(--mist-400)",
              padding: "2px 6px",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Skip
          </button>
        )}
      </div>

      {/* Progress Dots Bar */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: "var(--space-3)",
        }}
      >
        {steps.map((s, idx) => {
          const isActive = idx === currentStepIndex;
          const isDone = idx < currentStepIndex;
          return (
            <button
              key={s.id}
              onClick={() => setCurrentStepIndex(idx)}
              style={{
                flex: 1,
                height: "3px",
                borderRadius: "2px",
                backgroundColor: isActive
                  ? mode === "wifi"
                    ? "var(--accent)"
                    : "var(--mist-200)"
                  : isDone
                  ? "var(--ink-600)"
                  : "var(--ink-800)",
                padding: 0,
                border: "none",
                cursor: "pointer",
                transition: "background-color 140ms ease",
              }}
              title={s.title}
            />
          );
        })}
      </div>

      {/* Visual Step Illustration / Graphic */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "var(--space-2) 0",
        }}
      >
        {/* Step-specific illustrations */}
        {currentStep.id === "wifi_pair" ? (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* Sub-tab selection: QR Code vs Manual IP vs USB Switch */}
            <div
              style={{
                display: "flex",
                gap: "4px",
                backgroundColor: "var(--ink-950)",
                padding: "2px",
                borderRadius: "4px",
                marginBottom: "4px",
              }}
            >
              <button
                onClick={() => setWifiPairTab("qr")}
                style={{
                  flex: 1,
                  padding: "4px",
                  borderRadius: "3px",
                  backgroundColor: wifiPairTab === "qr" ? "var(--ink-800)" : "transparent",
                  color: wifiPairTab === "qr" ? "var(--accent)" : "var(--text-muted)",
                  fontSize: "10px",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Scan QR Code
              </button>
              <button
                onClick={() => setWifiPairTab("manual")}
                style={{
                  flex: 1,
                  padding: "4px",
                  borderRadius: "3px",
                  backgroundColor: wifiPairTab === "manual" ? "var(--ink-800)" : "transparent",
                  color: wifiPairTab === "manual" ? "var(--accent)" : "var(--text-muted)",
                  fontSize: "10px",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Manual IP / Port
              </button>
              {activeDevice && !activeDevice.isWireless && (
                <button
                  onClick={() => setWifiPairTab("switch")}
                  style={{
                    flex: 1,
                    padding: "4px",
                    borderRadius: "3px",
                    backgroundColor: wifiPairTab === "switch" ? "var(--ink-800)" : "transparent",
                    color: wifiPairTab === "switch" ? "var(--accent)" : "var(--text-muted)",
                    fontSize: "10px",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  1-Click Switch
                </button>
              )}
            </div>

            {wifiPairTab === "qr" && <QRCodeCard />}

            {wifiPairTab === "manual" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "12px",
                  backgroundColor: "rgba(16, 27, 36, 0.75)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  maxWidth: "280px",
                  margin: "0 auto",
                  width: "100%",
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <label style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    Phone IP:Port
                  </label>
                  <input
                    type="text"
                    placeholder="192.168.1.50:5555"
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    className="mono-data"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "4px",
                      backgroundColor: "var(--ink-950)",
                      border: "1px solid var(--border)",
                      color: "var(--mist-100)",
                      fontSize: "11px",
                      marginTop: "2px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ textAlign: "left" }}>
                  <label style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    Pairing Code (Optional for Android 11+)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 481920"
                    value={pairingCode}
                    onChange={(e) => setPairingCode(e.target.value)}
                    className="mono-data"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "4px",
                      backgroundColor: "var(--ink-950)",
                      border: "1px solid var(--border)",
                      color: "var(--mist-100)",
                      fontSize: "11px",
                      marginTop: "2px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <button
                  onClick={handleManualConnect}
                  disabled={isConnecting || !manualTarget.trim()}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "4px",
                    backgroundColor: "var(--accent)",
                    color: "#06141B",
                    fontWeight: 700,
                    fontSize: "11px",
                    border: "none",
                    cursor: isConnecting || !manualTarget.trim() ? "not-allowed" : "pointer",
                    opacity: isConnecting || !manualTarget.trim() ? 0.6 : 1,
                  }}
                >
                  {isConnecting ? "Connecting…" : "Connect Wi-Fi"}
                </button>
              </div>
            )}

            {wifiPairTab === "switch" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  padding: "16px",
                  backgroundColor: "rgba(16, 27, 36, 0.75)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  maxWidth: "280px",
                  margin: "0 auto",
                  width: "100%",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--mist-200)" }}>
                  Phone is currently connected via USB:
                </div>
                <div className="mono-data" style={{ fontSize: "12px", color: "var(--accent)" }}>
                  {activeDevice?.model ?? activeDevice?.serial}
                </div>
                <button
                  onClick={handleSwitchFromUsb}
                  disabled={isConnecting}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--accent)",
                    color: "#06141B",
                    fontWeight: 700,
                    fontSize: "11px",
                    border: "none",
                    cursor: isConnecting ? "not-allowed" : "pointer",
                  }}
                >
                  {isConnecting ? "Enabling Wi-Fi…" : "1-Click Switch to Wi-Fi"}
                </button>
                <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  Once connected, you can unplug the cable and mirror wirelessly.
                </div>
              </div>
            )}

            {connectionFeedback && (
              <div
                style={{
                  fontSize: "10.5px",
                  color: connectionFeedback.toLowerCase().includes("connected")
                    ? "var(--success)"
                    : "var(--warning)",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(0,0,0,0.4)",
                  marginTop: "4px",
                }}
              >
                {connectionFeedback}
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                backgroundColor: "var(--ink-900)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color:
                  isDeviceOnline && currentStep.id === "ready"
                    ? "var(--success)"
                    : mode === "wifi"
                    ? "var(--accent)"
                    : "var(--mist-200)",
                marginBottom: "var(--space-3)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
              }}
            >
              {currentStep.id === "usb" && <UsbIcon size={30} />}
              {currentStep.id === "wifi_network" && <WifiIcon size={30} />}
              {currentStep.id === "developer_options" && <SmartphoneIcon size={30} />}
              {currentStep.id === "wifi_developer" && <ToggleRightIcon size={30} />}
              {currentStep.id === "usb_debugging" && <ToggleRightIcon size={30} />}
              {currentStep.id === "rsa_auth" && (
                <ShieldCheckIcon
                  size={30}
                  style={{
                    color: adbStatus?.state === "unauthorized" ? "var(--warning)" : "inherit",
                  }}
                />
              )}
              {currentStep.id === "ready" && (
                <CheckIcon size={30} style={{ color: "var(--success)" }} />
              )}
            </div>

            {/* Interactive Mock Components for instructions */}
            {currentStep.id === "developer_options" && (
              <div
                style={{
                  backgroundColor: "var(--ink-950)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 14px",
                  marginBottom: "var(--space-3)",
                  cursor: "pointer",
                }}
                onClick={handleTapBuildNumber}
              >
                <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>About Phone</div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--mist-200)",
                    marginTop: "2px",
                  }}
                >
                  Build number: TP1A.220624.014
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: tapCounter > 0 ? "var(--warning)" : "var(--text-muted)",
                    marginTop: "4px",
                  }}
                >
                  {tapCounter >= 7
                    ? "You are now a developer!"
                    : tapCounter > 0
                    ? `Tap ${7 - tapCounter} more times`
                    : "Click/tap here 7 times to test"}
                </div>
              </div>
            )}

            {currentStep.id === "wifi_network" && (
              <div
                style={{
                  backgroundColor: "var(--ink-950)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 14px",
                  marginBottom: "var(--space-3)",
                  fontSize: "11px",
                  lineHeight: "1.4",
                  maxWidth: "280px",
                }}
              >
                <div style={{ color: "var(--accent)", fontWeight: 600, marginBottom: "4px" }}>
                  Same Wi-Fi Router
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "10.5px" }}>
                  Both this computer and your Android phone must be on the same local Wi-Fi
                  network so ADB can talk directly to the phone.
                </div>
              </div>
            )}
          </>
        )}

        {/* Step Title & Instruction */}
        <h3
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 700,
            color: "var(--mist-100)",
            marginBottom: "4px",
          }}
        >
          {currentStep.title}
        </h3>
        <p
          style={{
            fontSize: "11.5px",
            color: "var(--mist-300)",
            lineHeight: 1.4,
            maxWidth: "290px",
            marginBottom: "4px",
          }}
        >
          {currentStep.instruction}
        </p>
        <p
          style={{
            fontSize: "10.5px",
            color: "var(--text-muted)",
            maxWidth: "280px",
            lineHeight: 1.35,
          }}
        >
          {currentStep.detail}
        </p>
      </div>

      {/* Hardware Status Indicator Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 10px",
          backgroundColor: "var(--ink-950)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          marginBottom: "var(--space-3)",
        }}
      >
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: isDeviceOnline
              ? "var(--success)"
              : adbStatus?.state === "unauthorized"
              ? "var(--warning)"
              : "var(--ink-600)",
            flexShrink: 0,
          }}
        />
        <span
          className="mono-data"
          style={{
            fontSize: "10.5px",
            color: isDeviceOnline
              ? "var(--success)"
              : adbStatus?.state === "unauthorized"
              ? "var(--warning)"
              : "var(--mist-400)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {currentStep.statusText}
        </span>
      </div>

      {/* Navigation Buttons */}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button
          onClick={handlePrev}
          disabled={currentStepIndex === 0}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            color: currentStepIndex === 0 ? "var(--ink-600)" : "var(--mist-400)",
            cursor: currentStepIndex === 0 ? "not-allowed" : "pointer",
            fontSize: "11px",
          }}
        >
          <ChevronLeftIcon size={14} />
          Back
        </button>

        <button
          onClick={handleNext}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            padding: "8px 14px",
            borderRadius: "var(--radius-sm)",
            backgroundColor:
              isDeviceOnline && currentStep.id === "ready"
                ? "var(--success)"
                : mode === "wifi"
                ? "var(--accent)"
                : "var(--ink-800)",
            border: "1px solid var(--border)",
            color:
              isDeviceOnline && currentStep.id === "ready"
                ? "#06141B"
                : mode === "wifi"
                ? "#06141B"
                : "var(--mist-200)",
            fontWeight: 700,
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          <span>{currentStep.id === "ready" ? "Start Stream" : "Next Step"}</span>
          <ChevronRightIcon size={14} />
        </button>
      </div>

      {/* In-screen heads-up notice: drops from the top like a real phone banner */}
      {notice && (
        <div
          className="phone-notice"
          style={{
            position: "absolute",
            top: "var(--space-2)",
            left: "var(--space-3)",
            right: "var(--space-3)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            backgroundColor: "rgba(17, 33, 45, 0.96)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 28px -8px rgba(0, 0, 0, 0.7)",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              backgroundColor: "rgba(224, 176, 74, 0.14)",
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {mode === "wifi" ? <WifiIcon size={14} /> : <UsbIcon size={14} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--mist-200)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {notice.split(". ")[0]}
              </span>
              <span
                className="mono-data"
                style={{
                  marginLeft: "auto",
                  fontSize: "9px",
                  color: "var(--mist-400)",
                  opacity: 0.6,
                  flexShrink: 0,
                }}
              >
                now
              </span>
            </div>
            {notice.includes(". ") && (
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--mist-400)",
                  lineHeight: 1.35,
                  marginTop: "1px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {notice.slice(notice.indexOf(". ") + 2)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
