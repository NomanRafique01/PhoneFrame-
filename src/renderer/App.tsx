import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  FrameControls,
  type PhoneFrameOptions,
  DEFAULT_CUSTOM_FRAME_HEX,
} from "./components/PhoneFrame";
import { PhoneScreenItem } from "./components/PhoneScreen";
import { FullscreenControls } from "./components/FullscreenControls/FullscreenControls";
import { WifiIcon } from "./components/icons";
import type { AdbStatusPayload } from "./types/electron";
import appIcon from "../../assets/phoneframe-icon.png";

const DRAG_HOLD_MS = 180;
const DRAG_MOVE_TOLERANCE = 6;

export interface ScreenInstance {
  id: string;
  name: string;
  options: PhoneFrameOptions;
  scale: number;
  offset: { x: number; y: number };
  zIndex: number;
  opacity: number;
  isDragging: boolean;
  isHovered: boolean;
  dragMode: boolean;
  isScreenInteracting: boolean;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function getScreenFrameDimensions(options: PhoneFrameOptions, scale: number) {
  const scaledBaseScreenWidth = Math.round((360 * scale) / 100);
  const scaledBezelWidth = Math.round((options.bezelWidth * scale) / 100);
  const isPortrait = options.orientation === "portrait";
  const ratioMultiplier = options.aspectRatio.height / options.aspectRatio.width;
  const screenWidth = Math.round(
    isPortrait ? scaledBaseScreenWidth : scaledBaseScreenWidth * ratioMultiplier
  );
  const screenHeight = Math.round(
    isPortrait ? scaledBaseScreenWidth * ratioMultiplier : scaledBaseScreenWidth
  );
  return {
    width: screenWidth + scaledBezelWidth * 2,
    height: screenHeight + scaledBezelWidth * 2,
  };
}

function getBoundingRect(screen: ScreenInstance): Rect {
  const { width, height } = getScreenFrameDimensions(screen.options, screen.scale);
  const halfW = width / 2;
  const halfH = height / 2;
  return {
    left: screen.offset.x - halfW,
    right: screen.offset.x + halfW,
    top: screen.offset.y - halfH,
    bottom: screen.offset.y + halfH,
  };
}

function doRectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

function computeUnderneathScreens(screens: ScreenInstance[]): Set<string> {
  const underneath = new Set<string>();
  if (screens.length <= 1) return underneath;

  const rects = screens.map((s) => ({ screen: s, rect: getBoundingRect(s) }));

  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const a = rects[i]; // higher zIndex candidate
      const b = rects[j]; // lower zIndex candidate

      if (a.screen.zIndex > b.screen.zIndex && doRectsIntersect(a.rect, b.rect)) {
        underneath.add(b.screen.id);
      }
    }
  }

  return underneath;
}

