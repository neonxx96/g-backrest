/**
 * Whale Tracker Web Audio Alert Hook
 * Synthesizes crisp, low-latency audio alerts for Tier-1 order-flow monitoring
 * without any external MP3 files or network requests.
 * Features rate-limiting/throttling (max 5 sounds/sec) to avoid distortion during liquidations.
 */

import { useRef, useEffect, useCallback } from 'react';

export function useTradeAudioAlerts({
  enabled = true,
  thresholdL1 = 100_000,
  thresholdL2 = 500_000,
  thresholdL3 = 1_000_000,
  maxSoundsPerSec = 5
} = {}) {
  const audioCtxRef = useRef(null);
  const playHistoryRef = useRef([]);

  // Lazy initialize AudioContext on user interaction or first play
  const getAudioContext = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close().catch(() => {});
        } catch (_) {}
        audioCtxRef.current = null;
      }
    };
  }, []);

  // Check rate limit (sliding window of 1 second)
  const canPlay = useCallback(
    (level) => {
      if (!enabled) return false;
      const now = performance.now();
      // Remove timestamps older than 1000ms
      playHistoryRef.current = playHistoryRef.current.filter((t) => now - t < 1000);

      // Mega Whale (Level 3) always punches through
      if (level >= 3) {
        playHistoryRef.current.push(now);
        return true;
      }

      if (playHistoryRef.current.length >= maxSoundsPerSec) {
        return false;
      }

      playHistoryRef.current.push(now);
      return true;
    },
    [enabled, maxSoundsPerSec]
  );

  /**
   * Level 1: Short high-pitch 'tick' or 'chime' (e.g. > $100k)
   */
  const playLevel1Chime = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(1900, now + 0.05);

      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.07);
    } catch (_) {}
  }, [getAudioContext]);

  /**
   * Level 2: Deeper, resonant 'pop' / woodblock (e.g. > $500k)
   */
  const playLevel2Pop = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.11);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(550, now);
      filter.Q.setValueAtTime(3.5, now);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch (_) {}
  }, [getAudioContext]);

  /**
   * Level 3: Heavy low-frequency 'boom' / sub-bass whale alarm (e.g. > $1M+)
   */
  const playLevel3Boom = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;

      // Sub-bass sweep oscillator
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.28);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      // Low pass to keep it thick and punchy
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(280, now);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    } catch (_) {}
  }, [getAudioContext]);

  /**
   * Evaluate a trade and play the appropriate alert sound if thresholds are met
   * @param {Object} trade - { usd, price, size, side }
   */
  const handleTradePrint = useCallback(
    (trade) => {
      if (!enabled || !trade || !trade.usd) return;
      const usd = trade.usd;

      if (usd >= thresholdL3) {
        if (canPlay(3)) playLevel3Boom();
      } else if (usd >= thresholdL2) {
        if (canPlay(2)) playLevel2Pop();
      } else if (usd >= thresholdL1) {
        if (canPlay(1)) playLevel1Chime();
      }
    },
    [enabled, thresholdL1, thresholdL2, thresholdL3, canPlay, playLevel1Chime, playLevel2Pop, playLevel3Boom]
  );

  /**
   * Manual trigger for testing in settings modal
   */
  const testSound = useCallback(
    (level) => {
      getAudioContext();
      if (level === 1) playLevel1Chime();
      else if (level === 2) playLevel2Pop();
      else if (level === 3) playLevel3Boom();
    },
    [getAudioContext, playLevel1Chime, playLevel2Pop, playLevel3Boom]
  );

  return {
    handleTradePrint,
    testSound,
    getAudioContext
  };
}
