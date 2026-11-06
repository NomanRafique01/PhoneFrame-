import { useEffect, useRef } from "react";
import { PhoneAudioPlayer } from "./PhoneAudioPlayer";

/**
 * Plays the phone's audio on the PC while mirroring. The player is created
 * lazily on the first audio packet, so devices that cannot capture audio
 * never pay for an AudioContext, and is released on unmount.
 */
export function usePhoneAudio(muted: boolean, volume: number): void {
  const playerRef = useRef<PhoneAudioPlayer | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  mutedRef.current = muted;
  volumeRef.current = volume;

  useEffect(() => {
    if (!window.electronAPI?.onAudioChunk) return;

    const ensurePlayer = () => {
      if (!playerRef.current) {
        playerRef.current = new PhoneAudioPlayer(mutedRef.current, volumeRef.current);
      }
      return playerRef.current;
    };

    const unsubscribeInit = window.electronAPI.onAudioInit?.(() => {
      ensurePlayer();
    });
    const unsubscribeChunks = window.electronAPI.onAudioChunk((packet) => {
      ensurePlayer().push(packet);
    });

    return () => {
      unsubscribeInit?.();
      unsubscribeChunks();
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    playerRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);

  // The PC gain and the phone's real media volume must always describe the
  // same exclusive output, so the main process needs the same state.
  useEffect(() => {
    window.electronAPI?.setAudioSettings?.({ muted, level: volume });
  }, [muted, volume]);
}