export const App: React.FC = () => {
  const [screens, setScreens] = useState<ScreenInstance[]>(() => {
    let savedNickname = "";
    try {
      savedNickname = localStorage.getItem("phoneframe_device_nickname")?.trim() || "";
    } catch {
      // Ignore storage restrictions
    }

    let savedScale = 70;
    try {
      const saved = localStorage.getItem("phoneframe_scale_v5");
      const parsed = saved ? Number(saved) : NaN;
      if (!isNaN(parsed) && parsed >= 60 && parsed <= 140) {
        savedScale = parsed;
      }
    } catch {
      // Ignore storage restrictions
    }

    return [
      {
        id: "primary",
        name: savedNickname || "Phone 1",
        options: {
          bezelWidth: 16,
          outerRadius: 40,
          screenRadius: 26,
          color: "slate",
          customColorHex: DEFAULT_CUSTOM_FRAME_HEX,
          notchStyle: "punch-center",
          showSpeaker: true,
          showHardwareButtons: true,
          orientation: "portrait",
          aspectRatio: { width: 9, height: 20 },
          baseScreenWidth: 360,
        },
        scale: savedScale,
        offset: { x: 0, y: 0 },
        zIndex: 1,
        opacity: 1,
        isDragging: false,
        isHovered: false,
        dragMode: false,
        isScreenInteracting: false,
      },
    ];
  });

  const [adbStatus, setAdbStatus] = useState<AdbStatusPayload>({
    state: "no-device",
    devices: [],
    activeDevice: null,
  });

  const [isPinned, setIsPinned] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeInspectorScreenId, setActiveInspectorScreenId] = useState<string | null>(null);
  const [quickIp, setQuickIp] = useState("");
  const [wifiBusy, setWifiBusy] = useState(false);
  const [wifiMsg, setWifiMsg] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const isFullscreenRef = useRef(false);
  const savedOffsetsRef = useRef<Record<string, { x: number; y: number }>>({});

  const dragRef = useRef<{ screenId: string; pointerId: number; lastX: number; lastY: number } | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const dragPendingRef = useRef<{
    screenId: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  const showInspector = activeInspectorScreenId !== null;
  const activeScreen = screens.find((s) => s.id === activeInspectorScreenId) ?? screens[0];

  // Fullscreen tracking
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    window.electronAPI?.getFullscreen?.().then((flag) => {
      if (typeof flag === "boolean") setIsFullscreen(flag);
    });

    const unsubscribe = window.electronAPI?.onFullscreenChange?.((flag) => setIsFullscreen(flag));
    return () => unsubscribe?.();
  }, []);

  // Escape exits fullscreen
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isFullscreenRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setIsFullscreen(false);
      void window.electronAPI?.setFullscreen?.(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Set window overlay size once at start
  useEffect(() => {
    window.electronAPI?.setWindowSize(window.screen.availWidth, window.screen.availHeight);
  }, []);

  // Subscribe to ADB status
  useEffect(() => {
    if (window.electronAPI?.getAdbStatus) {
      window.electronAPI.getAdbStatus().then((status) => {
        if (status) setAdbStatus(status);
      });
    }

    if (window.electronAPI?.onAdbStatusChange) {
      const unsub = window.electronAPI.onAdbStatusChange((status) => {
        setAdbStatus(status);

        // Auto-adapt aspect ratio on primary screen if dimensions available
        if (status.state === "device" && status.activeDevice?.width && status.activeDevice?.height) {
          const w = status.activeDevice.width;
          const h = status.activeDevice.height;
          const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
          const divisor = gcd(w, h);
          const ratioW = Math.round((w / divisor) * 10) / 10;
          const ratioH = Math.round((h / divisor) * 10) / 10;

          setScreens((prev) =>
            prev.map((s, idx) =>
              idx === 0
                ? {
                    ...s,
                    options: {
                      ...s.options,
                      aspectRatio: {
                        width: Math.min(ratioW, ratioH),
                        height: Math.max(ratioW, ratioH),
                      },
                    },
                  }
                : s
            )
          );
        }
      });

      return () => unsub();
    }
  }, []);

  // Mouse event ignore coordination
  const anyHovered = screens.some((s) => s.isHovered);
  const anyDragging = screens.some((s) => s.isDragging);
  const anyInteracting = screens.some((s) => s.isScreenInteracting);

  useEffect(() => {
    window.electronAPI?.setIgnoreMouseEvents?.(
      !(isFullscreen || anyHovered || anyDragging || anyInteracting || showInspector)
    );
  }, [isFullscreen, anyHovered, anyDragging, anyInteracting, showInspector]);

  // Dismiss settings panel on outside click
  useEffect(() => {
    if (!showInspector) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (inspectorRef.current?.contains(target)) return;
      if (target.closest('[data-inspector-toggle="true"]')) return;
      handleCloseInspector();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showInspector, activeInspectorScreenId]);

  // Window Always-on-top handler
  const handleTogglePin = async () => {
    const newFlag = !isPinned;
    setIsPinned(newFlag);
    if (window.electronAPI?.setAlwaysOnTop) {
      await window.electronAPI.setAlwaysOnTop(newFlag);
    }
  };

  const handleToggleFullscreen = () => {
    if (isFullscreen) {
      setIsFullscreen(false);
      void window.electronAPI?.setFullscreen?.(false);
    } else {
      setIsFullscreen(true);
      void window.electronAPI?.setFullscreen?.(true);
    }
  };

  const handleMinimize = () => {
    window.electronAPI?.minimize();
  };

  const handleClose = () => {
    window.electronAPI?.close();
  };

  // Add screen: up to 4 total
  const handleAddScreen = () => {
    if (screens.length >= 4) return;
    const newIndex = screens.length + 1;
    const newId = `screen-${Date.now()}`;
    const maxZ = screens.reduce((max, s) => Math.max(max, s.zIndex), 0);
    const staggerX = (screens.length % 4) * 140 - 70;
    const staggerY = (screens.length % 4) * 50 - 25;

    const newScreen: ScreenInstance = {
      id: newId,
      name: `Phone ${newIndex}`,
      options: {
        bezelWidth: 16,
        outerRadius: 40,
        screenRadius: 26,
        color: "slate",
        customColorHex: DEFAULT_CUSTOM_FRAME_HEX,
        notchStyle: "punch-center",
        showSpeaker: true,
        showHardwareButtons: true,
        orientation: "portrait",
        aspectRatio: { width: 9, height: 20 },
        baseScreenWidth: 360,
      },
      scale: screens[0]?.scale ?? 70,
      offset: { x: staggerX, y: staggerY },
      zIndex: maxZ + 1,
      opacity: 1,
      isDragging: false,
      isHovered: false,
      dragMode: false,
      isScreenInteracting: false,
    };

    setScreens((prev) => [...prev, newScreen]);
  };

  // Close screen: primary cannot be closed if it's the only one
  const handleCloseScreen = (screenId: string) => {
    if (screenId === "primary" && screens.length === 1) return;
    window.electronAPI?.stopMirror?.(screenId);
    setScreens((prev) => prev.filter((s) => s.id !== screenId));
    if (activeInspectorScreenId === screenId) {
      setActiveInspectorScreenId(null);
    }
    delete savedOffsetsRef.current[screenId];
  };

  const clearDragHold = () => {
    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }
    dragPendingRef.current = null;
  };

  const handleDragStart = (screenId: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;

    // Bring clicked screen to top
    setScreens((prev) => {
      const maxZ = prev.reduce((max, s) => Math.max(max, s.zIndex), 0);
      return prev.map((s) => (s.id === screenId ? { ...s, zIndex: maxZ + 1 } : s));
    });

    const screen = screens.find((s) => s.id === screenId);
    if (!screen) return;

    if (screen.dragMode) {
      if (dragPendingRef.current || dragRef.current) return;
      e.preventDefault();
      const pointerId = e.pointerId;
      dragPendingRef.current = {
        screenId,
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      e.currentTarget.setPointerCapture(pointerId);
      dragHoldTimerRef.current = window.setTimeout(() => {
        dragHoldTimerRef.current = null;
        const pending = dragPendingRef.current;
        if (!pending || pending.pointerId !== pointerId) return;
        dragPendingRef.current = null;
        dragRef.current = { screenId, pointerId, lastX: pending.lastX, lastY: pending.lastY };
        setScreens((prev) =>
          prev.map((s) => (s.id === screenId ? { ...s, isDragging: true } : s))
        );
      }, DRAG_HOLD_MS);
      return;
    }

    dragRef.current = { screenId, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setScreens((prev) =>
      prev.map((s) => (s.id === screenId ? { ...s, isDragging: true } : s))
    );
  };

  const handleDragMove = (screenId: string, e: React.PointerEvent<HTMLDivElement>) => {
    const pending = dragPendingRef.current;
    if (pending && pending.pointerId === e.pointerId && pending.screenId === screenId) {
      if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > DRAG_MOVE_TOLERANCE) {
        clearDragHold();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        return;
      }
      pending.lastX = e.clientX;
      pending.lastY = e.clientY;
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || drag.screenId !== screenId) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    if (dx === 0 && dy === 0) return;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    setScreens((prev) =>
      prev.map((s) =>
        s.id === screenId
          ? { ...s, offset: { x: s.offset.x + dx, y: s.offset.y + dy } }
          : s
      )
    );
  };

  const handleDragEnd = (screenId: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (dragPendingRef.current?.pointerId === e.pointerId) {
      clearDragHold();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setScreens((prev) =>
      prev.map((s) => (s.id === screenId ? { ...s, isDragging: false } : s))
    );
  };

  const handleLostPointerCapture = (screenId: string, e: React.PointerEvent<HTMLDivElement>) => {
    clearDragHold();
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      setScreens((prev) =>
        prev.map((s) => (s.id === screenId ? { ...s, isDragging: false } : s))
      );
    }
  };

  const handleMouseEnter = (screenId: string) => {
    setScreens((prev) =>
      prev.map((s) => (s.id === screenId ? { ...s, isHovered: true } : s))
    );
  };

  const handleMouseLeave = (screenId: string) => {
    setScreens((prev) =>
      prev.map((s) => (s.id === screenId ? { ...s, isHovered: false } : s))
    );
  };

  const handleToggleDragMode = (screenId: string) => {
    setScreens((prev) =>
      prev.map((s) => {
        if (s.id !== screenId) return s;
        if (s.dragMode) {
          clearDragHold();
          dragRef.current = null;
        }
        return { ...s, dragMode: !s.dragMode, isDragging: false };
      })
    );
  };

  const handleCloseInspector = () => {
    if (activeInspectorScreenId) {
      const saved = savedOffsetsRef.current[activeInspectorScreenId];
      if (saved) {
        setScreens((prev) =>
          prev.map((s) => (s.id === activeInspectorScreenId ? { ...s, offset: saved } : s))
        );
      }
      setActiveInspectorScreenId(null);
    }
  };

  const handleToggleInspector = (screenId: string) => {
    setActiveInspectorScreenId((current) => {
      if (current === screenId) {
        // Closing inspector: restore position
        const saved = savedOffsetsRef.current[screenId];
        if (saved) {
          setScreens((prev) =>
            prev.map((s) => (s.id === screenId ? { ...s, offset: saved } : s))
          );
        }
        return null;
      } else {
        // If another screen was active, restore its position first
        if (current && savedOffsetsRef.current[current]) {
          const prevSaved = savedOffsetsRef.current[current];
          setScreens((prev) =>
            prev.map((s) => (s.id === current ? { ...s, offset: prevSaved } : s))
          );
        }

        // Save current offset of target screen
        const targetScreen = screens.find((s) => s.id === screenId);
        if (targetScreen) {
          savedOffsetsRef.current[screenId] = { ...targetScreen.offset };
        }

        // Center active screen smoothly and elevate zIndex
        setScreens((prev) => {
          const maxZ = prev.reduce((max, s) => Math.max(max, s.zIndex), 0);
          return prev.map((s) =>
            s.id === screenId
              ? { ...s, offset: { x: 0, y: 0 }, zIndex: maxZ + 10 }
              : s
          );
        });

        return screenId;
      }
    });
  };

  const handleQuickConnect = async () => {
    if (!quickIp.trim() || !window.electronAPI) return;
    setWifiBusy(true);
    setWifiMsg(null);
    try {
      const res = await window.electronAPI.connectWireless(quickIp.trim());
      setWifiMsg(res.message);
      if (res.success) setQuickIp("");
    } catch (e: any) {
      setWifiMsg(e?.message || "Failed to connect Wi-Fi");
    } finally {
      setWifiBusy(false);
    }
  };

  const underneathScreens = useMemo(() => computeUnderneathScreens(screens), [screens]);

  return (
    <div
      className="floating-phone-root"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: isFullscreen ? "#000000" : "transparent",
        color: "var(--text)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Stage: all phone screens are mounted and rendered here */}
      <div
        className="phone-stage"
        ref={stageRef}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {screens.map((screen) => {
          const isInspectingThis = activeInspectorScreenId === screen.id;
          const isBackgrounded = showInspector && !isInspectingThis;
          const isUnderneath = underneathScreens.has(screen.id);
          const screenOpacity = isBackgrounded ? 0.25 : isUnderneath ? 0.35 : 1;

          return (
            <PhoneScreenItem
              key={screen.id}
              screenId={screen.id}
              name={screen.name}
              options={screen.options}
              scale={screen.scale}
              offset={screen.offset}
              zIndex={screen.zIndex}
              opacity={screenOpacity}
              isDragging={screen.isDragging}
              isHovered={screen.isHovered}
              dragMode={screen.dragMode}
              isPinned={isPinned}
              totalScreens={screens.length}
              canAddScreen={screens.length < 4}
              canCloseScreen={screens.length > 1}
              adbStatus={adbStatus}
              isInspecting={isInspectingThis}
              isBackgrounded={isBackgrounded}
              isFullscreen={isFullscreen}
            onAddScreen={handleAddScreen}
            onCloseScreen={() => handleCloseScreen(screen.id)}
            onToggleInspector={() => handleToggleInspector(screen.id)}
            onTogglePin={handleTogglePin}
            onToggleDragMode={() => handleToggleDragMode(screen.id)}
            onUpdateName={(name) => {
              setScreens((prev) =>
                prev.map((s) => (s.id === screen.id ? { ...s, name } : s))
              );
              if (screen.id === "primary") {
                try {
                  localStorage.setItem("phoneframe_device_nickname", name);
                } catch {}
              }
            }}
            onOptionsChange={(options) =>
              setScreens((prev) =>
                prev.map((s) => (s.id === screen.id ? { ...s, options } : s))
              )
            }
            onScaleChange={(scale) => {
              setScreens((prev) =>
                prev.map((s) => (s.id === screen.id ? { ...s, scale } : s))
              );
              if (screen.id === "primary") {
                try {
                  localStorage.setItem("phoneframe_scale_v5", String(scale));
                } catch {}
              }
            }}
            onDragStart={(e) => handleDragStart(screen.id, e)}
            onDragMove={(e) => handleDragMove(screen.id, e)}
            onDragEnd={(e) => handleDragEnd(screen.id, e)}
            onLostPointerCapture={(e) => handleLostPointerCapture(screen.id, e)}
            onMouseEnter={() => handleMouseEnter(screen.id)}
            onMouseLeave={() => handleMouseLeave(screen.id)}
            onInteractionChange={(active) =>
              setScreens((prev) =>
                prev.map((s) => (s.id === screen.id ? { ...s, isScreenInteracting: active } : s))
              )
            }
            onMinimize={handleMinimize}
            onClose={handleClose}
          />
        );
      })}
      </div>

      {/* Immersive-mode controls */}
      {isFullscreen && (
        <FullscreenControls
          onExit={handleToggleFullscreen}
          onRotate={() => {
            setScreens((prev) =>
              prev.map((s, idx) =>
                idx === 0
                  ? {
                      ...s,
                      options: {
                        ...s.options,
                        orientation:
                          s.options.orientation === "portrait" ? "landscape" : "portrait",
                      },
                    }
                  : s
              )
            );
          }}
          dpadEnabled={false}
          onToggleDpad={() => {}}
        />
      )}

      {/* Frame Inspector Panel for Active Screen */}
      {showInspector && !isFullscreen && activeScreen && (
        <aside
          className="app-no-drag"
          ref={inspectorRef}
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            bottom: "12px",
            width: "320px",
            minWidth: "320px",
            maxWidth: "320px",
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
            overflowY: "auto",
            zIndex: 9999,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
              <img
                src={appIcon}
                alt=""
                width={28}
                height={28}
                style={{
                  flexShrink: 0,
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  className="mono-data"
                  style={{
                    fontSize: "9px",
                    letterSpacing: "0.1em",
                    color: "var(--text-muted)",
                  }}
                >
                  PHONEFRAME • {activeScreen.name}
                </div>
                <h3
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    color: "var(--mist-200)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Frame Inspector
                </h3>
              </div>
            </div>
            <button
              onClick={handleCloseInspector}
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                fontSize: "11px",
                color: "var(--text-muted)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>

          {/* ADB Hardware Telemetry */}
          <div
            style={{
              padding: "var(--space-3)",
              backgroundColor: "var(--ink-950)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Screen Target
              </span>
              <span
                className="mono-data"
                style={{
                  fontSize: "10px",
                  color: "var(--accent)",
                }}
              >
                {activeScreen.id.toUpperCase()}
              </span>
            </div>

            <table className="mono-data" style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Nickname:</td>
                  <td style={{ textAlign: "right", color: "var(--mist-100)", fontWeight: 600 }}>{activeScreen.name}</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>Active Screens:</td>
                  <td style={{ textAlign: "right", color: "var(--mist-200)" }}>{screens.length} / 4</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--text-muted)", padding: "2px 0" }}>ADB Devices:</td>
                  <td style={{ textAlign: "right", color: "var(--mist-200)" }}>{adbStatus.devices.length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Wi-Fi Direct Connect Card */}
          <div
            style={{
              padding: "var(--space-3)",
              backgroundColor: "var(--ink-950)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <WifiIcon size={12} style={{ color: "var(--accent)" }} />
                Wi-Fi Direct Connect
              </span>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                placeholder="192.168.1.x:5555"
                value={quickIp}
                onChange={(e) => setQuickIp(e.target.value)}
                className="mono-data"
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--ink-900)",
                  border: "1px solid var(--border)",
                  color: "var(--mist-100)",
                  fontSize: "11px",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={handleQuickConnect}
                disabled={wifiBusy || !quickIp.trim()}
                style={{
                  padding: "5px 10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--accent)",
                  border: "none",
                  color: "#06141B",
                  fontSize: "10.5px",
                  fontWeight: 700,
                  cursor: wifiBusy || !quickIp.trim() ? "not-allowed" : "pointer",
                  opacity: wifiBusy || !quickIp.trim() ? 0.6 : 1,
                }}
              >
                Connect
              </button>
            </div>
            {wifiMsg && (
              <div
                style={{
                  fontSize: "9.5px",
                  color: wifiMsg.includes("Connected") ? "var(--success)" : "var(--warning)",
                  padding: "2px 4px",
                  textAlign: "center",
                }}
              >
                {wifiMsg}
              </div>
            )}
          </div>

          {/* Scale Control for Active Screen */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Scale Factor
              </span>
              <span className="mono-data" style={{ fontSize: "var(--text-xs)", color: "var(--mist-200)" }}>
                {activeScreen.scale}%
              </span>
            </div>
            <input
              type="range"
              min="60"
              max="140"
              step="5"
              value={activeScreen.scale}
              onChange={(e) => {
                const newScale = Number(e.target.value);
                setScreens((prev) =>
                  prev.map((s) => (s.id === activeScreen.id ? { ...s, scale: newScale } : s))
                );
              }}
              style={{ accentColor: "var(--mist-200)", cursor: "pointer" }}
            />
          </div>

          {/* Frame Controls for Active Screen */}
          <FrameControls
            options={activeScreen.options}
            onChange={(options) =>
              setScreens((prev) =>
                prev.map((s) => (s.id === activeScreen.id ? { ...s, options } : s))
              )
            }
          />
        </aside>
      )}
    </div>
  );
};
