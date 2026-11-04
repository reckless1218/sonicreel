/**
 * ============================================================================
 * SONICREEL — STUDIO WEB AUDIO SYNTHESIZER & ANALYZER (audio-engine.js)
 * ============================================================================
 * Generates multi-track studio arrangement previews directly in the browser
 * via Web Audio API. Hardened against rapid-click async races, iOS Safari
 * "interrupted" AudioContext states, and non-finite gain inputs.
 * ============================================================================
 */
(function () {
  "use strict";

  const PRESETS = {
    cinematic: {
      bpm: 84,
      durationSec: 32,
      chords: [
        [220.0, 261.63, 329.63, 392.0],  // Am7
        [174.61, 220.0, 261.63, 349.23], // Fmaj7
        [130.81, 196.0, 261.63, 329.63], // Cadd9
        [196.0, 246.94, 293.66, 392.0]   // G6
      ],
      melody: [523.25, 493.88, 440.0, 392.0, 440.0, 523.25, 659.25, 587.33],
      padType: "sawtooth",
      padCutoff: 950,
      hasDrums: true,
      drumStyle: "cinematic"
    },
    hiphop: {
      bpm: 94,
      durationSec: 28,
      chords: [
        [146.83, 174.61, 220.0, 261.63], // Dm7
        [116.54, 174.61, 220.0, 261.63], // Bbmaj7
        [130.81, 164.81, 196.0, 246.94], // Cmaj7
        [110.0, 138.59, 164.81, 220.0]   // A7
      ],
      melody: [587.33, 523.25, 440.0, 392.0, 440.0, 349.23, 392.0, 440.0],
      padType: "triangle",
      padCutoff: 1350,
      hasDrums: true,
      drumStyle: "trap"
    },
    acoustic: {
      bpm: 102,
      durationSec: 30,
      chords: [
        [196.0, 246.94, 293.66, 392.0],  // G
        [164.81, 196.0, 246.94, 329.63], // Em7
        [130.81, 196.0, 246.94, 329.63], // Cmaj7
        [146.83, 220.0, 293.66, 369.99]  // D
      ],
      melody: [392.0, 493.88, 587.33, 659.25, 587.33, 493.88, 440.0, 392.0],
      padType: "sine",
      padCutoff: 2400,
      hasDrums: true,
      drumStyle: "brush"
    },
    synthwave: {
      bpm: 112,
      durationSec: 34,
      chords: [
        [164.81, 196.0, 246.94, 329.63], // Em
        [130.81, 164.81, 196.0, 261.63], // C
        [196.0, 246.94, 293.66, 392.0],  // G
        [146.83, 185.0, 220.0, 293.66]   // D
      ],
      melody: [659.25, 587.33, 493.88, 392.0, 493.88, 587.33, 659.25, 783.99],
      padType: "sawtooth",
      padCutoff: 1650,
      hasDrums: true,
      drumStyle: "retro"
    }
  };

  class StudioAudioEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.analyser = null;
      this.isPlaying = false;
      this.currentTrack = null;
      this.volume = 0.8;
      this.isMuted = false;
      this.elapsedSec = 0;
      this.durationSec = 30;
      this.stepIndex = 0;
      this.schedulerTimer = null;
      this.progressTimer = null;
      this.activeNodes = new Set();
      this.listeners = new Set();
      this._opId = 0; // Sequence token preventing async resume() interval leaks
    }

    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    emit(eventType) {
      const state = this.getState();
      const type = eventType || "state";
      this.listeners.forEach((fn) => {
        try {
          fn(state, type);
        } catch (err) {
          console.error("Audio listener error:", err);
        }
      });
    }

    getState() {
      return {
        isPlaying: this.isPlaying,
        currentTrack: this.currentTrack,
        elapsedSec: this.elapsedSec,
        durationSec: this.durationSec,
        volume: this.volume,
        isMuted: this.isMuted
      };
    }

    ensureContext() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          throw new Error("Web Audio API is not supported in this browser.");
        }
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.isMuted ? 0 : this.volume;

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.8;

        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      }
      // Handles both "suspended" (desktop) and "interrupted" (iOS Safari lock/call)
      if (this.ctx.state !== "running") {
        return this.ctx.resume();
      }
      return Promise.resolve();
    }

    trackNode(node) {
      this.activeNodes.add(node);
      node.onended = () => this.activeNodes.delete(node);
    }

    stopAllNodes() {
      this.activeNodes.forEach((node) => {
        try {
          node.stop();
        } catch (_) {
          // Ignore already stopped nodes
        }
      });
      this.activeNodes.clear();
    }

    async toggleTrack(trackMeta) {
      if (!trackMeta) return;
      if (
        this.currentTrack &&
        this.currentTrack.id === trackMeta.id &&
        this.isPlaying
      ) {
        this.pause();
        return;
      }
      if (
        this.currentTrack &&
        this.currentTrack.id === trackMeta.id &&
        !this.isPlaying
      ) {
        await this.resume();
        return;
      }
      await this.playTrack(trackMeta);
    }

    async playTrack(trackMeta) {
      const opId = ++this._opId;
      this.isPlaying = false;
      this.stopTimers();
      this.stopAllNodes();

      await this.ensureContext();
      // Abort if another play/pause/stop occurred while ensureContext() was awaiting
      if (opId !== this._opId) return;

      const preset = PRESETS[trackMeta.audioPreset] || PRESETS.cinematic;
      this.currentTrack = trackMeta;
      this.durationSec = preset.durationSec;
      this.elapsedSec = 0;
      this.stepIndex = 0;
      this.isPlaying = true;
      this.startScheduler(preset);
      this.emit("track");
    }

    async resume() {
      if (!this.currentTrack) return;
      const opId = ++this._opId;
      this.stopTimers();
      this.stopAllNodes();

      await this.ensureContext();
      if (opId !== this._opId) return;

      const preset = PRESETS[this.currentTrack.audioPreset] || PRESETS.cinematic;
      this.isPlaying = true;
      this.startScheduler(preset);
      this.emit("playstate");
    }

    pause() {
      ++this._opId;
      this.isPlaying = false;
      this.stopTimers();
      this.stopAllNodes();
      this.emit("playstate");
    }

    stop() {
      ++this._opId;
      this.isPlaying = false;
      this.stopTimers();
      this.stopAllNodes();
      this.currentTrack = null;
      this.elapsedSec = 0;
      this.stepIndex = 0;
      this.emit("stop");
    }

    seekToFraction(fraction) {
      if (!this.currentTrack) return;
      const num = Number(fraction);
      if (!Number.isFinite(num)) return;
      const clamped = Math.max(0, Math.min(1, num));
      this.elapsedSec = clamped * this.durationSec;
      const preset = PRESETS[this.currentTrack.audioPreset] || PRESETS.cinematic;
      const stepDuration = 60 / preset.bpm / 2;
      this.stepIndex = Math.floor(this.elapsedSec / stepDuration);
      this.emit("tick");
    }

    setVolume(val) {
      const num = Number(val);
      if (!Number.isFinite(num)) return;
      this.volume = Math.max(0, Math.min(1, num));
      if (this.volume > 0 && this.isMuted) {
        this.isMuted = false;
      }
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(
          this.isMuted ? 0 : this.volume,
          this.ctx.currentTime,
          0.02
        );
      }
      this.emit("volume");
    }

    toggleMute() {
      this.isMuted = !this.isMuted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(
          this.isMuted ? 0 : this.volume,
          this.ctx.currentTime,
          0.02
        );
      }
      this.emit("volume");
    }

    stopTimers() {
      if (this.schedulerTimer) {
        clearInterval(this.schedulerTimer);
        this.schedulerTimer = null;
      }
      if (this.progressTimer) {
        clearInterval(this.progressTimer);
        this.progressTimer = null;
      }
    }

    startScheduler(preset) {
      // Defensive clear so overlapping intervals are structurally impossible
      this.stopTimers();

      const eighthNoteMs = (60 / preset.bpm / 2) * 1000;
      this.triggerStep(preset, this.stepIndex);
      this.stepIndex += 1;

      this.schedulerTimer = setInterval(() => {
        if (!this.isPlaying || !this.ctx) return;
        this.triggerStep(preset, this.stepIndex);
        this.stepIndex += 1;
      }, eighthNoteMs);

      this.progressTimer = setInterval(() => {
        if (!this.isPlaying) return;
        this.elapsedSec += 0.1;
        if (this.elapsedSec >= this.durationSec) {
          this.elapsedSec = 0;
          this.stepIndex = 0;
        }
        this.emit("tick");
      }, 100);
    }

    triggerStep(preset, step) {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const stepInBar = step % 8;
      const chordIdx = Math.floor(step / 8) % preset.chords.length;
      const chord = preset.chords[chordIdx];
      const barDur = (60 / preset.bpm) * 4;

      if (preset.drumStyle === "brush") {
        // Acoustic fingerpicked guitar & warm upright bass pattern
        if (stepInBar === 0 || stepInBar === 4) {
          this.playSubBass(chord[0] / 2, now, barDur * 0.45);
        }
        const arpNote = chord[stepInBar % chord.length];
        this.playAcousticPluck(arpNote * (stepInBar === 6 ? 2 : 1), now, 0.55, 0.13);
        if (stepInBar === 2 || stepInBar === 6) {
          this.playHat(now, 0.03);
        }
        return;
      }

      if (stepInBar === 0) {
        this.playChordPad(chord, now, barDur * 0.96, preset.padType, preset.padCutoff);
        this.playSubBass(chord[0] / 2, now, barDur * 0.92);
      }

      if (stepInBar % 2 === 0) {
        const noteFreq = preset.melody[step % preset.melody.length];
        this.playPluck(noteFreq, now, 0.35, preset.drumStyle === "cinematic" ? 0.09 : 0.12);
      }

      if (preset.hasDrums) {
        if (preset.drumStyle === "trap") {
          if (stepInBar === 0 || stepInBar === 5) this.playKick(now, 0.42);
          if (stepInBar === 4) this.playSnare(now, 0.22);
          this.playHat(now, stepInBar % 2 === 0 ? 0.07 : 0.04);
        } else if (preset.drumStyle === "retro") {
          if (stepInBar === 0 || stepInBar === 4) this.playKick(now, 0.38);
          if (stepInBar === 2 || stepInBar === 6) this.playSubBass(chord[0] / 2, now, 0.22);
          if (stepInBar === 4) this.playSnare(now, 0.2);
          this.playHat(now, 0.05);
        } else if (preset.drumStyle === "cinematic") {
          if (stepInBar === 0 || stepInBar === 6) this.playKick(now, 0.28);
        }
      }
    }

    playAcousticPluck(freq, time, duration, peakGain) {
      // Warm acoustic string harmonic pair (fundamental + octave overtone)
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(3400, time);
      filter.frequency.exponentialRampToValueAtTime(750, time + duration);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.001, time);
      env.gain.linearRampToValueAtTime(peakGain, time + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, time + duration);

      filter.connect(env);
      env.connect(this.masterGain);

      [1, 2].forEach((mult, idx) => {
        const osc = this.ctx.createOscillator();
        osc.type = idx === 0 ? "triangle" : "sine";
        osc.frequency.setValueAtTime(freq * mult, time);
        const subGain = this.ctx.createGain();
        subGain.gain.value = idx === 0 ? 0.8 : 0.25;
        osc.connect(subGain);
        subGain.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.04);
        this.trackNode(osc);
      });
    }

    playChordPad(freqs, time, duration, waveType, cutoff) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff * 0.6, time);
      filter.frequency.exponentialRampToValueAtTime(cutoff, time + duration * 0.45);
      filter.frequency.exponentialRampToValueAtTime(cutoff * 0.5, time + duration);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.001, time);
      env.gain.linearRampToValueAtTime(0.11, time + 0.18);
      env.gain.exponentialRampToValueAtTime(0.001, time + duration);

      filter.connect(env);
      env.connect(this.masterGain);

      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        osc.type = waveType;
        osc.frequency.setValueAtTime(f, time);
        osc.detune.setValueAtTime((idx - 1.5) * 5, time);
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
        this.trackNode(osc);
      });
    }

    playSubBass(freq, time, duration) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);

      env.gain.setValueAtTime(0.001, time);
      env.gain.linearRampToValueAtTime(0.24, time + 0.04);
      env.gain.exponentialRampToValueAtTime(0.001, time + duration);

      osc.connect(env);
      env.connect(this.masterGain);
      osc.start(time);
      osc.stop(time + duration + 0.04);
      this.trackNode(osc);
    }

    playPluck(freq, time, duration, peakGain) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const env = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, time);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2600, time);
      filter.frequency.exponentialRampToValueAtTime(600, time + duration);

      env.gain.setValueAtTime(0.001, time);
      env.gain.linearRampToValueAtTime(peakGain, time + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, time + duration);

      osc.connect(filter);
      filter.connect(env);
      env.connect(this.masterGain);

      osc.start(time);
      osc.stop(time + duration + 0.03);
      this.trackNode(osc);
    }

    playKick(time, gainAmount) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(135, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);

      env.gain.setValueAtTime(gainAmount, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.26);

      osc.connect(env);
      env.connect(this.masterGain);
      osc.start(time);
      osc.stop(time + 0.28);
      this.trackNode(osc);
    }

    playSnare(time, gainAmount) {
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.14);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1800, time);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(gainAmount, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

      noise.connect(filter);
      filter.connect(env);
      env.connect(this.masterGain);
      noise.start(time);
      noise.stop(time + 0.15);
      this.trackNode(noise);
    }

    playHat(time, gainAmount) {
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.05);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(6500, time);

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(gainAmount, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

      noise.connect(filter);
      filter.connect(env);
      env.connect(this.masterGain);
      noise.start(time);
      noise.stop(time + 0.06);
      this.trackNode(noise);
    }

    getFrequencyData(targetArray) {
      if (!this.analyser || !this.isPlaying) {
        targetArray.fill(8);
        return targetArray;
      }
      this.analyser.getByteFrequencyData(targetArray);
      return targetArray;
    }
  }

  window.studioAudio = new StudioAudioEngine();
})();
