import React, { useState, useEffect, useRef } from "react";
import type { AdbStatusPayload, AdbDeviceInfo } from "../../types/electron";
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
import { NoticeBanner } from "../Notice/NoticeBanner";

export type ConnectionMode = "usb" | "wifi";
export type WizardStepId =
  | "usb"
  | "developer_options"
  | "usb_debugging"
  | "rsa_auth"
  | "usb_detect"
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
  deviceName?: string;
  slotNumber?: number;
  isNameAssigned?: boolean;
  initialMode?: ConnectionMode | null;
  onDeviceNameChange?: (name: string) => void;
  onNameAssigned?: () => void;
  onSelectMode?: (mode: ConnectionMode) => void;
  onSerialAssigned?: (serial: string) => void;
  onComplete?: (serial?: string) => void;
  onDismiss?: () => void;
  occupiedSerials?: string[];
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  adbStatus,
  notice,
  deviceName = "",
  slotNumber,
  isNameAssigned = false,
  initialMode = null,
  onDeviceNameChange,
  onNameAssigned,
  onSelectMode,
  onSerialAssigned,
  onComplete,
  onDismiss,
  occupiedSerials = [],
}) => {
  const [mode, setMode] = useState<ConnectionMode | null>(initialMode);
  const [internalNotice, setInternalNotice] = useState<string | null>(null);
  const activeNotice = notice || internalNotice;
  const lastSwitchedAtRef = useRef<number>(0);

  const [isNamingStep, setIsNamingStep] = useState(false);
  // Each time user enters naming step, input starts fresh and empty
  const [customDeviceName, setCustomDeviceName] = useState<string>("");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [tapCounter, setTapCounter] = useState(0);
  const [discoveredDevice, setDiscoveredDevice] = useState<AdbDeviceInfo | null>(null);

  // Wireless Wi-Fi switch & direct connect states
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  // Which long-running connection action owns the loading card.
  const [pendingAction, setPendingAction] = useState<"switch" | "ip" | null>(null);
  const [hasSwitched, setHasSwitched] = useState(false);
  const [switchResult, setSwitchResult] = useState<{ ip?: string; serial?: string } | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null);
  const [manualIp, setManualIp] = useState<string>("");
  // While a switch is in flight ADB restarts the link, so the USB entry drops
  // out of the poll for a moment. This keeps the card from flashing "No USB
  // device detected" mid-switch.
  const switchingRef = useRef(false);

  // Sync mode whenever initialMode updates (e.g. resets to null on stream stop)
  useEffect(() => {
    setMode(initialMode ?? null);
    if (initialMode === null) {
      setCurrentStepIndex(0);
      setDiscoveredDevice(null);
      setHasSwitched(false);
      setSwitchResult(null);
      setConnectionFeedback(null);
    }
  }, [initialMode]);

  // Sync with incoming adbStatus: if a device is online/authorized, detect it
  useEffect(() => {
    if (adbStatus?.devices && adbStatus.devices.length > 0) {
      const available = adbStatus.devices.filter((d) => !occupiedSerials.includes(d.serial));
      const auth = available.find((d) => d.state === "device");
      if (auth && (!discoveredDevice || discoveredDevice.state !== "device")) {
        if (mode === "usb" && !auth.isWireless) {
          setDiscoveredDevice(auth);
          setConnectionFeedback(`Device detected: ${auth.model || auth.serial}`);
        } else if (mode === "wifi" && auth.isWireless) {
          setDiscoveredDevice(auth);
          setHasSwitched(true);
          setSwitchResult({ serial: auth.serial });
          setConnectionFeedback(`Wireless device online: ${auth.serial}`);
        }
      }
    }
  }, [adbStatus?.devices, occupiedSerials, mode, discoveredDevice]);

  // If the currently discovered device goes offline, clear it cleanly without dropping wireless when USB unplugs.
  useEffect(() => {
    // A switch restarts the ADB link; keep the current card while it settles.
    if (switchingRef.current) return;

    if (discoveredDevice) {
      const isWirelessMode = hasSwitched || Boolean(discoveredDevice.isWireless);
      const targetSerial = isWirelessMode
        ? (switchResult?.serial || (discoveredDevice.isWireless ? discoveredDevice.serial : null))
        : discoveredDevice.serial;

      if (isWirelessMode && targetSerial) {
        // Grant a 4s grace period after switching so adb device poll can register before checking offline
        if (Date.now() - lastSwitchedAtRef.current < 4000) {
          return;
        }
        const stillOnline = adbStatus?.devices?.some(
          (d) => d.serial === targetSerial && d.state === "device"
        );
        if (!stillOnline) {
          setDiscoveredDevice(null);
          setHasSwitched(false);
          setSwitchResult(null);
          setConnectionFeedback("Wi-Fi connection lost. Click 'Search for Phone' or reconnect USB.");
        }
        return;
      }

      const stillOnline = adbStatus?.devices?.some(
        (d) => d.serial === discoveredDevice.serial && d.state === "device"
      );
      if (!stillOnline) {
        setDiscoveredDevice(null);
        setConnectionFeedback("Device disconnected. Click 'Search for Phone' to scan for an available device.");
      }
    }
  }, [adbStatus?.devices, discoveredDevice, hasSwitched, switchResult?.serial]);

  const activeDevice = discoveredDevice;
  const isDeviceOnline = Boolean(discoveredDevice && discoveredDevice.state === "device");

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
      id: "usb_detect",
      badge: "STEP 5",
      title: "Search & Detect Phone",
      instruction: "Search for your connected phone and verify the ADB connection.",
      detail: "Connect your phone with a USB data cable and tap 'Search Phone'.",
      statusText:
        isDeviceOnline && !activeDevice?.isWireless
          ? "Status: Device Authorized (Online)"
          : isScanning
          ? "Searching for USB devices..."
          : "Click 'Search Phone' to detect your device",
    },
    {
      id: "ready",
      badge: "READY",
      title:
        isDeviceOnline && !activeDevice?.isWireless
          ? (activeDevice?.model ? `${activeDevice.model} Connected` : "Device Connected & Verified")
          : "Device Ready",
      instruction:
        isDeviceOnline && !activeDevice?.isWireless
          ? "Your phone is connected, authorized, and ready for video streaming."
          : "Phone ready for mirroring.",
      detail:
        isDeviceOnline && !activeDevice?.isWireless
          ? (activeDevice
              ? `Serial: ${activeDevice.serial} • Resolution: ${activeDevice.width ? `${activeDevice.width}×${activeDevice.height}` : "Auto"}`
              : "The mirror engine will capture the display at native resolution.")
          : "The mirror engine will capture the display at native resolution.",
      statusText:
        isDeviceOnline && !activeDevice?.isWireless
          ? "Status: Device Authorized (Online)"
          : "Ready",
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
      instruction: "Connect your phone via USB or Wi-Fi IP to configure wireless mode.",
      detail: "Enables ADB TCP connection over your local network for wireless streaming.",
      statusText: isConnecting
        ? pendingAction === "switch"
          ? "Switching to wireless link..."
          : "Connecting over Wi-Fi..."
        : isDeviceOnline
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

  // Auto-trigger search when arriving on Step 5 (usb_detect)
  useEffect(() => {
    if (mode === "usb" && currentStep?.id === "usb_detect" && !discoveredDevice && !isScanning) {
      handleSearchPhone();
    }
  }, [mode, currentStep?.id]);

  const isReady =
    (mode === "usb" && (currentStep?.id === "ready" || (currentStep?.id === "usb_detect" && isDeviceOnline && !activeDevice?.isWireless))) ||
    (mode === "wifi" && (currentStep?.id === "ready" || hasSwitched || Boolean(activeDevice?.isWireless)));

  const handleNext = () => {
    if (isReady && currentStep?.id === "ready") {
      onComplete?.(activeDevice?.serial);
      return;
    }

    if (mode === "wifi") {
      // User CANNOT advance to Step 4 (Ready) unless they have connected and switched to wireless mode
      if (currentStep?.id === "wifi_pair" || currentStepIndex >= 2) {
        if (!hasSwitched && !activeDevice?.isWireless) {
          if (!activeDevice) {
            setConnectionFeedback("Connect phone via USB and click 'Search for Phone' before advancing.");
          } else {
            setConnectionFeedback("Click 'Switch to Wi-Fi Mode' above to enable wireless connection before advancing.");
          }
          return;
        }
      }
    } else if (mode === "usb") {
      // Step 4 (rsa_auth) proceeds smoothly to Step 5!
      // Step 5 (usb_detect): requires device to be online before advancing to final Ready summary
      if (currentStep?.id === "usb_detect") {
        if (!isDeviceOnline || activeDevice?.isWireless) {
          handleSearchPhone();
          setConnectionFeedback("Please connect your phone via USB and click 'Search Phone' to verify before continuing.");
          return;
        }
      }
    }

    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    } else {
      onComplete?.(activeDevice?.serial);
    }
  };

  const handleSelectMode = (selectedMode: ConnectionMode) => {
    setMode(selectedMode);
    onSelectMode?.(selectedMode);
    if (!isNameAssigned) {
      setCustomDeviceName("");
      setIsNamingStep(true);
    } else {
      // Once the name got assigned, do not show naming step on starting again the stream!
      setIsNamingStep(false);
      setCurrentStepIndex(0);
    }
  };

  const handleConfirmName = () => {
    // In case user won't type any name, give it phone name as Phone 1, 2, 3 and so on
    const defaultName = deviceName || (slotNumber ? `Phone ${slotNumber}` : "Phone 1");
    const finalName = customDeviceName.trim() || defaultName;
    onDeviceNameChange?.(finalName);
    onNameAssigned?.();
    setCustomDeviceName("");
    setIsNamingStep(false);
    // If device is already online and authorized, jump directly to ready
    if (isDeviceOnline) {
      if (mode === "usb" && !activeDevice?.isWireless) {
        setCurrentStepIndex(4);
        return;
      }
      if (mode === "wifi" && (hasSwitched || activeDevice?.isWireless)) {
        setCurrentStepIndex(3);
        return;
      }
    }
    setCurrentStepIndex(0);
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    } else {
      if (!isNameAssigned) {
        setCustomDeviceName("");
        setIsNamingStep(true);
      } else {
        setMode(null);
      }
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
      const status = window.electronAPI.refreshDevices
        ? await window.electronAPI.refreshDevices()
        : await window.electronAPI.getAdbStatus();
      await new Promise((r) => setTimeout(r, 400));
      const available = (status?.devices || []).filter(
        (d) => !occupiedSerials.includes(d.serial)
      );
      const target = available.find((d) => d.state === "device") || available[0];
      if (target && target.state === "device") {
        setDiscoveredDevice(target);
        if (target.isWireless) {
          if (mode === "wifi") {
            setHasSwitched(true);
            setSwitchResult({ serial: target.serial });
            setCurrentStepIndex(3); // Ready in Wi-Fi mode
          }
          setConnectionFeedback(`Wireless device online: ${target.serial}`);
        } else {
          if (mode === "usb") {
            setCurrentStepIndex(4); // Step 5: usb_detect
          }
          setConnectionFeedback(`Device detected on port: ${target.model || target.serial}`);
        }
      } else if (target && target.state === "unauthorized") {
        setDiscoveredDevice(target);
        if (mode === "usb") {
          setCurrentStepIndex(4); // Keep on Step 5 so they see the unauthorized guide card!
        }
        setConnectionFeedback("Device detected: authorize ADB prompt on phone screen.");
      } else if (occupiedSerials.length > 0 && (status?.devices?.length || 0) > 0) {
        setDiscoveredDevice(null);
        setConnectionFeedback("Connected USB device is in use by another screen. Connect phone to another USB port or Wi-Fi.");
      } else {
        setDiscoveredDevice(null);
        setConnectionFeedback("No device found. Connect phone with USB and enable USB debugging.");
      }
    } catch {
      setConnectionFeedback("Bus scan failed. Verify ADB connection.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnectManualIp = async () => {
    if (!manualIp.trim() || !window.electronAPI || isConnecting) return;
    setIsConnecting(true);
    setPendingAction("ip");
    switchingRef.current = true;
    setConnectionFeedback(null);
    try {
      const res = await window.electronAPI.connectWireless(manualIp.trim());
      if (res.success) {
        setHasSwitched(true);
        const targetSerial = manualIp.trim().includes(":") ? manualIp.trim() : `${manualIp.trim()}:5555`;
        setSwitchResult({ serial: targetSerial });
        setDiscoveredDevice({
          serial: targetSerial,
          state: "device",
          isWireless: true,
        });
        setConnectionFeedback(`✓ Connected to ${targetSerial}!`);
        setCurrentStepIndex(3); // Ready in Wi-Fi mode
      } else {
        setConnectionFeedback(res.message || "Connection failed. Check phone IP & port.");
      }
    } catch (e: any) {
      setConnectionFeedback(e?.message || "Connection error");
    } finally {
      switchingRef.current = false;
      setIsConnecting(false);
      setPendingAction(null);
    }
  };

  const handleSwitchFromUsb = async () => {
    if (!activeDevice || !window.electronAPI || isConnecting) return;
    setIsConnecting(true);
    setPendingAction("switch");
    switchingRef.current = true;
    setConnectionFeedback(null);
    // Suppress the "device disconnected" check for the whole switch, starting
    // the moment ADB restarts the USB link.
    lastSwitchedAtRef.current = Date.now();
    try {
      const res = await window.electronAPI.enableWireless(activeDevice.serial);
      if (res.success && res.ip) {
        const target = `${res.ip}:5555`;
        lastSwitchedAtRef.current = Date.now();
        setHasSwitched(true);
        setSwitchResult({ ip: res.ip, serial: target });

        // Update discoveredDevice to the wireless target so unplugging USB does not break it
        const wifiDevice: AdbDeviceInfo = {
          serial: target,
          state: "device",
          model: activeDevice.model,
          isWireless: true,
          width: activeDevice.width,
          height: activeDevice.height,
        };
        setDiscoveredDevice(wifiDevice);
        onSerialAssigned?.(target);

        setInternalNotice("✓ Switched to Wi-Fi mode! You can now unplug the USB cable.");
        setTimeout(() => setInternalNotice(null), 6000);
        setConnectionFeedback(`✓ Connected to ${target}! You can now unplug the USB cable.`);
        setCurrentStepIndex(3); // Ready in Wi-Fi mode
      } else {
        setConnectionFeedback(res.error || "Failed to switch to Wi-Fi mode");
      }
    } catch (e: any) {
      setConnectionFeedback(e?.message || "Error switching to Wi-Fi");
    } finally {
      switchingRef.current = false;
      setIsConnecting(false);
      setPendingAction(null);
    }
  };

  const renderNoticeBanner = () => {
    if (!activeNotice) return null;
    return <NoticeBanner message={activeNotice} />;
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
              onClick={() => handleSelectMode("usb")}
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
              onClick={() => handleSelectMode("wifi")}
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

  // Device Naming Screen (Appears after choosing USB or Wi-Fi mode)
  if (isNamingStep && mode !== null) {
    const isWifiMode = mode === "wifi";
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
        {/* Top Header Strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--space-2)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setIsNamingStep(false);
              setMode(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "transparent",
              border: "1px solid var(--border)",
              color: "var(--mist-400)",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <ChevronLeftIcon size={12} />
            <span>Back</span>
          </button>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--ink-900)",
              border: "1px solid var(--border)",
              fontSize: "10px",
              fontWeight: 600,
              color: isWifiMode ? "var(--accent)" : "var(--mist-200)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {isWifiMode ? <WifiIcon size={11} /> : <UsbIcon size={11} />}
            <span>{isWifiMode ? "Wi-Fi Mode" : "USB Mode"}</span>
          </div>
        </div>

        {/* Center Content: Device Naming View with Separate Dedicated Input Card */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "14px",
            padding: "0 8px",
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundColor: "var(--ink-900)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--mist-200)",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
            }}
          >
            <SmartphoneIcon size={22} />
          </div>

          <div>
            <div
              style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: isWifiMode ? "var(--accent)" : "var(--mist-400)",
                textTransform: "uppercase",
                marginBottom: "3px",
              }}
            >
              Step 1 of 2 • Device Identity
            </div>
            <h2
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--mist-100)",
                marginBottom: "4px",
                letterSpacing: "-0.01em",
              }}
            >
              Name Your Device
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
              Enter any custom nickname for this screen. This starts fresh on every connection.
            </p>
          </div>

          {/* Separate Dedicated Input Name Card */}
          <div
            style={{
              width: "100%",
              maxWidth: "285px",
              backgroundColor: "var(--ink-900)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              boxShadow: "0 4px 18px rgba(0, 0, 0, 0.45)",
              padding: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 600,
                    color: "var(--mist-400)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Custom Name
                </label>
                {customDeviceName && (
                  <button
                    type="button"
                    onClick={() => setCustomDeviceName("")}
                    style={{
                      fontSize: "9.5px",
                      color: "var(--mist-400)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div style={{ position: "relative", width: "100%" }}>
                <input
                  type="text"
                  autoFocus
                  value={customDeviceName}
                  onChange={(e) => setCustomDeviceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleConfirmName();
                    }
                  }}
                  placeholder={deviceName || (slotNumber ? `Phone ${slotNumber}` : "Phone 1")}
                  className="mono-data"
                  style={{
                    width: "100%",
                    padding: customDeviceName ? "8px 26px 8px 10px" : "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--ink-950)",
                    border: "1px solid var(--border)",
                    color: "var(--mist-100)",
                    fontSize: "12px",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 140ms ease",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--mist-200)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                />
                {customDeviceName && (
                  <button
                    type="button"
                    onClick={() => setCustomDeviceName("")}
                    title="Clear input"
                    style={{
                      position: "absolute",
                      right: "6px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: "rgba(255, 255, 255, 0.08)",
                      border: "none",
                      color: "var(--mist-400)",
                      fontSize: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {activeDevice?.model && (
              <button
                type="button"
                onClick={() => setCustomDeviceName(activeDevice.model || "")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "5px 8px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--ink-950)",
                  border: "1px dashed var(--border)",
                  fontSize: "10px",
                  color: "var(--mist-400)",
                  cursor: "pointer",
                }}
              >
                <span>Use detected:</span>
                <span style={{ color: "var(--mist-200)", fontWeight: 600 }}>{activeDevice.model}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleConfirmName}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                width: "100%",
                padding: "8px 14px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--mist-200)",
                color: "#06141B",
                fontWeight: 700,
                fontSize: "11.5px",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
                transition: "opacity 140ms ease, transform 140ms ease",
              }}
            >
              <span>Continue</span>
              <ChevronRightIcon size={13} />
            </button>
          </div>
        </div>

        {/* Status indicator bar */}
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
              ? `Hardware: ${activeDevice?.model || activeDevice?.serial}`
              : "Waiting for connection..."}
          </span>
        </div>

        {renderNoticeBanner()}
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
              onClick={() => {
                if (idx === steps.length - 1) {
                  if (mode === "wifi" && !hasSwitched && !activeDevice?.isWireless) {
                    setConnectionFeedback("Connect phone via USB and click 'Switch to Wi-Fi Mode' first.");
                    return;
                  }
                  if (mode === "usb" && (!isDeviceOnline || activeDevice?.isWireless)) {
                    setConnectionFeedback("Connect phone via USB and authorize debugging first.");
                    return;
                  }
                }
                setCurrentStepIndex(idx);
              }}
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
                cursor: idx === steps.length - 1 && !isReady ? "not-allowed" : "pointer",
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
        {currentStep.id === "usb_detect" ? (
          <div style={{ width: "100%", maxWidth: "300px", display: "flex", flexDirection: "column", gap: "10px", margin: "0 auto" }}>
            {/* Case A: USB Device Online & Authorized */}
            {isDeviceOnline && !activeDevice?.isWireless ? (
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                      USB Device Authorized
                    </span>
                  </div>
                  <span
                    className="mono-data"
                    style={{
                      fontSize: "9px",
                      padding: "2px 6px",
                      backgroundColor: "rgba(95, 191, 154, 0.12)",
                      color: "var(--success)",
                      borderRadius: "3px",
                      border: "1px solid rgba(95, 191, 154, 0.3)",
                    }}
                  >
                    READY
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--mist-100)" }}>
                    {activeDevice.model || "Android Phone"}
                  </div>
                  <div className="mono-data" style={{ fontSize: "10px", color: "var(--mist-400)", marginTop: "2px" }}>
                    Serial: {activeDevice.serial} • Resolution: {activeDevice.width ? `${activeDevice.width}×${activeDevice.height}` : "Native"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onComplete?.(activeDevice.serial)}
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
                  <span>Start USB Mirroring</span>
                  <ChevronRightIcon size={14} />
                </button>

                <button
                  type="button"
                  onClick={handleSearchPhone}
                  disabled={isScanning}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                    padding: "6px 10px",
                    borderRadius: "4px",
                    backgroundColor: "transparent",
                    color: "var(--mist-400)",
                    fontWeight: 500,
                    fontSize: "10.5px",
                    border: "1px solid var(--border)",
                    cursor: isScanning ? "not-allowed" : "pointer",
                  }}
                >
                  <RefreshCwIcon size={12} className={isScanning ? "spin" : undefined} />
                  <span>{isScanning ? "Re-scanning…" : "Re-scan Device"}</span>
                </button>
              </div>
            ) : activeDevice && activeDevice.state === "unauthorized" ? (
              /* Case B: Device found but unauthorized */
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "16px",
                  backgroundColor: "rgba(224, 176, 74, 0.08)",
                  border: "1px solid rgba(224, 176, 74, 0.35)",
                  borderRadius: "var(--radius-md)",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ShieldCheckIcon size={18} style={{ color: "var(--warning)" }} />
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--warning)" }}>
                    RSA Authorization Required
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--mist-100)", marginBottom: "4px" }}>
                    Phone detected: {activeDevice.model || activeDevice.serial}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--mist-300)", lineHeight: 1.45 }}>
                    Check your phone screen now. An <strong>"Allow USB debugging?"</strong> prompt is waiting. Check <em>"Always allow"</em> and tap <strong>Allow</strong>.
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
                    padding: "10px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--warning)",
                    color: "var(--ink-950)",
                    fontWeight: 700,
                    fontSize: "12px",
                    border: "none",
                    cursor: isScanning ? "not-allowed" : "pointer",
                  }}
                >
                  <RefreshCwIcon size={13} className={isScanning ? "spin" : undefined} />
                  <span>{isScanning ? "Verifying…" : "I Allowed It — Verify Now"}</span>
                </button>
              </div>
            ) : (
              /* Case C: No device detected yet */
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
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--mist-300)",
                  }}
                >
                  <UsbIcon size={22} />
                </div>

                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--mist-100)" }}>
                    Search for USB Phone
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--mist-400)", marginTop: "4px", lineHeight: 1.45 }}>
                    Connect your phone with a USB data cable and make sure USB debugging is ON.
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
                    padding: "10px 14px",
                    borderRadius: "4px",
                    backgroundColor: "var(--ink-800)",
                    color: "var(--mist-100)",
                    fontWeight: 600,
                    fontSize: "12px",
                    border: "1px solid var(--border)",
                    cursor: isScanning ? "not-allowed" : "pointer",
                  }}
                >
                  <SearchIcon size={14} className={isScanning ? "spin" : undefined} />
                  <span>{isScanning ? "Searching for Connected Phone…" : "Search Phone"}</span>
                </button>
              </div>
            )}

            {connectionFeedback && (
              <div
                style={{
                  fontSize: "10.5px",
                  color:
                    connectionFeedback.toLowerCase().includes("online") ||
                    connectionFeedback.toLowerCase().includes("detected on port")
                      ? "var(--success)"
                      : "var(--warning)",
                  padding: "7px 10px",
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
        ) : currentStep.id === "wifi_pair" ? (
          <div style={{ width: "100%", maxWidth: "300px", display: "flex", flexDirection: "column", gap: "10px", margin: "0 auto" }}>
            {isConnecting ? (
              /* Loading: the switch restarts ADB, so hold this card instead of
                 flashing the "no device" state while the link settles. */
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: "12px",
                  padding: "20px 16px",
                  backgroundColor: "rgba(16, 27, 36, 0.85)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div
                  style={{
                    width: "46px",
                    height: "46px",
                    borderRadius: "50%",
                    backgroundColor: "var(--ink-950)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent)",
                  }}
                >
                  <RefreshCwIcon size={20} className="spin" />
                </div>

                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--mist-100)" }}>
                    {pendingAction === "switch" ? "Switching to Wi-Fi Mode" : "Connecting over Wi-Fi"}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--mist-400)", marginTop: "4px", lineHeight: 1.45 }}>
                    {pendingAction === "switch"
                      ? "Enabling ADB over TCP and re-registering your phone on the wireless link. Keep the USB cable connected for a few seconds."
                      : `Reaching ${manualIp.trim() || "your phone"} over the local network…`}
                  </div>
                </div>

                <div
                  className="mono-data"
                  style={{
                    fontSize: "9.5px",
                    letterSpacing: "0.08em",
                    color: "var(--mist-400)",
                  }}
                >
                  THIS TAKES 3–5 SECONDS
                </div>
              </div>
            ) : hasSwitched || activeDevice?.isWireless ? (
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
                  onClick={() => onComplete?.(activeDevice?.serial)}
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
                    cursor: "pointer",
                  }}
                >
                  <WifiIcon size={14} />
                  <span>Switch to Wi-Fi Mode</span>
                </button>
              </div>
            ) : (
              /* Case C: No device connected yet (USB bridge or direct IP) */
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
                  <WifiIcon size={20} />
                </div>

                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--mist-100)" }}>
                    No device connected yet
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--mist-400)", marginTop: "4px", lineHeight: 1.45 }}>
                    Plug in a USB data cable to bridge your phone onto Wi-Fi, or connect with the phone's IP address below.
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

            {!isConnecting && (
              <>
            {/* Direct IP Connect option */}
            <div style={{ width: "100%", marginTop: "4px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: "10px", color: "var(--mist-400)", marginBottom: "6px", textAlign: "left" }}>
                Or connect directly via Wi-Fi IP:
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.4:5555"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    fontSize: "11px",
                    borderRadius: "4px",
                    backgroundColor: "var(--ink-950)",
                    border: "1px solid var(--border)",
                    color: "var(--mist-100)",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleConnectManualIp}
                  disabled={isConnecting || !manualIp.trim()}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "4px",
                    backgroundColor: "var(--ink-800)",
                    border: "1px solid var(--border)",
                    color: "var(--mist-200)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: isConnecting || !manualIp.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  Connect
                </button>
              </div>
            </div>

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
              </>
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

        {/* Step Title & Instruction (omitted on wifi_pair & usb_detect where the dedicated card provides full context) */}
        {currentStep.id !== "wifi_pair" && currentStep.id !== "usb_detect" && (
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
      {renderNoticeBanner()}
    </div>
  );
};
