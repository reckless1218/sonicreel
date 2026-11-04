/**
 * ============================================================================
 * SONICREEL — INTERACTIVE CINEMA SHOWREEL ENGINE (reel-player.js)
 * ============================================================================
 * Renders smooth 60fps widescreen showreel previews with Ken-Burns camera
 * motion, multi-shot chapter switching, Safari-compatible CSS LUT color-grade
 * comparison, synced Web Audio soundtrack toggle, and detached-DOM cleanup.
 * ============================================================================
 */
(function () {
  "use strict";

  const REEL_SCENES = {
    commercial: {
      shots: [
        {
          label: "Shot 01 • ARRI Tabletop Product Lighting",
          image: "assets/images/class-filmmaking.jpg",
          accent: "#f59e0b",
          specs: "ARRI Alexa Mini LF • 35mm T1.5 Prime • 120fps"
        },
        {
          label: "Shot 02 • Soundstage Gimbal Push",
          image: "assets/images/creator-video-1.jpg",
          accent: "#38bdf8",
          specs: "Aputure 600d Key • Warm Tungsten Rim • 24fps"
        },
        {
          label: "Shot 03 • Final Master & Ad Cutdowns",
          image: "assets/images/hero-studio.jpg",
          accent: "#fb7185",
          specs: "4K ProRes 422 HQ + 9:16 Paid Social Cutdowns"
        }
      ],
      audioPreset: "hiphop"
    },
    editing: {
      shots: [
        {
          label: "Shot 01 • DaVinci Film Print Grade",
          image: "assets/images/creator-video-2.jpg",
          accent: "#a855f7",
          specs: "Kodak 2383 Print LUT • Halation & Skin-Tone Isolate"
        },
        {
          label: "Shot 02 • 3-Sec Paid Social Hook Cut",
          image: "assets/images/creator-nadia-kouri.jpg",
          accent: "#f59e0b",
          specs: "Speed-Ramp J-Cut • Dynamic Captions • SFX Risers"
        },
        {
          label: "Shot 03 • Multi-Aspect Ad Delivery",
          image: "assets/images/hero-studio.jpg",
          accent: "#34d399",
          specs: "16:9 YouTube + 9:16 Reels/TikTok + 4:5 Meta Feed"
        }
      ],
      audioPreset: "synthwave"
    },
    motion3d: {
      shots: [
        {
          label: "Shot 01 • 3D Viewport & Shader Rig",
          image: "assets/images/creator-sora-takahashi.jpg",
          accent: "#38bdf8",
          specs: "Octane Path-Traced Lighting • 4K 60fps Motion"
        },
        {
          label: "Shot 02 • Sound-Synced Hardware Reveal",
          image: "assets/images/hero-studio.jpg",
          accent: "#f59e0b",
          specs: "Procedural Metal Reflections • Sub-Bass Impact"
        },
        {
          label: "Shot 03 • Final Color & Composite Suite",
          image: "assets/images/creator-video-2.jpg",
          accent: "#818cf8",
          specs: "Alpha Stinger Overlay + Broadcast Audio Mix"
        }
      ],
      audioPreset: "synthwave"
    },
    documentary: {
      shots: [
        {
          label: "Shot 01 • Handheld Gimbal Story Frame",
          image: "assets/images/creator-nadia-kouri.jpg",
          accent: "#f59e0b",
          specs: "Dual-Cam Cinema Gimbal • Vintage Prime Lenses"
        },
        {
          label: "Shot 02 • Intimate Studio Session B-Roll",
          image: "assets/images/creator-music-2.jpg",
          accent: "#fb923c",
          specs: "32-Bit Float Location Sound + Original Score"
        },
        {
          label: "Shot 03 • Soundstage Lighting & Atmosphere",
          image: "assets/images/creator-video-1.jpg",
          accent: "#38bdf8",
          specs: "FAA Drone Aerials + Theatrical Color Pass"
        }
      ],
      audioPreset: "cinematic"
    },
    audio_studio: {
      shots: [
        {
          label: "Session 01 • Analog Console & Vocal Chain",
          image: "assets/images/creator-sound-3.jpg",
          accent: "#f59e0b",
          specs: "24-Bit / 48kHz WAV • Warm Bus Compression • -14 LUFS"
        },
        {
          label: "Session 02 • Drum Pads, Synths & Arrangement",
          image: "assets/images/class-musicprod.jpg",
          accent: "#38bdf8",
          specs: "Multi-Track Stems + 15s / 30s Commercial Cutdowns"
        },
        {
          label: "Session 03 • Live Vocal & Sync Scoring Room",
          image: "assets/images/creator-music-1.jpg",
          accent: "#34d399",
          specs: "100% One-Stop Sync Cleared • Broadcast Ready"
        }
      ],
      audioPreset: "cinematic"
    }
  };

  class CinemaReelPlayer {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.rafId = null;
      this.isPlaying = false;
      this.isRawLog = false;
      this.soundEnabled = false;
      this.presetKey = "commercial";
      this.shotIndex = 0;
      this.startTime = 0;
      this.elapsedMs = 0;
      this.imageCache = new Map();
      this.onShotChange = null;
      this.loop = this.loop.bind(this);
    }

    attach(canvasEl, presetKey, onShotChange) {
      this.stop();
      this.canvas = canvasEl;
      this.ctx = canvasEl ? canvasEl.getContext("2d") : null;
      this.presetKey = REEL_SCENES[presetKey] ? presetKey : "commercial";
      this.shotIndex = 0;
      this.isRawLog = false;
      this.soundEnabled = false;
      this.elapsedMs = 0;
      this.isPlaying = true;
      this.startTime = performance.now();
      this.onShotChange = onShotChange || null;

      if (this.canvas) {
        this.canvas.style.filter = "saturate(1.14) contrast(1.06)";
      }

      this.preloadPreset(this.presetKey);
      this.rafId = requestAnimationFrame(this.loop);
    }

    preloadPreset(key) {
      const scene = REEL_SCENES[key] || REEL_SCENES.commercial;
      scene.shots.forEach((s) => {
        if (!this.imageCache.has(s.image)) {
          const img = new Image();
          img.src = s.image;
          this.imageCache.set(s.image, img);
        }
      });
    }

    getScene() {
      return REEL_SCENES[this.presetKey] || REEL_SCENES.commercial;
    }

    getShots() {
      return this.getScene().shots;
    }

    setShot(idx) {
      const shots = this.getShots();
      this.shotIndex = Math.max(0, Math.min(shots.length - 1, Number(idx) || 0));
      this.elapsedMs = this.shotIndex * 5000;
      this.startTime = performance.now() - this.elapsedMs;
      if (this.onShotChange) this.onShotChange(this.shotIndex, shots[this.shotIndex]);
    }

    togglePlay() {
      this.isPlaying = !this.isPlaying;
      if (this.isPlaying) {
        this.startTime = performance.now() - this.elapsedMs;
        if (this.soundEnabled && window.studioAudio) {
          window.studioAudio.resume().catch(() => {});
        }
      } else if (this.soundEnabled && window.studioAudio) {
        window.studioAudio.pause();
      }
      return this.isPlaying;
    }

    toggleColorGrade() {
      this.isRawLog = !this.isRawLog;
      if (this.canvas) {
        this.canvas.style.filter = this.isRawLog
          ? "saturate(0.36) contrast(0.82) brightness(1.06)"
          : "saturate(1.14) contrast(1.06)";
      }
      return this.isRawLog;
    }

    async toggleSound(reelTitle) {
      if (!window.studioAudio) return false;
      if (this.soundEnabled) {
        this.soundEnabled = false;
        window.studioAudio.stop();
        return false;
      }
      const scene = this.getScene();
      this.soundEnabled = true;
      const brand =
        (window.SITE_CONFIG && window.SITE_CONFIG.brandName) || "SonicReel";
      try {
        await window.studioAudio.playTrack({
          id: "__reel_preview__",
          name: brand + " Cinema Preview",
          role: "Synced Showreel Score",
          sampleTitle: reelTitle || "Showreel Studio Score",
          avatar: scene.shots[0].image,
          audioPreset: scene.audioPreset || "cinematic"
        });
        return true;
      } catch (_) {
        this.soundEnabled = false;
        return false;
      }
    }

    stop() {
      this.isPlaying = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.canvas) {
        this.canvas.style.filter = "none";
      }
      if (this.soundEnabled && window.studioAudio) {
        this.soundEnabled = false;
        window.studioAudio.stop();
      }
      this.canvas = null;
      this.ctx = null;
    }

    loop(now) {
      // Automatically stop 60fps loop if modal/canvas was closed or replaced
      if (!this.canvas || !this.ctx || !this.canvas.isConnected) {
        this.stop();
        return;
      }
      const shots = this.getShots();
      const totalCycleMs = shots.length * 5000;

      if (this.isPlaying) {
        this.elapsedMs = (now - this.startTime) % totalCycleMs;
        const nextShot = Math.floor(this.elapsedMs / 5000);
        if (nextShot !== this.shotIndex) {
          this.shotIndex = nextShot;
          if (this.onShotChange) this.onShotChange(this.shotIndex, shots[this.shotIndex]);
        }
      }

      this.renderFrame(shots[this.shotIndex], (this.elapsedMs % 5000) / 5000);
      this.rafId = requestAnimationFrame(this.loop);
    }

    renderFrame(shot, shotProgress) {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const ctx = this.ctx;

      ctx.save();
      ctx.fillStyle = "#07080c";
      ctx.fillRect(0, 0, w, h);

      const img = this.imageCache.get(shot.image);
      if (img && img.complete && img.naturalWidth > 0) {
        const scale = 1.04 + shotProgress * 0.1;
        const panX = (shotProgress - 0.5) * 28;
        const panY = (0.5 - shotProgress) * 14;

        const imgAspect = img.naturalWidth / img.naturalHeight;
        const canvasAspect = w / h;
        let drawW = w * scale;
        let drawH = h * scale;
        if (imgAspect > canvasAspect) {
          drawW = drawH * imgAspect;
        } else {
          drawH = drawW / imgAspect;
        }
        const dx = (w - drawW) / 2 + panX;
        const dy = (h - drawH) / 2 + panY;
        ctx.drawImage(img, dx, dy, drawW, drawH);
      }

      // Flat log milky lift overlay for unmistakable Raw Log visual feedback
      if (this.isRawLog) {
        ctx.fillStyle = "rgba(148, 156, 168, 0.18)";
        ctx.fillRect(0, 0, w, h);
      }

      // Anamorphic vignette & letterbox bars
      const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.72);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(5,6,10,0.68)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const barH = Math.round(h * 0.082);
      ctx.fillStyle = "#050609";
      ctx.fillRect(0, 0, w, barH);
      ctx.fillRect(0, h - barH, w, barH);

      if (!this.isRawLog) {
        const flareX = w * (0.2 + shotProgress * 0.6);
        const flare = ctx.createRadialGradient(flareX, barH + 30, 5, flareX, barH + 30, w * 0.35);
        flare.addColorStop(0, shot.accent + "30");
        flare.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = flare;
        ctx.fillRect(0, barH, w, h - barH * 2);
      }

      // Cinema HUD overlays inside letterbox bars
      ctx.font = "600 12px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const totalSec = Math.floor(this.elapsedMs / 1000);
      const frames = Math.floor((this.elapsedMs % 1000) / (1000 / 24));
      const tc =
        "TC 00:00:" +
        String(totalSec).padStart(2, "0") +
        ":" +
        String(frames).padStart(2, "0") +
        "  |  " +
        shot.label;
      ctx.fillText(tc, 20, barH - 13);

      ctx.fillStyle = this.isPlaying ? "#ef4444" : "#94a3b8";
      ctx.beginPath();
      ctx.arc(w - 172, barH - 17, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(
        this.isRawLog ? "FLAT LOG • BEFORE" : "FILM GRADE • AFTER",
        w - 160,
        barH - 13
      );

      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillText(shot.specs, 20, h - 14);

      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(0, h - barH - 2, w, 2);
      ctx.fillStyle = shot.accent;
      ctx.fillRect(0, h - barH - 2, w * shotProgress, 2);

      ctx.restore();
    }
  }

  window.cinemaReel = new CinemaReelPlayer();
})();
