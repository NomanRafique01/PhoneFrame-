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
  RefreshCwIcon,
  SearchIcon,
} from "../icons";

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
  const [mode, setMode] = useState<ConnectionMode | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [tapCounter, setTapCounter] = useState(0);

  // Wireless Wi-Fi switch states
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasSwitched, setHasSwitched] = useState(false);
  const [switchResult, setSwitchResult] = useState<{ ip?: string; serial?: string } | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null);

  // Track previous ADB state so we only auto-advance when hardware state transitions,
  // allowing the user to freely click Back to previous steps without being trapped on Step 5.
  const prevAdbStateRef = React.useRef(adbStatus?.state);

  useEffect(() => {
    if (!adbStatus || mode === null) return;
    const prevState = prevAdbStateRef.current;
    prevAdbStateRef.current = adbStatus.state;

    // Only react when ADB state transitions (e.g. unauthorized -> device, or no-device -> device)
    if (prevState !== adbStatus.state) {
      if (adbStatus.state === "unauthorized" && mode === "usb") {
        setCurrentStepIndex(3); // Step 4: RSA Auth
      } else if (adbStatus.state === "device") {
        if (mode === "usb") {
          setCurrentStepIndex(4); // Step 5: Ready
        } else if (adbStatus.activeDevice?.isWireless) {
          setHasSwitched(true);
          setSwitchResult({ serial: adbStatus.activeDevice.serial });
          setCurrentStepIndex(3); // Ready in Wi-Fi mode
        }
      } else if (adbStatus.state === "no-device") {
        // Smoothly return directly to the mode selection screen on disconnect
        setMode(null);
        setCurrentStepIndex(0);
      }
    }
  }, [adbStatus?.state, adbStatus?.activeDevice?.isWireless, mode]);

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
      badge: isDeviceOnline && !activeDevice?.isWireless ? "READY" : "STEP 5",
      title:
        isDeviceOnline && !activeDevice?.isWireless
          ? (activeDevice?.model ? `${activeDevice.model} Connected` : "Device Connected & Verified")
          : "Search & Connect Phone",
      instruction:
        isDeviceOnline && !activeDevice?.isWireless
          ? "Your phone is connected, authorized, and ready for video streaming."
          : "Connect phone with USB data cable and tap 'Search Phone'.",
      detail:
        isDeviceOnline && !activeDevice?.isWireless
          ? (activeDevice
              ? `Serial: ${activeDevice.serial} • Resolution: ${activeDevice.width ? `${activeDevice.width}×${activeDevice.height}` : "Auto"}`
              : "The mirror engine will capture the display at native resolution.")
          : "Make sure USB debugging is authorized on your phone screen.",
      statusText:
        isDeviceOnline && !activeDevice?.isWireless
          ? "Status: Device Authorized (Online)"
          : "Waiting for USB device detection...",
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
      title: "Device Connection & Switch",
      instruction: "Connect your phone via USB to configure wireless mode.",
      detail: "Enables ADB TCP connection over your local network for wireless streaming.",
      statusText: isDeviceOnline
        ? activeDevice?.isWireless
          ? "Wireless link active"
          : "USB device ready to switch"
        : "Scanning for connected devices...",
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

  const steps = mode === "wifi" ? wifiSteps : usbSteps;
  const currentStep = steps[Math.min(currentStepIndex, steps.length - 1)];

  const isReady =
    (mode === "usb" && currentStep?.id === "ready" && isDeviceOnline && !activeDevice?.isWireless) ||
    (mode === "wifi" && (currentStep?.id === "ready" || hasSwitched || Boolean(activeDevice?.isWireless)));

  const handleNext = () => {
    if (isReady) {
      onComplete?.();
    } else if (mode === "usb" && currentStep?.id === "ready" && (!isDeviceOnline || activeDevice?.isWireless)) {
      handleSearchPhone();
    } else if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      onComplete?.();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    } else {
      setMode(null);
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

  const handleSearchPhone = async () => {
    if (isScanning || !window.electronAPI) return;
    setIsScanning(true);
    setConnectionFeedback(null);
    try {
      const status = await window.electronAPI.getAdbStatus();
      await new Promise((r) => setTimeout(r, 600));
      if (status?.state === "device" && status.activeDevice) {
        if (status.activeDevice.isWireless) {
          if (mode === "wifi") {
            setHasSwitched(true);
            setSwitchResult({ serial: status.activeDevice.serial });
            setCurrentStepIndex(3); // Ready in Wi-Fi mode
          }
          setConnectionFeedback(`Wireless device online: ${status.activeDevice.serial}`);
        } else {
          if (mode === "usb") {
            setCurrentStepIndex(4); // Ready in USB mode
          }
          setConnectionFeedback(`Device detected: ${status.activeDevice.model || status.activeDevice.serial}`);
        }
      } else if (status?.state === "unauthorized") {
        setConnectionFeedback("Device detected: authorize ADB prompt on phone screen.");
      } else {
        setConnectionFeedback("No device found. Connect phone with USB and enable USB debugging.");
      }
    } catch {
      setConnectionFeedback("Bus scan failed. Verify ADB connection.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSwitchFromUsb = async () => {
    if (!activeDevice || !window.electronAPI || isConnecting) return;
    setIsConnecting(true);
    setConnectionFeedback("Configuring wireless TCP mode…");
    try {
      const res = await window.electronAPI.enableWireless(activeDevice.serial);
      if (res.success && res.ip) {
        const target = `${res.ip}:5555`;
        setHasSwitched(true);
        setSwitchResult({ ip: res.ip, serial: target });
        setConnectionFeedback(`Connected to ${target}`);
        setCurrentStepIndex(3); // Ready in Wi-Fi mode
      } else {
        setConnectionFeedback(res.error || "Failed to switch to Wi-Fi mode");
      }
    } catch (e: any) {
      setConnectionFeedback(e?.message || "Error switching to Wi-Fi");
    } finally {
      setIsConnecting(false);
    }
  };

  // If no connection mode is chosen yet, show the centered two-option selection screen
  if (mode === null) {
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
        {/* Middle of Screen: 2 Options */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "16px",
            padding: "0 4px",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--mist-100)",
                marginBottom: "4px",
                letterSpacing: "-0.01em",
              }}
            >
              Select Connection
            </h2>
            <p
              style={{
                fontSize: "11px",
                color: "var(--mist-400)",
                lineHeight: 1.4,
                maxWidth: "260px",
                margin: "0 auto",
              }}
            >
              Choose how you want to mirror your Android screen to this computer.
            </p>
          </div>

          <div
            style={{
              width: "100%",
              maxWidth: "280px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {/* Option 1: USB Cable */}
            <button
              type="button"
              onClick={() => {
                setMode("usb");
                setCurrentStepIndex(0);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--ink-900)",
                border: "1px solid var(--border)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 140ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--mist-200)";
                e.currentTarget.style.backgroundColor = "var(--ink-800)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.backgroundColor = "var(--ink-900)";
              }}
            >
              <div
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "50%",
                  backgroundColor: "var(--ink-950)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--mist-200)",
                  flexShrink: 0,
                }}
              >
                <UsbIcon size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--mist-100)" }}>
                    USB Cable
                  </div>
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: "3px",
                      backgroundColor: "rgba(95, 191, 154, 0.14)",
                      color: "var(--success)",
                      border: "1px solid rgba(95, 191, 154, 0.3)",
                    }}
                  >
                    60 FPS
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "var(--mist-400)", marginTop: "2px", lineHeight: 1.3 }}>
                  Direct wired cable connection. Ultra-low latency and plug & play.
                </div>
              </div>
            </button>

            {/* Option 2: Wi-Fi Wireless */}
            <button
              type="button"
              onClick={() => {
                setMode("wifi");
                setCurrentStepIndex(0);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 14px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--ink-900)",
                border: "1px solid var(--border)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 140ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--mist-200)";
                e.currentTarget.style.backgroundColor = "var(--ink-800)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.backgroundColor = "var(--ink-900)";
              }}
            >
              <div
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "50%",
                  backgroundColor: "var(--ink-950)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--mist-200)",
                  flexShrink: 0,
                }}
              >
                <WifiIcon size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--mist-100)" }}>
                    Wi-Fi Wireless
                  </div>
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: "3px",
                      backgroundColor: "var(--ink-800)",
                      color: "var(--mist-300)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Untethered
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "var(--mist-400)", marginTop: "2px", lineHeight: 1.3 }}>
                  Mirror wirelessly over the same local Wi-Fi router.
                </div>
              </div>
            </button>
          </div>
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
          }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: isDeviceOnline ? "var(--success)" : "var(--ink-600)",
              flexShrink: 0,
            }}
          />
          <span
            className="mono-data"
            style={{
              fontSize: "10.5px",
              color: isDeviceOnline ? "var(--success)" : "var(--mist-400)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {isDeviceOnline
              ? `Hardware Ready: ${activeDevice?.model || activeDevice?.serial}`
              : "Waiting for mode selection..."}
          </span>
        </div>
      </div>
    );
  }

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
            color: mode === "wifi" ? "var(--mist-100)" : "var(--text-muted)",
            border: mode === "wifi" ? "1px solid var(--border)" : "1px solid transparent",
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
              color: "var(--mist-300)",
            }}
          >
            {currentStep.badge}
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Step {currentStepIndex + 1} of {steps.length}
          </span>
        </div>
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
                  ? "var(--mist-200)"
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
          <div style={{ width: "100%", maxWidth: "300px", display: "flex", flexDirection: "column", gap: "10px", margin: "0 auto" }}>
            {/* Case A: Wireless link is established */}
            {hasSwitched || activeDevice?.isWireless ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "16px",
                  backgroundColor: "rgba(16, 27, 36, 0.85)",
                  border: "1px solid rgba(95, 191, 154, 0.4)",
                  borderRadius: "var(--radius-md)",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: "var(--success)",
                      boxShadow: "0 0 8px var(--success)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--success)" }}>
                    Wi-Fi Connection Active
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--mist-100)", marginBottom: "4px" }}>
                    You may now unplug the USB cable.
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--mist-300)", lineHeight: 1.4 }}>
                    Your device is configured for wireless streaming over the local network.
                  </div>
                </div>

                <div
                  className="mono-data"
                  style={{
                    fontSize: "11px",
                    color: "var(--mist-300)",
                    padding: "7px 10px",
                    backgroundColor: "var(--ink-950)",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                  }}
                >
                  {switchResult?.serial || activeDevice?.serial || "Wireless link ready"}
                </div>

                <button
                  type="button"
                  onClick={() => onComplete?.()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--success)",
                    color: "var(--ink-950)",
                    fontWeight: 700,
                    fontSize: "12px",
                    border: "none",
                    cursor: "pointer",
                    marginTop: "2px",
                  }}
                >
                  <span>Start Wireless Stream</span>
                  <ChevronRightIcon size={14} />
                </button>
              </div>
            ) : activeDevice && !activeDevice.isWireless ? (
              /* Case B: USB Device Detected & Ready to Switch */
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "16px",
                  backgroundColor: "rgba(16, 27, 36, 0.85)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>Connected Device</span>
                  <span
                    style={{
                      fontSize: "9.5px",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "3px",
                      backgroundColor: "rgba(95, 191, 154, 0.12)",
                      color: "var(--success)",
                      border: "1px solid rgba(95, 191, 154, 0.3)",
                    }}
                  >
                    USB Authorized
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--mist-100)" }}>
                    {activeDevice.model || "Android Device"}
                  </div>
                  <div className="mono-data" style={{ fontSize: "10px", color: "var(--mist-400)", marginTop: "2px" }}>
                    Serial: {activeDevice.serial}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSwitchFromUsb}
                  disabled={isConnecting}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "10px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--mist-200)",
                    color: "var(--ink-950)",
                    fontWeight: 700,
                    fontSize: "12px",
                    border: "none",
                    cursor: isConnecting ? "not-allowed" : "pointer",
                    opacity: isConnecting ? 0.75 : 1,
                  }}
                >
                  <WifiIcon size={14} />
                  <span>{isConnecting ? "Configuring Wi-Fi Mode…" : "Switch to Wi-Fi Mode"}</span>
                </button>
              </div>
            ) : (
              /* Case C: No USB device detected yet */
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "18px 16px",
                  backgroundColor: "rgba(16, 27, 36, 0.85)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  textAlign: "center",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--mist-400)",
                  }}
                >
                  <UsbIcon size={20} />
                </div>

                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--mist-100)" }}>
                    No USB device detected
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--mist-400)", marginTop: "4px", lineHeight: 1.45 }}>
                    Connect phone with a USB data cable and verify USB debugging is authorized.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSearchPhone}
                  disabled={isScanning}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    width: "100%",
                    padding: "9px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--ink-800)",
                    color: "var(--mist-100)",
                    fontWeight: 600,
                    fontSize: "11.5px",
                    border: "1px solid var(--border)",
                    cursor: isScanning ? "not-allowed" : "pointer",
                  }}
                >
                  <SearchIcon size={13} className={isScanning ? "spin" : undefined} />
                  <span>{isScanning ? "Searching for Phone…" : "Search Phone"}</span>
                </button>
              </div>
            )}

            {connectionFeedback && (
              <div
                style={{
                  fontSize: "10px",
                  color: connectionFeedback.toLowerCase().includes("connected") || connectionFeedback.toLowerCase().includes("online")
                    ? "var(--success)"
                    : "var(--warning)",
                  padding: "6px 10px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(6, 20, 27, 0.9)",
                  border: "1px solid var(--border)",
                  textAlign: "center",
                  width: "100%",
                  boxSizing: "border-box",
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
                isDeviceOnline && (mode === "usb" ? !activeDevice?.isWireless : true) ? (
                  <CheckIcon size={30} style={{ color: "var(--success)" }} />
                ) : (
                  <UsbIcon size={30} />
                )
              )}
            </div>

          </>
        )}

        {/* Step Title & Instruction (omitted on wifi_pair where the dedicated card provides full context) */}
        {currentStep.id !== "wifi_pair" && (
          <>
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
            {currentStep.id === "developer_options" && (
              <button
                type="button"
                onClick={handleTapBuildNumber}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  marginTop: "12px",
                  padding: "5px 12px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--ink-950)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  fontSize: "10.5px",
                  color: tapCounter >= 7 ? "var(--success)" : "var(--mist-300)",
                  transition: "all 140ms ease",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor:
                      tapCounter >= 7
                        ? "var(--success)"
                        : tapCounter > 0
                        ? "var(--warning)"
                        : "var(--mist-400)",
                  }}
                />
                <span>
                  {tapCounter >= 7
                    ? "Developer mode unlocked!"
                    : tapCounter > 0
                    ? `Build number tapped: ${tapCounter}/7`
                    : "Simulate: Tap here 7 times"}
                </span>
              </button>
            )}
            {mode === "usb" && currentStep.id === "ready" && (!isDeviceOnline || activeDevice?.isWireless) && (
              <div style={{ width: "100%", maxWidth: "280px", margin: "14px auto 0 auto" }}>
                <button
                  type="button"
                  onClick={handleSearchPhone}
                  disabled={isScanning}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    width: "100%",
                    padding: "9px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--ink-800)",
                    color: "var(--mist-100)",
                    fontWeight: 600,
                    fontSize: "11.5px",
                    border: "1px solid var(--border)",
                    cursor: isScanning ? "not-allowed" : "pointer",
                  }}
                >
                  <SearchIcon size={13} className={isScanning ? "spin" : undefined} />
                  <span>{isScanning ? "Searching for Phone…" : "Search Phone"}</span>
                </button>
                {connectionFeedback && (
                  <div
                    style={{
                      fontSize: "10px",
                      color: connectionFeedback.toLowerCase().includes("detected")
                        ? "var(--success)"
                        : "var(--warning)",
                      padding: "6px 10px",
                      borderRadius: "4px",
                      backgroundColor: "rgba(6, 20, 27, 0.9)",
                      border: "1px solid var(--border)",
                      textAlign: "center",
                      marginTop: "10px",
                    }}
                  >
                    {connectionFeedback}
                  </div>
                )}
              </div>
            )}
            {currentStep.id === "wifi_network" && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  marginTop: "8px",
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--ink-950)",
                  border: "1px solid var(--border)",
                  fontSize: "10px",
                  color: "var(--mist-300)",
                }}
              >
                <span
                  style={{
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    backgroundColor: "var(--success)",
                  }}
                />
                <span>5 GHz Wi-Fi Recommended</span>
              </div>
            )}
          </>
        )}
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
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            color: "var(--mist-400)",
            cursor: "pointer",
            fontSize: "11px",
          }}
        >
          <ChevronLeftIcon size={14} />
          {currentStepIndex === 0 ? "Modes" : "Back"}
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
            backgroundColor: isReady ? "var(--success)" : "var(--ink-800)",
            border: isReady ? "1px solid var(--success)" : "1px solid var(--border)",
            color: isReady ? "#06141B" : "var(--mist-200)",
            fontWeight: 700,
            fontSize: "11px",
            cursor: "pointer",
            transition: "all 140ms ease",
          }}
        >
          <span>{isReady ? "Start Stream" : "Next Step"}</span>
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
