import React, { useState, useEffect } from "react";
import type { AdbStatusPayload } from "../../types/electron";
import {
  UsbIcon,
  ToggleRightIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
} from "../icons";

export type WizardStepId = "usb" | "developer_options" | "usb_debugging" | "rsa_auth" | "ready";

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

export const SetupWizard: React.FC<SetupWizardProps> = ({ adbStatus, notice, onComplete, onDismiss }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [tapCounter, setTapCounter] = useState(0);

  // Automatically react to real hardware state changes from ADB
  useEffect(() => {
    if (!adbStatus) return;

    if (adbStatus.state === "unauthorized") {
      // Prompt is currently appearing on phone screen!
      setCurrentStepIndex(3); // Step 4: RSA Auth
    } else if (adbStatus.state === "device") {
      // Device is authorized and online
      setCurrentStepIndex(4); // Step 5: Ready
    } else {
      // Back to the waiting screen: never keep stale "connected" steps
      setCurrentStepIndex(0); // Step 1: Connect USB
    }
  }, [adbStatus?.state]);

  const activeDevice = adbStatus?.activeDevice;

  const steps: WizardStep[] = [
    {
      id: "usb",
      badge: "STEP 1",
      title: "Connect USB Cable",
      instruction: "Plug your Android phone into this computer using a USB data cable.",
      detail: "Make sure you use a data-transfer capable cable (not a charge-only cable).",
      statusText: adbStatus?.state === "no-device" ? "Listening for hardware connection..." : "USB link detected",
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

  const currentStep = steps[currentStepIndex];

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

  const isDeviceOnline = adbStatus?.state === "device";

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
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            className="mono-data"
            style={{
              fontSize: "11px",
              padding: "2px 6px",
              backgroundColor: "var(--ink-800)",
              borderRadius: "var(--radius-sm)",
              color: "var(--mist-400)",
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
          marginBottom: "var(--space-4)",
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
                backgroundColor: isActive ? "var(--mist-200)" : isDone ? "var(--ink-600)" : "var(--ink-800)",
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
        <div
          style={{
            width: "68px",
            height: "68px",
            borderRadius: "50%",
            backgroundColor: "var(--ink-900)",
            border: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: isDeviceOnline && currentStep.id === "ready" ? "var(--success)" : "var(--mist-200)",
            marginBottom: "var(--space-4)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
          }}
        >
          {currentStep.id === "usb" && <UsbIcon size={32} />}
          {currentStep.id === "developer_options" && <SmartphoneIcon size={32} />}
          {currentStep.id === "usb_debugging" && <ToggleRightIcon size={32} />}
          {currentStep.id === "rsa_auth" && (
            <ShieldCheckIcon
              size={32}
              style={{ color: adbStatus?.state === "unauthorized" ? "var(--warning)" : "inherit" }}
            />
          )}
          {currentStep.id === "ready" && <CheckIcon size={32} style={{ color: "var(--success)" }} />}
        </div>

        <h3
          style={{
            fontSize: "var(--text-base)",
            fontWeight: 600,
            color: "var(--mist-200)",
            marginBottom: "var(--space-2)",
          }}
        >
          {currentStep.title}
        </h3>

        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--mist-400)",
            lineHeight: 1.5,
            maxWidth: "34ch",
            marginBottom: "var(--space-2)",
          }}
        >
          {currentStep.instruction}
        </p>

        <p
          style={{
            fontSize: "11px",
            color: "var(--ink-600)",
            maxWidth: "32ch",
            lineHeight: 1.4,
          }}
        >
          {currentStep.detail}
        </p>

        {/* Interactive Build Number Simulator for Step 2 */}
        {currentStep.id === "developer_options" && (
          <div style={{ marginTop: "var(--space-4)" }}>
            <button
              onClick={handleTapBuildNumber}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--ink-800)",
                border: "1px solid var(--border)",
                fontSize: "11px",
                color: "var(--mist-200)",
              }}
            >
              {tapCounter < 7
                ? `Test: Tap Build Number (${tapCounter}/7)`
                : "Developer Options Unlocked ✓"}
            </button>
          </div>
        )}

        {/* Simulated RSA Authorization Card for Step 4 */}
        {currentStep.id === "rsa_auth" && (
          <div
            style={{
              marginTop: "var(--space-3)",
              padding: "8px 12px",
              backgroundColor: "var(--ink-900)",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${adbStatus?.state === "unauthorized" ? "var(--warning)" : "var(--border)"}`,
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              color: "var(--mist-400)",
              textAlign: "left",
            }}
          >
            <div>PHONE PROMPT STATUS:</div>
            <div
              style={{
                color: adbStatus?.state === "unauthorized" ? "var(--warning)" : "var(--mist-200)",
                fontWeight: 600,
              }}
            >
              {adbStatus?.state === "unauthorized"
                ? "Waiting for tap on phone: [ALLOW]"
                : "Check phone screen for prompt"}
            </div>
          </div>
        )}
      </div>

      {/* Live Hardware Telemetry State Indicator */}
      <div
        className="mono-data"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 10px",
          backgroundColor: "var(--ink-950)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
          fontSize: "10px",
          color:
            adbStatus?.state === "device"
              ? "var(--success)"
              : adbStatus?.state === "unauthorized"
              ? "var(--warning)"
              : "var(--text-muted)",
          marginBottom: "var(--space-3)",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor:
              adbStatus?.state === "device"
                ? "var(--success)"
                : adbStatus?.state === "unauthorized"
                ? "var(--warning)"
                : "var(--ink-600)",
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {adbStatus?.state === "device"
            ? `Online: ${activeDevice?.model ?? "Android Device"}`
            : adbStatus?.state === "unauthorized"
            ? "Action Required: Tap Allow on Phone"
            : currentStep.statusText}
        </span>
      </div>

      {/* Action Footer Navigation Buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
        }}
      >
        <button
          onClick={handlePrev}
          disabled={currentStepIndex === 0}
          style={{
            gap: "4px",
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
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
            gap: "4px",
            padding: "8px 14px",
            borderRadius: "var(--radius-sm)",
            backgroundColor: isDeviceOnline && currentStep.id === "ready" ? "var(--success)" : "var(--ink-800)",
            border: "1px solid var(--border)",
            color: isDeviceOnline && currentStep.id === "ready" ? "#06141B" : "var(--mist-200)",
            fontWeight: 600,
            fontSize: "11px",
          }}
        >
          {currentStep.id === "ready" ? "Start Stream" : "Next Step"}
          <ChevronRightIcon size={14} />
        </button>
      </div>

      {/* Brief session notice (absolute so showing/hiding never shifts layout) */}
      {notice && (
        <div
          className="mono-data"
          style={{
            position: "absolute",
            left: "var(--space-4)",
            right: "var(--space-4)",
            bottom: "104px",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "8px 10px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            backgroundColor: "rgba(6, 20, 27, 0.92)",
            backdropFilter: "blur(6px)",
            fontSize: "10px",
            lineHeight: 1.4,
            color: "var(--mist-400)",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              backgroundColor: "var(--warning)",
              flexShrink: 0,
            }}
          />
          {notice}
        </div>
      )}
    </div>
  );
};
