/**
 * ============================================================================
 * SONICREEL — MAIN INTERACTIVE APPLICATION (app.js)
 * ============================================================================
 */
(function () {
  "use strict";

  const CFG = window.SITE_CONFIG || {};
  const DATA = window.SONICREEL_DATA || {
    creators: [],
    classes: [],
    openBriefs: [],
    sponsors: {},
    testimonials: []
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const safeStore = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed != null ? parsed : fallback;
      } catch (_) {
        return fallback;
      }
    },
    set(key, val) {
      try {
        window.localStorage.setItem(key, JSON.stringify(val));
      } catch (_) {
        // Ignore private-browsing or quota errors
      }
    }
  };

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return mins + ":" + String(rem).padStart(2, "0");
  }

  // Capture paid-ad UTM & click IDs on landing
  function captureAttribution() {
    try {
      const params = new URLSearchParams(window.location.search);
      const keys = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "fbclid",
        "ttclid",
        "gclid"
      ];
      const attr = {};
      keys.forEach((k) => {
        const v = params.get(k);
        if (v) attr[k] = v;
      });
      return attr;
    } catch (_) {
      return {};
    }
  }

  // Sanitize persisted localStorage arrays against corrupted/null entries
  const rawBriefs = safeStore.get("sonicreel_custom_briefs_v1", []);
  const sanitizedBriefs = Array.isArray(rawBriefs)
    ? rawBriefs.filter(
        (b) =>
          b &&
          typeof b === "object" &&
          typeof b.id === "string" &&
          typeof b.title === "string" &&
          b.title.trim().length > 0 &&
          typeof b.description === "string"
      )
    : [];

  const rawSent = safeStore.get("sonicreel_sent_proposals_v1", []);
  const sanitizedSent = Array.isArray(rawSent)
    ? rawSent.filter((id) => typeof id === "string")
    : [];

  const state = {
    creatorCategory: "all",
    creatorUseCase: "all",
    creatorSearch: "",
    creatorSort: "featured",
    briefFilter: "all",
    classCategory: "all",
    proBilling: "monthly",
    customBriefs: sanitizedBriefs,
    sentProposals: new Set(sanitizedSent),
    attribution: captureAttribution(),
    lastFocusedEl: null,
    spectrumRaf: null,
    isDraggingScrubber: false,
    backdropMouseDown: false
  };

  // Optional Paid-Ad Pixel Initialization & Lead Conversion Tracking
  function initAdPixels() {
    const px = CFG.pixels || {};
    const gtagId = String(px.gtagId || "").trim();
    const metaId = String(px.metaPixelId || "").trim();
    const tiktokId = String(px.tiktokPixelId || "").trim();

    if (gtagId && !document.getElementById("pixel-gtag-script")) {
      const s = document.createElement("script");
      s.id = "pixel-gtag-script";
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gtagId);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag =
        window.gtag ||
        function () {
          window.dataLayer.push(arguments);
        };
      window.gtag("js", new Date());
      window.gtag("config", gtagId);
    }

    if (metaId && !window.fbq) {
      const f = function () {
        if (f.callMethod) f.callMethod.apply(f, arguments);
        else f.queue.push(arguments);
      };
      f.push = f;
      f.loaded = true;
      f.version = "2.0";
      f.queue = [];
      window.fbq = f;
      const s = document.createElement("script");
      s.id = "pixel-meta-script";
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(s);
      window.fbq("init", metaId);
      window.fbq("track", "PageView");
    }

    if (tiktokId && !window.ttq) {
      window.TiktokAnalyticsObject = "ttq";
      const ttq = (window.ttq = window.ttq || []);
      ttq.methods = ["page", "track", "identify", "instances", "load"];
      ttq.setAndDefer = function (t, e) {
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (let i = 0; i < ttq.methods.length; i++) {
        ttq.setAndDefer(ttq, ttq.methods[i]);
      }
      const s = document.createElement("script");
      s.id = "pixel-tiktok-script";
      s.async = true;
      s.src =
        "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=" +
        encodeURIComponent(tiktokId) +
        "&lib=ttq";
      document.head.appendChild(s);
      ttq.page();
    }
  }

  function trackAdConversion(formType) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "generate_lead", { event_category: formType });
      }
      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { content_name: formType });
      }
      if (window.ttq && typeof window.ttq.track === "function") {
        window.ttq.track("SubmitForm", { content_name: formType });
      }
    } catch (_) {}
  }

  function computeAllAccessSavings() {
    const passPrice = (CFG.pricing && CFG.pricing.allAccessPassYearly) || 199;
    const coursesTotal = (DATA.classes || [])
      .filter((cl) => !cl.isCoaching)
      .reduce((sum, cl) => sum + (Number(cl.price) || 0), 0);
    return Math.max(40, coursesTotal - passPrice);
  }

  async function deliverLead(formType, payload) {
    const entry = {
      formType,
      submittedAt: new Date().toISOString(),
      attribution: state.attribution,
      ...payload
    };
    const saved = safeStore.get("sonicreel_leads_v1", []);
    const list = Array.isArray(saved)
      ? saved.filter((x) => x && typeof x === "object")
      : [];
    list.unshift(entry);
    safeStore.set("sonicreel_leads_v1", list.slice(0, 50));
    trackAdConversion(formType);

    const endpoint = String(CFG.formEndpointUrl || "").trim();
    if (endpoint && /^https?:\/\//i.test(endpoint)) {
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(entry)
        });
      } catch (err) {
        console.warn("Remote form endpoint unreachable; lead stored locally.", err);
      }
    }
  }

  function showToast(message) {
    const stack = document.getElementById("toast-stack");
    if (!stack) return;
    const item = document.createElement("div");
    item.className = "toast-msg";
    item.setAttribute("role", "status");
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 4800);
  }

  function validateTrimmedForm(formEl, requiredFieldNames) {
    const fd = new FormData(formEl);
    for (let i = 0; i < requiredFieldNames.length; i++) {
      const name = requiredFieldNames[i];
      const val = String(fd.get(name) || "").trim();
      if (!val) {
        const input = formEl.querySelector('[name="' + name + '"]');
        if (input) input.focus();
        showToast("Please fill out all required fields (spaces alone aren't valid).");
        return null;
      }
    }
    return fd;
  }

  // ==========================================================================
  // BRANDING, PRICING & SOCIAL HYDRATION FROM CONFIG.JS
  // ==========================================================================
  function hydrateBranding() {
    const brandName = CFG.brandName || "SonicReel";
    const tagline =
      CFG.brandTagline || "Custom Music, Commercial Video & Studio Masterclasses";
    const feePct =
      CFG.pricing && Number.isFinite(Number(CFG.pricing.marketplaceFeePercent))
        ? Number(CFG.pricing.marketplaceFeePercent)
        : 10;
    const keepPct = Math.max(0, 100 - feePct);

    document.title = brandName + " — " + tagline;

    if (CFG.domainUrl && /^https?:\/\//i.test(CFG.domainUrl)) {
      const cleanDomain = CFG.domainUrl.replace(/\/+$/, "") + "/";
      const canon = document.querySelector('link[rel="canonical"]');
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (canon) canon.setAttribute("href", cleanDomain);
      if (ogUrl) ogUrl.setAttribute("content", cleanDomain);
    }

    document.querySelectorAll("[data-brand-name]").forEach((el) => {
      el.textContent = brandName;
    });
    document.querySelectorAll("[data-support-city]").forEach((el) => {
      el.textContent = CFG.supportCity || "Remote Worldwide";
    });
    document.querySelectorAll("[data-founded-year]").forEach((el) => {
      el.textContent = String(CFG.foundedYear || 2026);
    });
    document.querySelectorAll("[data-contact-email]").forEach((el) => {
      const email = CFG.contactEmail || "hello@sonicreel.studio";
      el.textContent = email;
      if (el.tagName === "A") {
        el.setAttribute("href", "mailto:" + email);
      }
    });

    document.querySelectorAll("[data-fee-percent]").forEach((el) => {
      el.textContent = feePct + "%";
    });
    document.querySelectorAll("[data-keep-percent]").forEach((el) => {
      el.textContent = keepPct + "%";
    });

    const prosTabEl = document.getElementById("all-pros-tab-count");
    if (prosTabEl) {
      prosTabEl.textContent = "All Pros (" + (DATA.creators || []).length + ")";
    }
    const classesTabEl = document.getElementById("all-classes-tab-count");
    if (classesTabEl) {
      classesTabEl.textContent = "All Classes (" + (DATA.classes || []).length + ")";
    }

    const passPriceEl = document.getElementById("all-access-price");
    if (passPriceEl) {
      const passPrice = (CFG.pricing && CFG.pricing.allAccessPassYearly) || 199;
      passPriceEl.textContent = "$" + passPrice;
    }
    const savingsBadgeEl = document.getElementById("all-access-savings-badge");
    if (savingsBadgeEl) {
      savingsBadgeEl.textContent = "Best Value • Save $" + computeAllAccessSavings();
    }

    const socialMount = document.getElementById("footer-social-links");
    if (socialMount && CFG.social) {
      const entries = Object.entries(CFG.social).filter(
        ([, url]) => typeof url === "string" && /^https?:\/\//i.test(url)
      );
      socialMount.innerHTML = entries
        .map(
          ([network, url]) =>
            '<a href="' +
            escapeHtml(url) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(network.charAt(0).toUpperCase() + network.slice(1)) +
            " ↗</a>"
        )
        .join("");
    }

    updateCreatorPricingDisplay();
  }

  function updateCreatorPricingDisplay() {
    const proPriceEl = document.getElementById("price-pro-monthly");
    const proSubEl = document.getElementById("price-pro-subnote");
    const agencyPriceEl = document.getElementById("price-agency-monthly");

    const monthly = (CFG.pricing && CFG.pricing.creatorProMonthly) || 19;
    const annualMo = (CFG.pricing && CFG.pricing.creatorProAnnualMonthly) || 15;
    const agencyMo = (CFG.pricing && CFG.pricing.studioAgencyMonthly) || 49;

    if (proPriceEl) {
      proPriceEl.textContent =
        "$" + (state.proBilling === "annual" ? annualMo : monthly);
    }
    if (proSubEl) {
      proSubEl.textContent =
        state.proBilling === "annual"
          ? "Billed $" + annualMo * 12 + "/yr (2 months free) • Pays for itself on 1 gig"
          : "Founding monthly rate • Pays for itself on one $190 gig";
    }
    if (agencyPriceEl) {
      agencyPriceEl.textContent =
        "$" + (state.proBilling === "annual" ? Math.round(agencyMo * 0.8) : agencyMo);
    }
  }

  // ==========================================================================
  // ADSENSE / NATIVE SPONSOR RENDERING (STRICT POLICY COMPLIANCE)
  // ==========================================================================
  function ensureAdSenseScript(pubId) {
    if (!pubId || document.getElementById("adsense-sdk-script")) return;
    const s = document.createElement("script");
    s.id = "adsense-sdk-script";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(pubId);
    document.head.appendChild(s);
  }

  function renderAdSlots() {
    const adCfg = CFG.ads || {};
    const leaderMount = document.getElementById("ad-slot-leaderboard");
    if (!leaderMount) return;

    if (adCfg.mode === "adsense" && adCfg.adsensePublisherId) {
      ensureAdSenseScript(adCfg.adsensePublisherId);
      const slotId = String(adCfg.adsenseLeaderboardSlotId || "").trim();
      if (!slotId) {
        // Auto Ads mode: script is active, hide manual empty box cleanly
        leaderMount.innerHTML = "";
        return;
      }
      // Strict Google AdSense compliance: ONLY "Advertisement" label, zero extra buttons inside ad frame
      leaderMount.innerHTML =
        '<div class="ad-unit-box" role="complementary" aria-label="Advertisement">' +
        '  <div class="ad-disclosure-row"><span>Advertisement</span></div>' +
        '  <ins class="adsbygoogle" style="display:block" data-ad-client="' +
        escapeHtml(adCfg.adsensePublisherId) +
        '" data-ad-slot="' +
        escapeHtml(slotId) +
        '" data-ad-format="auto" data-full-width-responsive="true"></ins>' +
        "</div>";
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (_) {}
      return;
    }

    const brandName = CFG.brandName || "SonicReel";
    const sp = (DATA.sponsors && DATA.sponsors.leaderboard) || {
      id: "aurasound",
      sponsorName: "Studio Partner",
      headline: "Reach 10,000+ Music Producers, Filmmakers & Growing Brands",
      subtext: "Book a featured partner banner on " + brandName + " starting at $99/week.",
      ctaText: "Claim Partner Perk",
      tag: "SPONSORED STUDIO PARTNER"
    };
    const rate = (adCfg.rates && adCfg.rates.nativeCardWeekly) || 99;

    leaderMount.innerHTML =
      '<div class="ad-unit-box" role="complementary" aria-label="Sponsored Partner">' +
      '  <div class="ad-disclosure-row">' +
      "    <span>" +
      escapeHtml(sp.tag) +
      " • " +
      escapeHtml(sp.sponsorName) +
      "</span>" +
      '    <button type="button" class="ad-promote-trigger" data-action="open-advertise">Sponsor ' +
      escapeHtml(brandName) +
      " (From $" +
      escapeHtml(rate) +
      "/wk)</button>" +
      "  </div>" +
      '  <div class="ad-leaderboard-body">' +
      '    <div class="ad-copy">' +
      "      <h3>" +
      escapeHtml(sp.headline) +
      "</h3>" +
      "      <p>" +
      escapeHtml(sp.subtext) +
      "</p>" +
      "    </div>" +
      '    <button type="button" class="btn btn-secondary btn-sm" data-action="partner-offer" data-sponsor-key="leaderboard">' +
      escapeHtml(sp.ctaText) +
      " →</button>" +
      "  </div>" +
      "</div>";
  }

  // ==========================================================================
  // CREATOR MARKETPLACE RENDERING & FILTERING
  // ==========================================================================
  function getFilteredCreators() {
    const q = state.creatorSearch.trim().toLowerCase();
    const list = DATA.creators.filter((c) => {
      if (state.creatorCategory !== "all" && c.category !== state.creatorCategory) {
        return false;
      }
      if (
        state.creatorUseCase !== "all" &&
        (!Array.isArray(c.useCases) || !c.useCases.includes(state.creatorUseCase))
      ) {
        return false;
      }
      if (q) {
        const hay = [
          c.name,
          c.role,
          c.location,
          c.bio,
          c.sampleTitle,
          ...(c.tags || [])
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (state.creatorSort === "price-asc") {
      list.sort((a, b) => a.startingPrice - b.startingPrice);
    } else {
      list.sort((a, b) => Number(b.featured) - Number(a.featured));
    }
    return list;
  }

  function buildInFeedAdCardHtml() {
    const adCfg = CFG.ads || {};
    if (adCfg.mode === "adsense" && adCfg.adsensePublisherId) {
      const slotId = String(adCfg.adsenseInFeedSlotId || "").trim();
      if (!slotId) return "";
      ensureAdSenseScript(adCfg.adsensePublisherId);
      return (
        '<aside class="creator-card" role="complementary" aria-label="Advertisement">' +
        '  <div class="card-body">' +
        '    <div class="ad-disclosure-row"><span>Advertisement</span></div>' +
        '    <ins class="adsbygoogle" style="display:block" data-ad-format="fluid" data-ad-client="' +
        escapeHtml(adCfg.adsensePublisherId) +
        '" data-ad-slot="' +
        escapeHtml(slotId) +
        '"></ins>' +
        "  </div>" +
        "</aside>"
      );
    }

    if (!DATA.sponsors || !DATA.sponsors.inFeed) return "";
    const inf = DATA.sponsors.inFeed;
    return (
      '<aside class="creator-card" style="background:linear-gradient(165deg,#151929 0%,#1c1724 100%);border-color:rgba(167,139,250,0.32);" aria-label="Sponsored Gear Partner">' +
      '  <div class="card-body" style="justify-content:space-between;">' +
      "    <div>" +
      '      <div class="ad-disclosure-row" style="margin-bottom:14px;">' +
      "        <span>" +
      escapeHtml(inf.tag) +
      "</span>" +
      '        <button type="button" class="ad-promote-trigger" data-action="open-advertise">Book Ad Slot</button>' +
      "      </div>" +
      '      <p class="creator-role" style="color:var(--violet);">' +
      escapeHtml(inf.sponsorName) +
      "</p>" +
      '      <h3 class="creator-name" style="font-size:1.25rem;margin-bottom:10px;">' +
      escapeHtml(inf.headline) +
      "</h3>" +
      '      <p class="creator-bio">' +
      escapeHtml(inf.subtext) +
      "</p>" +
      "    </div>" +
      '    <div class="card-footer-row">' +
      '      <span style="font-size:0.78rem;color:var(--text-muted);">Code: <strong>' +
      escapeHtml(inf.promoCode || "PARTNER") +
      "</strong></span>" +
      '      <button type="button" class="btn btn-secondary btn-sm" data-action="partner-offer" data-sponsor-key="inFeed">' +
      escapeHtml(inf.ctaText) +
      "</button>" +
      "    </div>" +
      "  </div>" +
      "</aside>"
    );
  }

  function renderCreators() {
    const grid = document.getElementById("creators-grid");
    const countEl = document.getElementById("creators-results-count");
    if (!grid) return;

    const audioState = window.studioAudio ? window.studioAudio.getState() : {};
    const filtered = getFilteredCreators();

    if (countEl) {
      countEl.textContent =
        "Showing " +
        filtered.length +
        " verified " +
        (filtered.length === 1 ? "creator" : "creators") +
        " • $0 buyer fee";
    }

    if (filtered.length === 0) {
      grid.innerHTML =
        '<div class="empty-state-box">' +
        "  <h3>No creators match that exact search yet</h3>" +
        '  <p style="color:var(--text-secondary);margin-bottom:18px;">Reset your filters to browse all 9 verified music producers, filmmakers, and editors—or post a custom brief for free.</p>' +
        '  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
        '    <button type="button" class="btn btn-secondary btn-sm" data-action="reset-creator-filters">Reset All Filters</button>' +
        '    <button type="button" class="btn btn-primary btn-sm" data-action="open-post-brief">Post Custom Project Free</button>' +
        "  </div>" +
        "</div>";
      return;
    }

    const cardsHtml = [];
    const inFeedHtml = buildInFeedAdCardHtml();
    const insertSponsorAfterIdx = Math.min(2, filtered.length - 1);

    filtered.forEach((c, index) => {
      const isThisAudioPlaying =
        c.mediaType === "audio" &&
        audioState.isPlaying &&
        audioState.currentTrack &&
        audioState.currentTrack.id === c.id;

      const sampleAction = c.mediaType === "audio" ? "play-creator-audio" : "watch-creator-reel";
      const playIcon =
        c.mediaType === "audio" ? (isThisAudioPlaying ? "❚❚" : "▶") : "🎬";
      const sampleHint =
        c.mediaType === "audio"
          ? isThisAudioPlaying
            ? "Playing in Studio Dock • Click to pause"
            : "Interactive Studio Synth Preview • " + escapeHtml(c.sampleDuration)
          : "Watch 4K Showreel + Audio • " + escapeHtml(c.sampleDuration);

      cardsHtml.push(
        '<article class="creator-card ' +
          (c.featured ? "is-featured" : "") +
          '">' +
          '  <div class="card-media">' +
          '    <img src="' +
          escapeHtml(c.avatar) +
          '" alt="' +
          escapeHtml(c.name + " — " + c.role) +
          '" loading="lazy" width="480" height="300">' +
          '    <div class="card-badges-top">' +
          (c.featured
            ? '<span class="badge-promoted">★ Featured Pro</span>'
            : "<span></span>") +
          '      <span class="badge-specialty">' +
          escapeHtml(c.badge) +
          "</span>" +
          "    </div>" +
          '    <button type="button" class="sample-trigger-bar ' +
          (isThisAudioPlaying ? "is-playing" : "") +
          '" data-action="' +
          sampleAction +
          '" data-creator-id="' +
          escapeHtml(c.id) +
          '" data-duration="' +
          escapeHtml(c.sampleDuration) +
          '">' +
          '      <span class="play-circle" aria-hidden="true">' +
          playIcon +
          "</span>" +
          '      <span class="sample-text">' +
          "        <strong>" +
          escapeHtml(c.sampleTitle) +
          "</strong>" +
          '        <span class="sample-subhint">' +
          sampleHint +
          "</span>" +
          "      </span>" +
          "    </button>" +
          "  </div>" +
          '  <div class="card-body">' +
          '    <div class="creator-header-row">' +
          '      <h3 class="creator-name">' +
          escapeHtml(c.name) +
          (c.verified
            ? '<span class="verified-check" title="Identity & Portfolio Verified">✓</span>'
            : "") +
          "</h3>" +
          "    </div>" +
          '    <p class="creator-role">' +
          escapeHtml(c.role) +
          "</p>" +
          '    <p class="creator-loc">📍 ' +
          escapeHtml(c.location) +
          " • Turnaround: " +
          escapeHtml(c.turnaround) +
          "</p>" +
          '    <p class="creator-bio">' +
          escapeHtml(c.bio) +
          "</p>" +
          '    <div class="tag-list">' +
          (c.tags || [])
            .map((t) => '<span class="tag-chip">' + escapeHtml(t) + "</span>")
            .join("") +
          "    </div>" +
          '    <div class="deliverables-mini"><strong>Includes:</strong> ' +
          escapeHtml((c.deliverables || []).join(" • ")) +
          "</div>" +
          '    <div class="card-footer-row">' +
          '      <div class="price-stack">' +
          "        <span>Packages from</span>" +
          "        <strong>$" +
          escapeHtml(c.startingPrice) +
          "</strong>" +
          "      </div>" +
          '      <button type="button" class="btn btn-primary btn-sm" data-action="open-hire-creator" data-creator-id="' +
          escapeHtml(c.id) +
          '">Hire / Quote</button>' +
          "    </div>" +
          "  </div>" +
          "</article>"
      );

      if (index === insertSponsorAfterIdx && !state.creatorSearch && inFeedHtml) {
        cardsHtml.push(inFeedHtml);
      }
    });

    // Concierge custom brief card when filtered category has < 3 creators so grid stays balanced
    if (filtered.length < 3) {
      cardsHtml.push(
        '<article class="creator-card" style="border-style:dashed;border-color:var(--border-accent);background:rgba(245,158,11,0.04);">' +
          '  <div class="card-body" style="justify-content:space-between;">' +
          "    <div>" +
          '      <span class="pathway-kicker">Custom Studio Match</span>' +
          '      <h3 class="creator-name" style="margin:8px 0 10px;">Need a Custom Music + Video Team?</h3>' +
          '      <p class="creator-bio">Post your exact vibe, deadline, and budget for $0—we will match you with 3 vetted specialists within 24 hours.</p>' +
          "    </div>" +
          '    <button type="button" class="btn btn-primary btn-sm" data-action="open-post-brief">Post Free Brief →</button>' +
          "  </div>" +
          "</article>"
      );
    }

    grid.innerHTML = cardsHtml.join("");

    if (CFG.ads && CFG.ads.mode === "adsense" && CFG.ads.adsenseInFeedSlotId) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (_) {}
    }
  }

  // Surgical in-place DOM update for audio play buttons — ZERO innerHTML rebuilds!
  function syncCreatorAudioButtons(audioState) {
    document
      .querySelectorAll('.sample-trigger-bar[data-action="play-creator-audio"]')
      .forEach((btn) => {
        const id = btn.getAttribute("data-creator-id");
        const dur = btn.getAttribute("data-duration") || "0:30";
        const active =
          Boolean(audioState.isPlaying) &&
          Boolean(audioState.currentTrack) &&
          audioState.currentTrack.id === id;

        btn.classList.toggle("is-playing", active);
        const iconEl = btn.querySelector(".play-circle");
        if (iconEl) iconEl.textContent = active ? "❚❚" : "▶";
        const subEl = btn.querySelector(".sample-subhint");
        if (subEl) {
          subEl.textContent = active
            ? "Playing in Studio Dock • Click to pause"
            : "Interactive Studio Synth Preview • " + dur;
        }
      });
  }

  // ==========================================================================
  // OPEN CLIENT BRIEFS (LIVE JOB BOARD WITH FILTERS, DELETE & PITCH TRACKING)
  // ==========================================================================
  function renderBriefs() {
    const mount = document.getElementById("briefs-grid");
    if (!mount) return;

    const combined = [
      ...state.customBriefs.map((b) => ({ ...b, isCustom: true })),
      ...(DATA.openBriefs || [])
    ].filter((b) => {
      if (state.briefFilter === "all") return true;
      if (b.filterKey) return b.filterKey === state.briefFilter;
      const cat = String(b.category || "").toLowerCase();
      if (state.briefFilter === "bundle") return cat.includes("bundle");
      if (state.briefFilter === "music") return cat.includes("music") || cat.includes("audio");
      if (state.briefFilter === "video") return cat.includes("video") || cat.includes("edit");
      return true;
    });

    mount.innerHTML = combined
      .map((b) => {
        const alreadySent = state.sentProposals.has(b.id);
        const baseCount = Number(b.proposalsCount) || 0;
        const displayCount = baseCount + (alreadySent ? 1 : 0);

        return (
          '<article class="brief-card">' +
          "  <div>" +
          '    <div class="brief-top">' +
          '      <span class="brief-cat">' +
          escapeHtml(b.category) +
          "</span>" +
          '      <span class="brief-budget">Budget: ' +
          escapeHtml(b.budget) +
          "</span>" +
          "    </div>" +
          "    <h3>" +
          escapeHtml(b.title) +
          "</h3>" +
          "    <p>" +
          escapeHtml(b.description) +
          "</p>" +
          '    <span class="brief-verified">' +
          escapeHtml(b.clientType || (b.isCustom ? "Posted by You • Open Brief" : "✓ Verified Payment")) +
          "</span>" +
          "  </div>" +
          '  <div class="brief-meta-row">' +
          "    <span><strong>" +
          escapeHtml(b.clientName) +
          "</strong> • " +
          escapeHtml(b.deadline) +
          " • " +
          escapeHtml(b.postedAgo || "Just now") +
          "</span>" +
          '    <div style="display:flex;gap:8px;align-items:center;">' +
          (b.isCustom
            ? '<button type="button" class="btn btn-ghost btn-sm" data-action="delete-custom-brief" data-brief-id="' +
              escapeHtml(b.id) +
              '">Remove My Brief</button>'
            : "") +
          '      <button type="button" class="btn ' +
          (alreadySent ? "btn-ghost" : "btn-secondary") +
          ' btn-sm" data-action="open-pitch-brief" data-brief-id="' +
          escapeHtml(b.id) +
          '">' +
          (alreadySent
            ? "✓ Proposal Sent (" + escapeHtml(displayCount) + ")"
            : "Send Proposal (" + escapeHtml(displayCount) + ")") +
          "</button>" +
          "    </div>" +
          "  </div>" +
          "</article>"
        );
      })
      .join("");
  }

  // ==========================================================================
  // MASTERCLASSES & COACHING ACADEMY
  // ==========================================================================
  function renderClasses() {
    const grid = document.getElementById("classes-grid");
    if (!grid) return;

    const list = (DATA.classes || []).filter((cl) => {
      if (state.classCategory === "all") return true;
      return cl.category === state.classCategory;
    });

    grid.innerHTML = list
      .map(
        (cl) =>
          '<article class="class-card">' +
          '  <div class="class-thumb">' +
          '    <img src="' +
          escapeHtml(cl.thumbnail) +
          '" alt="' +
          escapeHtml(cl.title) +
          '" loading="lazy" width="480" height="270">' +
          '    <div class="card-badges-top">' +
          '      <span class="badge-promoted">' +
          escapeHtml(cl.badge) +
          "</span>" +
          '      <span class="badge-specialty">' +
          escapeHtml(cl.level) +
          "</span>" +
          "    </div>" +
          '    <button type="button" class="class-trailer-btn" data-action="watch-class-trailer" data-class-id="' +
          escapeHtml(cl.id) +
          '">▶ Watch Free Trailer</button>' +
          "  </div>" +
          '  <div class="class-body">' +
          '    <span class="class-format">' +
          escapeHtml(cl.format) +
          " • " +
          escapeHtml(cl.duration) +
          "</span>" +
          "    <h3>" +
          escapeHtml(cl.title) +
          "</h3>" +
          '    <p class="class-instructor">Taught by <strong>' +
          escapeHtml(cl.instructor) +
          "</strong> (" +
          escapeHtml(cl.instructorRole) +
          ")</p>" +
          (cl.cohortSchedule
            ? '<div class="class-schedule-pill">📅 ' + escapeHtml(cl.cohortSchedule) + "</div>"
            : "") +
          '    <p class="class-summary">' +
          escapeHtml(cl.summary) +
          "</p>" +
          '    <div class="class-actions-row">' +
          '      <div class="price-stack">' +
          "        <span>Full Access</span>" +
          "        <strong>" +
          (cl.originalPrice
            ? '<span class="price-strike">$' + escapeHtml(cl.originalPrice) + "</span>"
            : "") +
          "$" +
          escapeHtml(cl.price) +
          "</strong>" +
          "      </div>" +
          '      <div style="display:flex;gap:8px;">' +
          '        <button type="button" class="btn btn-ghost btn-sm" data-action="open-class-modal" data-class-id="' +
          escapeHtml(cl.id) +
          '" data-focus-mode="syllabus">Syllabus</button>' +
          '        <button type="button" class="btn btn-primary btn-sm" data-action="open-class-modal" data-class-id="' +
          escapeHtml(cl.id) +
          '" data-focus-mode="enroll">Enroll Now</button>' +
          "      </div>" +
          "    </div>" +
          "  </div>" +
          "</article>"
      )
      .join("");
  }

  function renderTestimonials() {
    const grid = document.getElementById("testimonials-grid");
    if (!grid || !DATA.testimonials) return;
    grid.innerHTML = DATA.testimonials
      .map(
        (t) =>
          '<div class="testimonial-card">' +
          "  <blockquote>“" +
          escapeHtml(t.quote) +
          "”</blockquote>" +
          '  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
          "    <div>" +
          '      <strong style="display:block;font-size:0.92rem;">' +
          escapeHtml(t.author) +
          "</strong>" +
          '      <span style="font-size:0.8rem;color:var(--text-muted);">' +
          escapeHtml(t.role) +
          "</span>" +
          "    </div>" +
          '    <span class="tag-chip">' +
          escapeHtml(t.type) +
          "</span>" +
          "  </div>" +
          "</div>"
      )
      .join("");
  }

  // ==========================================================================
  // STICKY STUDIO AUDIO DOCK (ZERO 10Hz GRID THRASHING)
  // ==========================================================================
  function setupAudioDock() {
    if (!window.studioAudio) return;

    const dock = document.getElementById("audio-dock");
    const thumb = document.getElementById("dock-thumb");
    const title = document.getElementById("dock-title");
    const artist = document.getElementById("dock-artist");
    const playBtn = document.getElementById("dock-play-btn");
    const scrubber = document.getElementById("dock-scrubber");
    const elapsedEl = document.getElementById("dock-elapsed");
    const durEl = document.getElementById("dock-duration");
    const volSlider = document.getElementById("dock-vol");
    const hireBtn = document.getElementById("dock-hire-btn");
    const closeBtn = document.getElementById("dock-close-btn");
    const heroPlayBtn = document.getElementById("hero-sample-play-btn");
    const canvas = document.getElementById("dock-spectrum");

    const freqBins = new Uint8Array(32);

    function setDockVisibility(show) {
      if (!dock) return;
      dock.classList.toggle("visible", show);
      dock.setAttribute("aria-hidden", String(!show));
      if (show) {
        dock.removeAttribute("inert");
        document.body.classList.add("audio-dock-open");
      } else {
        dock.setAttribute("inert", "");
        document.body.classList.remove("audio-dock-open");
      }
    }

    setDockVisibility(false);

    function drawSpectrum() {
      if (!canvas) return;
      const st = window.studioAudio.getState();
      if (
        !st.currentTrack ||
        st.currentTrack.id === "__reel_preview__" ||
        !st.isPlaying
      ) {
        state.spectrumRaf = null;
        return;
      }
      const ctx = canvas.getContext("2d");
      window.studioAudio.getFrequencyData(freqBins);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 24;
      const gap = 2;
      const barW = (canvas.width - gap * (barCount - 1)) / barCount;
      for (let i = 0; i < barCount; i++) {
        const val = freqBins[i] || 8;
        const h = Math.max(3, (val / 255) * canvas.height);
        ctx.fillStyle = i % 3 === 0 ? "#fbbf24" : "#f59e0b";
        ctx.fillRect(i * (barW + gap), canvas.height - h, barW, h);
      }
      state.spectrumRaf = requestAnimationFrame(drawSpectrum);
    }

    window.studioAudio.onChange((st, eventType) => {
      if (!dock) return;

      // Do not show bottom audio dock when Cinema Reel modal soundtrack is playing
      if (!st.currentTrack || st.currentTrack.id === "__reel_preview__") {
        setDockVisibility(false);
        if (heroPlayBtn) heroPlayBtn.textContent = "▶ Play Studio Sample";
        if (eventType !== "tick") syncCreatorAudioButtons(st);
        return;
      }

      // Fast 100ms progress update ONLY updates scrubber & time text — never touches creator cards!
      if (eventType === "tick") {
        if (elapsedEl) elapsedEl.textContent = formatTime(st.elapsedSec);
        if (durEl) durEl.textContent = formatTime(st.durationSec);
        if (scrubber && st.durationSec > 0 && !state.isDraggingScrubber) {
          scrubber.value = String(Math.round((st.elapsedSec / st.durationSec) * 100));
        }
        return;
      }

      setDockVisibility(true);

      if (thumb) thumb.src = st.currentTrack.avatar;
      if (title) title.textContent = st.currentTrack.sampleTitle;
      if (artist) {
        artist.textContent =
          st.currentTrack.name + " • Interactive Studio Arrangement Preview";
      }
      if (playBtn) {
        playBtn.textContent = st.isPlaying ? "❚❚" : "▶";
        playBtn.setAttribute("aria-label", st.isPlaying ? "Pause sample" : "Play sample");
      }
      if (elapsedEl) elapsedEl.textContent = formatTime(st.elapsedSec);
      if (durEl) durEl.textContent = formatTime(st.durationSec);
      if (hireBtn) {
        hireBtn.setAttribute("data-creator-id", st.currentTrack.id);
      }
      if (heroPlayBtn) {
        heroPlayBtn.textContent =
          st.currentTrack.id === "amara-sterling" && st.isPlaying
            ? "❚❚ Pause Sample"
            : "▶ Play Studio Sample";
      }

      syncCreatorAudioButtons(st);

      if (st.isPlaying && !state.spectrumRaf) {
        state.spectrumRaf = requestAnimationFrame(drawSpectrum);
      }
    });

    if (playBtn) {
      playBtn.addEventListener("click", () => {
        const st = window.studioAudio.getState();
        if (st.isPlaying) {
          window.studioAudio.pause();
        } else {
          window.studioAudio.resume().catch(() => {
            showToast("Tap a track button to enable browser audio playback.");
          });
        }
      });
    }

    if (scrubber) {
      scrubber.addEventListener("pointerdown", () => {
        state.isDraggingScrubber = true;
      });
      window.addEventListener("pointerup", () => {
        state.isDraggingScrubber = false;
      });
      scrubber.addEventListener("input", (e) => {
        window.studioAudio.seekToFraction(Number(e.target.value) / 100);
      });
    }

    if (volSlider) {
      volSlider.addEventListener("input", (e) => {
        window.studioAudio.setVolume(Number(e.target.value));
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        const activeCreatorId =
          window.studioAudio.getState().currentTrack &&
          window.studioAudio.getState().currentTrack.id;
        window.studioAudio.stop();
        const returnBtn = activeCreatorId
          ? document.querySelector(
              '.sample-trigger-bar[data-creator-id="' + activeCreatorId + '"]'
            )
          : document.getElementById("hero-sample-play-btn");
        if (returnBtn && typeof returnBtn.focus === "function") {
          returnBtn.focus();
        }
      });
    }
  }

  // ==========================================================================
  // ACCESSIBLE MODAL ENGINE (WITH FOCUS TRAP & CLEAN TRANSITIONS)
  // ==========================================================================
  function openModal(innerHtml, wide, focusSelector) {
    const backdrop = document.getElementById("universal-modal");
    const panel = document.getElementById("universal-modal-panel");
    const content = document.getElementById("universal-modal-body");
    if (!backdrop || !panel || !content) return;

    // Always stop active 60fps canvas reel before replacing modal DOM
    if (window.cinemaReel) {
      window.cinemaReel.stop();
    }

    // Preserve original page focus target even across modal-to-modal transitions
    if (!backdrop.classList.contains("open")) {
      state.lastFocusedEl = document.activeElement;
    }

    panel.classList.toggle("modal-wide", Boolean(wide));
    content.innerHTML = innerHtml;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    const customFocus = focusSelector ? panel.querySelector(focusSelector) : null;
    const closeBtn = document.getElementById("universal-modal-close");
    if (customFocus && typeof customFocus.focus === "function") {
      customFocus.focus();
    } else if (closeBtn) {
      closeBtn.focus();
    }
  }

  function closeModal() {
    const backdrop = document.getElementById("universal-modal");
    const content = document.getElementById("universal-modal-body");
    if (window.cinemaReel) {
      window.cinemaReel.stop();
    }
    if (backdrop) {
      backdrop.classList.remove("open");
      backdrop.setAttribute("aria-hidden", "true");
    }
    if (content) {
      content.innerHTML = "";
    }
    document.body.classList.remove("modal-open");
    if (
      state.lastFocusedEl &&
      state.lastFocusedEl.isConnected &&
      typeof state.lastFocusedEl.focus === "function"
    ) {
      state.lastFocusedEl.focus();
    }
  }

  // 1. Cinema Video Showreel Lightbox Modal (with Synced Audio Toggle!)
  function openReelModal(title, subtitle, presetKey, ctaConfig) {
    if (window.studioAudio && window.studioAudio.getState().isPlaying) {
      window.studioAudio.pause();
    }

    const ctaHtml = ctaConfig
      ? '<button type="button" class="btn btn-primary btn-sm" data-action="' +
        escapeHtml(ctaConfig.action) +
        '" ' +
        escapeHtml(ctaConfig.attrName) +
        '="' +
        escapeHtml(ctaConfig.attrVal) +
        '">' +
        escapeHtml(ctaConfig.label) +
        "</button>"
      : "";

    openModal(
      '<div style="padding-right:36px;">' +
        '  <span class="eyebrow-pill" style="margin-bottom:8px;">4K Studio Showreel Preview</span>' +
        '  <h2 style="font-family:var(--font-display);margin:0 0 4px;">' +
        escapeHtml(title) +
        "</h2>" +
        '  <p style="margin:0;color:var(--text-secondary);font-size:0.9rem;">' +
        escapeHtml(subtitle) +
        "</p>" +
        "</div>" +
        '<div class="reel-canvas-wrap">' +
        '  <canvas id="cinema-reel-canvas" width="960" height="540"></canvas>' +
        "</div>" +
        '<div class="reel-controls-bar">' +
        '  <div class="shot-pills" id="reel-shot-pills"></div>' +
        '  <div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '    <button type="button" class="btn btn-secondary btn-sm" id="reel-sound-btn">🔊 Enable Studio Score</button>' +
        '    <button type="button" class="btn btn-ghost btn-sm" id="reel-grade-btn">Compare: Film Grade vs Log</button>' +
        '    <button type="button" class="btn btn-ghost btn-sm" id="reel-playpause-btn">❚❚ Pause</button>' +
        "    " +
        ctaHtml +
        "  </div>" +
        "</div>",
      true
    );

    const canvas = document.getElementById("cinema-reel-canvas");
    const pillsMount = document.getElementById("reel-shot-pills");
    const soundBtn = document.getElementById("reel-sound-btn");
    const gradeBtn = document.getElementById("reel-grade-btn");
    const playPauseBtn = document.getElementById("reel-playpause-btn");

    if (window.cinemaReel && canvas) {
      const renderShotPills = (activeIdx) => {
        if (!pillsMount) return;
        const shots = window.cinemaReel.getShots();
        pillsMount.innerHTML = shots
          .map(
            (s, i) =>
              '<button type="button" class="filter-chip ' +
              (i === activeIdx ? "active" : "") +
              '" data-reel-shot="' +
              i +
              '">' +
              escapeHtml(s.label.split("•")[0].trim()) +
              "</button>"
          )
          .join("");
      };

      window.cinemaReel.attach(canvas, presetKey, (idx) => {
        renderShotPills(idx);
      });
      renderShotPills(0);

      if (pillsMount) {
        pillsMount.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-reel-shot]");
          if (!btn) return;
          const idx = Number(btn.getAttribute("data-reel-shot"));
          window.cinemaReel.setShot(idx);
          renderShotPills(idx);
        });
      }

      if (soundBtn) {
        soundBtn.addEventListener("click", async () => {
          const on = await window.cinemaReel.toggleSound(title);
          soundBtn.textContent = on ? "🔊 Mute Studio Score" : "🔊 Enable Studio Score";
        });
      }

      if (gradeBtn) {
        gradeBtn.addEventListener("click", () => {
          const isLog = window.cinemaReel.toggleColorGrade();
          gradeBtn.textContent = isLog
            ? "Showing Flat Log • Switch to Film Grade"
            : "Compare: Film Grade vs Log";
        });
      }

      if (playPauseBtn) {
        playPauseBtn.addEventListener("click", () => {
          const playing = window.cinemaReel.togglePlay();
          playPauseBtn.textContent = playing ? "❚❚ Pause" : "▶ Resume";
        });
      }
    }
  }

  // 2. Hire / Request Creator Quote Modal (Dynamic Math + Bundle Upsell + $0 Buyer Fee)
  function openHireCreatorModal(creatorId) {
    const c = DATA.creators.find((x) => x.id === creatorId) || DATA.creators[0];
    if (!c) return;

    const tier1 = c.startingPrice;
    const tier2 = Math.round((c.startingPrice * 1.65) / 10) * 10;
    const tier3 = Math.round((c.startingPrice * 2.6) / 10) * 10;

    const brandName = CFG.brandName || "SonicReel";
    const isVideoPro = c.category === "video" || c.category === "editing";
    const bundleLabel = isVideoPro
      ? "🎵 Pair a vetted " + brandName + " composer for custom cleared ad music (+$150 bundle)"
      : "🎥 Pair a vetted " + brandName + " video editor for a matching 9:16 + 16:9 ad cut (+$165 bundle)";

    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">$0 Buyer Fee • Escrow Protected • Commercial Rights</span>' +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">Hire or Message ' +
        escapeHtml(c.name) +
        "</h2>" +
        '<p style="margin:0 0 12px;color:var(--text-secondary);font-size:0.9rem;">' +
        escapeHtml(c.role) +
        " • Packages from <strong>$" +
        escapeHtml(tier1) +
        "</strong> (" +
        escapeHtml(c.turnaround) +
        ")</p>" +
        '<div class="deliverables-mini">✓ $0 buyer marketplace fee • Funds stay safely in escrow until you approve final files • ' +
        escapeHtml((c.deliverables || []).join(" • ")) +
        "</div>" +
        '<form id="modal-hire-form" class="form-grid">' +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="hire-name">Your Name or Business *</label>' +
        '      <input class="field-input" id="hire-name" name="name" required placeholder="e.g. Sarah Jenkins / Ritual Coffee">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="hire-email">Email Address *</label>' +
        '      <input class="field-input" id="hire-email" name="email" type="email" required placeholder="you@company.com">' +
        "    </div>" +
        "  </div>" +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="hire-budget">Select Package Tier *</label>' +
        '      <select class="field-input" id="hire-budget" name="budget">' +
        '        <option value="Starter ($' +
        escapeHtml(tier1) +
        ')">Starter Package ($' +
        escapeHtml(tier1) +
        ")</option>" +
        '        <option value="Commercial Multi-Cut ($' +
        escapeHtml(tier1) +
        "–$" +
        escapeHtml(tier2) +
        ')">Commercial / Multi-Cut ($' +
        escapeHtml(tier1) +
        " – $" +
        escapeHtml(tier2) +
        ")</option>" +
        '        <option value="Full Campaign ($' +
        escapeHtml(tier3) +
        '+)">Full Campaign / Custom ($' +
        escapeHtml(tier3) +
        "+)</option>" +
        "      </select>" +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="hire-timeline">Delivery Timeline</label>' +
        '      <select class="field-input" id="hire-timeline" name="timeline">' +
        '        <option value="Standard (' +
        escapeHtml(c.turnaround) +
        ')">Standard (' +
        escapeHtml(c.turnaround) +
        ")</option>" +
        '        <option value="48h Rush">48-Hour Rush Priority</option>' +
        '        <option value="Flexible / Exploring">Flexible / Exploring Ideas</option>' +
        "      </select>" +
        "    </div>" +
        "  </div>" +
        '  <label class="bundle-upsell-check">' +
        '    <input type="checkbox" name="addBundle" value="yes">' +
        "    <span><strong>One-Stop Bundle:</strong> " +
        escapeHtml(bundleLabel) +
        "</span>" +
        "  </label>" +
        "  <div>" +
        '    <label class="field-label" for="hire-details">Project Details &amp; Vibe *</label>' +
        '    <textarea class="field-input" id="hire-details" name="details" required placeholder="Describe your product, song/video length (e.g. 30s Instagram/TikTok ad), or reference links..."></textarea>' +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Send Free Quote Request to ' +
        escapeHtml(c.name.split(" ")[0]) +
        " →</button>" +
        '  <p style="margin:0;text-align:center;font-size:0.78rem;color:var(--text-muted);">No upfront charge to message. Typical creator reply: under 3 hours.</p>' +
        "</form>",
      false,
      "#hire-name"
    );

    const form = document.getElementById("modal-hire-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, ["name", "email", "details"]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        await deliverLead("hire_creator", {
          creatorId: c.id,
          creatorName: c.name,
          clientName: String(fd.get("name")).trim(),
          clientEmail: String(fd.get("email")).trim(),
          budget: fd.get("budget"),
          timeline: fd.get("timeline"),
          bundleRequested: fd.get("addBundle") === "yes",
          details: String(fd.get("details")).trim()
        });
        closeModal();
        showToast(
          "Quote request sent to " +
            c.name +
            "! Expect a reply at " +
            String(fd.get("email")).trim() +
            " within a few hours."
        );
      });
    }
  }

  // 3. Post a Free Client Project Brief Modal
  function openPostBriefModal() {
    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">$0 to Post • Get 3 Custom Quotes in 24h</span>' +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">Post What You Need Created</h2>' +
        '<p style="margin:0;color:var(--text-secondary);font-size:0.9rem;">Describe your music, video, or bundle project once and let verified pros pitch tailored samples &amp; flat-rate quotes.</p>' +
        '<form id="modal-brief-form" class="form-grid">' +
        "  <div>" +
        '    <label class="field-label" for="brief-title">Project Headline *</label>' +
        '    <input class="field-input" id="brief-title" name="title" required maxlength="110" placeholder="e.g. 30-Sec Promo Video + Catchy Beat for Local Coffee Brand">' +
        "  </div>" +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="brief-client">Your Name or Business *</label>' +
        '      <input class="field-input" id="brief-client" name="clientName" required maxlength="60" placeholder="e.g. Ritual Coffee Co.">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="brief-email">Contact Email (Kept Private) *</label>' +
        '      <input class="field-input" id="brief-email" name="email" type="email" required placeholder="owner@business.com">' +
        "    </div>" +
        "  </div>" +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="brief-category">Category *</label>' +
        '      <select class="field-input" id="brief-category" name="category">' +
        '        <option value="Video + Music Bundle">Video + Music Bundle</option>' +
        '        <option value="Video &amp; Editing">Commercial Video / Editing</option>' +
        '        <option value="Music &amp; Audio">Custom Music / Beat / Jingle</option>' +
        "      </select>" +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="brief-budget">Target Budget *</label>' +
        '      <input class="field-input" id="brief-budget" name="budget" required maxlength="40" placeholder="e.g. $350 – $650">' +
        "    </div>" +
        "  </div>" +
        "  <div>" +
        '    <label class="field-label" for="brief-desc">Project Description &amp; Deliverables *</label>' +
        '    <textarea class="field-input" id="brief-desc" name="description" required maxlength="500" placeholder="Mention length (e.g. 30s Instagram/TikTok ad), style, whether shipping a product, and deadline..."></textarea>' +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Publish Project Brief Free →</button>' +
        "</form>",
      false,
      "#brief-title"
    );

    const form = document.getElementById("modal-brief-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, [
          "title",
          "clientName",
          "email",
          "budget",
          "description"
        ]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        const categoryVal = String(fd.get("category") || "Video + Music Bundle");
        const newBrief = {
          id: "brief-" + Date.now(),
          title: String(fd.get("title")).trim(),
          clientName: String(fd.get("clientName")).trim(),
          clientType: "Posted by You • ✓ Active Brief",
          category: categoryVal,
          budget: String(fd.get("budget")).trim(),
          deadline: "Open for proposals",
          postedAgo: "Just now",
          proposalsCount: 0,
          description: String(fd.get("description")).trim()
        };

        state.customBriefs.unshift(newBrief);
        state.briefFilter = "all";
        document.querySelectorAll("[data-brief-cat]").forEach((el) => {
          const active = el.getAttribute("data-brief-cat") === "all";
          el.classList.toggle("active", active);
          el.setAttribute("aria-pressed", String(active));
        });
        safeStore.set("sonicreel_custom_briefs_v1", state.customBriefs.slice(0, 20));

        await deliverLead("post_project_brief", {
          ...newBrief,
          email: String(fd.get("email")).trim()
        });

        renderBriefs();
        closeModal();
        showToast("Your brief is live! You can remove it anytime from the card.");
        const section = document.getElementById("open-briefs");
        if (section) section.scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  // 4. Creator Proposal on an Open Brief
  function openPitchBriefModal(briefId) {
    const all = [...state.customBriefs, ...(DATA.openBriefs || [])];
    const b = all.find((x) => x.id === briefId) || all[0];
    if (!b) return;

    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">Creator Proposal • Escrow Protected</span>' +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">Pitch on: ' +
        escapeHtml(b.title) +
        "</h2>" +
        '<p style="margin:0 0 12px;color:var(--text-secondary);font-size:0.88rem;">Client: <strong>' +
        escapeHtml(b.clientName) +
        "</strong> • Budget: <strong>" +
        escapeHtml(b.budget) +
        "</strong></p>" +
        '<form id="modal-pitch-form" class="form-grid">' +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="pitch-name">Your Creator Name *</label>' +
        '      <input class="field-input" id="pitch-name" name="creatorName" required placeholder="Alex Rivera">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="pitch-email">Your Email *</label>' +
        '      <input class="field-input" id="pitch-email" name="email" type="email" required placeholder="alex@studio.com">' +
        "    </div>" +
        "  </div>" +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="pitch-scope">Pitching For *</label>' +
        '      <select class="field-input" id="pitch-scope" name="scope">' +
        '        <option value="Full Brief Scope">Full Brief Scope</option>' +
        '        <option value="Custom Music / Audio Portion Only">Custom Music / Audio Portion Only</option>' +
        '        <option value="Video / Editing Portion Only">Video / Editing Portion Only</option>' +
        "      </select>" +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="pitch-quote">Your Flat Quote ($ USD) *</label>' +
        '      <input class="field-input" id="pitch-quote" name="quote" required placeholder="e.g. $550 all-inclusive">' +
        "    </div>" +
        "  </div>" +
        "  <div>" +
        '    <label class="field-label" for="pitch-link">Portfolio / Reel URL *</label>' +
        '    <input class="field-input" id="pitch-link" name="portfolio" type="url" required placeholder="https://youtube.com/...">' +
        "  </div>" +
        "  <div>" +
        '    <label class="field-label" for="pitch-note">Creative Approach &amp; Turnaround *</label>' +
        '    <textarea class="field-input" id="pitch-note" name="message" required placeholder="Share how you will execute this brief, gear/DAW, and delivery timeline..."></textarea>' +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Submit Proposal to Client →</button>' +
        "</form>",
      false,
      "#pitch-name"
    );

    const form = document.getElementById("modal-pitch-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, [
          "creatorName",
          "email",
          "quote",
          "portfolio",
          "message"
        ]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        state.sentProposals.add(b.id);
        safeStore.set("sonicreel_sent_proposals_v1", [...state.sentProposals]);

        await deliverLead("creator_proposal", {
          briefId: b.id,
          briefTitle: b.title,
          creatorName: String(fd.get("creatorName")).trim(),
          email: String(fd.get("email")).trim(),
          scope: fd.get("scope"),
          quote: String(fd.get("quote")).trim(),
          portfolio: String(fd.get("portfolio")).trim(),
          message: String(fd.get("message")).trim()
        });
        renderBriefs();
        closeModal();
        showToast("Proposal sent to " + b.clientName + "! Card status updated.");
      });
    }
  }

  // 5. Join as a Creator / Apply for Pro Modal
  function openJoinCreatorModal(preselectedPlan) {
    const plan = preselectedPlan || "starter";
    const feePct =
      CFG.pricing && Number.isFinite(Number(CFG.pricing.marketplaceFeePercent))
        ? Number(CFG.pricing.marketplaceFeePercent)
        : 10;
    const keepPct = Math.max(0, 100 - feePct);
    const proPrice =
      state.proBilling === "annual"
        ? (CFG.pricing && CFG.pricing.creatorProAnnualMonthly) || 15
        : (CFG.pricing && CFG.pricing.creatorProMonthly) || 19;
    const baseAgencyPrice = (CFG.pricing && CFG.pricing.studioAgencyMonthly) || 49;
    const agencyPrice =
      state.proBilling === "annual"
        ? Math.round(baseAgencyPrice * 0.8)
        : baseAgencyPrice;

    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">Creator &amp; Instructor Onboarding</span>' +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">List Your Music, Video or Classes</h2>' +
        '<p style="margin:0;color:var(--text-secondary);font-size:0.9rem;">Get booked by growing brands, pitch on verified briefs, and keep up to 100% of every gig &amp; workshop sale.</p>' +
        '<form id="modal-creator-join-form" class="form-grid">' +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="join-name">Full Name or Studio Name *</label>' +
        '      <input class="field-input" id="join-name" name="name" required placeholder="e.g. Jordan Miles">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="join-email">Email Address *</label>' +
        '      <input class="field-input" id="join-email" name="email" type="email" required placeholder="jordan@studio.com">' +
        "    </div>" +
        "  </div>" +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="join-craft">Primary Craft *</label>' +
        '      <select class="field-input" id="join-craft" name="craft">' +
        '        <option value="Music Producer / Composer">Music Producer / Composer</option>' +
        '        <option value="Videographer / Film Director">Videographer / Film Director</option>' +
        '        <option value="Hybrid Music + Video Creator">Hybrid Music + Video Creator</option>' +
        '        <option value="Video Editor / Colorist / 3D">Video Editor / Colorist / 3D</option>' +
        '        <option value="Mixing &amp; Sound Designer">Mixing &amp; Sound Designer</option>' +
        "      </select>" +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="join-plan">Membership Tier *</label>' +
        '      <select class="field-input" id="join-plan" name="plan">' +
        '        <option value="starter" ' +
        (plan === "starter" ? "selected" : "") +
        ">Free Starter ($0/mo • Keep " +
        escapeHtml(keepPct) +
        "%)</option>" +
        '        <option value="pro" ' +
        (plan === "pro" ? "selected" : "") +
        ">Creator Pro ($" +
        escapeHtml(proPrice) +
        "/mo • 0% Commission + Featured)</option>" +
        '        <option value="agency" ' +
        (plan === "agency" ? "selected" : "") +
        ">Studio Agency ($" +
        escapeHtml(agencyPrice) +
        "/mo • Team Roster + Spotlight)</option>" +
        "      </select>" +
        "    </div>" +
        "  </div>" +
        '  <label class="bundle-upsell-check">' +
        '    <input type="checkbox" name="wantsToTeach" value="yes">' +
        '    <span><strong>Studio Academy:</strong> I am also interested in hosting paid classes, workshops, or 1-on-1 coaching sessions.</span>' +
        "  </label>" +
        "  <div>" +
        '    <label class="field-label" for="join-portfolio">Best Portfolio, Reel, Spotify or YouTube URL *</label>' +
        '    <input class="field-input" id="join-portfolio" name="portfolio" type="url" required placeholder="https://...">' +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Create My Studio Profile →</button>' +
        "</form>",
      false,
      "#join-name"
    );

    const form = document.getElementById("modal-creator-join-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, ["name", "email", "portfolio"]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        await deliverLead("creator_application", {
          name: String(fd.get("name")).trim(),
          email: String(fd.get("email")).trim(),
          craft: fd.get("craft"),
          plan: fd.get("plan"),
          billingCycle: state.proBilling,
          wantsToTeach: fd.get("wantsToTeach") === "yes",
          portfolio: String(fd.get("portfolio")).trim()
        });
        closeModal();
        showToast(
          "Welcome aboard, " +
            String(fd.get("name")).trim() +
            "! Onboarding link sent to " +
            String(fd.get("email")).trim() +
            "."
        );
      });
    }
  }

  // 6. Class Curriculum, 1-on-1 Mentor Selector & All-Access Pass Modals
  function openClassModal(classId, focusMode) {
    const cl = (DATA.classes || []).find((x) => x.id === classId) || DATA.classes[0];
    if (!cl) return;

    const mentorFieldHtml =
      cl.isCoaching && Array.isArray(cl.mentors)
        ? '<div>' +
          '  <label class="field-label" for="enroll-mentor">Choose Your 1-on-1 Mentor *</label>' +
          '  <select class="field-input" id="enroll-mentor" name="mentor">' +
          cl.mentors
            .map(
              (m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + "</option>"
            )
            .join("") +
          "  </select>" +
          "</div>"
        : "";

    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">' +
        escapeHtml(cl.format) +
        "</span>" +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">' +
        escapeHtml(cl.title) +
        "</h2>" +
        '<p style="margin:0 0 12px;color:var(--text-secondary);font-size:0.9rem;">Instructor: <strong>' +
        escapeHtml(cl.instructor) +
        "</strong> • " +
        escapeHtml(cl.duration) +
        "</p>" +
        (cl.cohortSchedule
          ? '<div class="class-schedule-pill">📅 ' + escapeHtml(cl.cohortSchedule) + "</div>"
          : "") +
        '<div id="modal-syllabus-box" class="deliverables-mini" style="margin-bottom:14px;">' +
        '  <strong style="display:block;margin-bottom:6px;color:var(--text-primary);">Full Curriculum Breakdown:</strong>' +
        (cl.syllabus || [])
          .map((s) => '<div style="margin-bottom:4px;">• ' + escapeHtml(s) + "</div>")
          .join("") +
        "</div>" +
        '<div class="deliverables-mini" style="border-color:rgba(52,211,153,0.3);">' +
        '  <strong style="display:block;margin-bottom:6px;color:var(--emerald);">Included With Enrollment ($' +
        escapeHtml(cl.price) +
        "):</strong>" +
        (cl.perks || [])
          .map((p) => '<div style="margin-bottom:4px;">✓ ' + escapeHtml(p) + "</div>")
          .join("") +
        "</div>" +
        '<form id="modal-class-form" class="form-grid">' +
        mentorFieldHtml +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="enroll-name">Your Full Name *</label>' +
        '      <input class="field-input" id="enroll-name" name="name" required placeholder="Jordan Pierce">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="enroll-email">Email for Access &amp; Checkout Link *</label>' +
        '      <input class="field-input" id="enroll-email" name="email" type="email" required placeholder="you@email.com">' +
        "    </div>" +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Reserve Spot &amp; Send Checkout Link ($' +
        escapeHtml(cl.price) +
        ") →</button>" +
        '  <p style="margin:0;text-align:center;font-size:0.77rem;color:var(--text-muted);">No charge yet — we email your secure Stripe checkout' +
        (cl.isCoaching ? " &amp; live calendar scheduler" : " &amp; instant classroom link") +
        " immediately.</p>" +
        "</form>",
      false,
      focusMode === "enroll" ? "#enroll-name" : "#universal-modal-close"
    );

    const form = document.getElementById("modal-class-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, ["name", "email"]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        await deliverLead("class_enrollment", {
          classId: cl.id,
          classTitle: cl.title,
          price: cl.price,
          mentor: fd.get("mentor") || cl.instructor,
          studentName: String(fd.get("name")).trim(),
          studentEmail: String(fd.get("email")).trim()
        });
        closeModal();
        showToast(
          "Reserved “" +
            cl.title +
            "”! Check " +
            String(fd.get("email")).trim() +
            " for your access link."
        );
      });
    }
  }

  function openAllAccessPassModal() {
    const passPrice = (CFG.pricing && CFG.pricing.allAccessPassYearly) || 199;
    const savings = computeAllAccessSavings();
    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">Best Academy Value • Save $' +
        escapeHtml(savings) +
        "</span>" +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">Studio Academy All-Access Pass</h2>' +
        '<p style="margin:0 0 14px;color:var(--text-secondary);font-size:0.9rem;">Unlock every on-demand filmmaking, editing, beatmaking, and mixing masterclass—plus monthly live group track &amp; reel critiques—for 12 full months.</p>' +
        '<div class="deliverables-mini" style="border-color:rgba(52,211,153,0.3);">' +
        "  <div>✓ Instant access to all 5 courses + every new workshop released this year</div>" +
        "  <div>✓ Download all LUT packs, 200+ drum/808 samples, multi-track stems &amp; pitch decks</div>" +
        "  <div>✓ Monthly live group Q&amp;A + 30-day unconditional money-back guarantee</div>" +
        "</div>" +
        '<form id="modal-pass-form" class="form-grid">' +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="pass-name">Full Name *</label>' +
        '      <input class="field-input" id="pass-name" name="name" required placeholder="Your Name">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="pass-email">Email Address *</label>' +
        '      <input class="field-input" id="pass-email" name="email" type="email" required placeholder="you@email.com">' +
        "    </div>" +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Unlock All-Access Studio Pass ($' +
        escapeHtml(passPrice) +
        "/yr) →</button>" +
        "</form>",
      false,
      "#pass-name"
    );

    const form = document.getElementById("modal-pass-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, ["name", "email"]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        await deliverLead("all_access_pass", {
          price: passPrice,
          studentName: String(fd.get("name")).trim(),
          studentEmail: String(fd.get("email")).trim()
        });
        closeModal();
        showToast(
          "All-Access Studio Pass reserved! Check " +
            String(fd.get("email")).trim() +
            " to activate."
        );
      });
    }
  }

  // 7. Partner Perk Modal (Real Clipboard Copy) & Mini Media-Kit Sponsor Modal
  function openPartnerPerkModal(sponsorKey) {
    const sp =
      (DATA.sponsors && DATA.sponsors[sponsorKey]) ||
      (DATA.sponsors && DATA.sponsors.leaderboard);
    if (!sp) return;
    const code = sp.promoCode || "SONIC20";
    const brandName = CFG.brandName || "SonicReel";
    const nativeRate = (CFG.ads && CFG.ads.rates && CFG.ads.rates.nativeCardWeekly) || 99;
    const hasValidUrl =
      typeof sp.partnerUrl === "string" && /^https?:\/\//i.test(sp.partnerUrl);

    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">' +
        escapeHtml(sp.tag || "SPONSORED PARTNER") +
        "</span>" +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">' +
        escapeHtml(sp.sponsorName) +
        " — Creator Perk</h2>" +
        '<p style="margin:0 0 14px;color:var(--text-secondary);font-size:0.92rem;">' +
        escapeHtml(sp.perkDetail || sp.subtext) +
        "</p>" +
        '<div class="deliverables-mini" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '  <span>Exclusive Promo Code: <strong style="color:var(--accent-hover);font-size:1rem;">' +
        escapeHtml(code) +
        "</strong></span>" +
        '  <div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '    <button type="button" class="btn btn-primary btn-sm" id="copy-promo-btn">Copy Code ' +
        escapeHtml(code) +
        "</button>" +
        (hasValidUrl
          ? '<a class="btn btn-secondary btn-sm" href="' +
            escapeHtml(sp.partnerUrl) +
            '" target="_blank" rel="sponsored noopener noreferrer">Visit Partner Offer ↗</a>'
          : "") +
        "  </div>" +
        "</div>" +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle);">' +
        '  <span style="font-size:0.8rem;color:var(--text-muted);">Want your brand featured like this?</span>' +
        '  <button type="button" class="btn btn-ghost btn-sm" data-action="open-advertise">Sponsor ' +
        escapeHtml(brandName) +
        " (From $" +
        escapeHtml(nativeRate) +
        "/wk) →</button>" +
        "</div>",
      false,
      "#copy-promo-btn"
    );

    const copyBtn = document.getElementById("copy-promo-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(code);
          }
          copyBtn.textContent = "✓ Copied " + code + "!";
          showToast("Promo code " + code + " copied to your clipboard!");
        } catch (_) {
          copyBtn.textContent = "Code: " + code;
        }
      });
    }
  }

  function openAdvertiseModal() {
    const brandName = CFG.brandName || "SonicReel";
    const rates = (CFG.ads && CFG.ads.rates) || {
      nativeCardWeekly: 99,
      leaderboardWeekly: 149,
      newsletterSpotlight: 199,
      fourWeekBundle: 475
    };

    openModal(
      '<span class="eyebrow-pill" style="margin-bottom:10px;">Direct Studio Sponsorships</span>' +
        '<h2 style="font-family:var(--font-display);margin:0 0 6px;">Sponsor ' +
        escapeHtml(brandName) +
        " — Reach Creators &amp; Brands</h2>" +
        '<p style="margin:0 0 14px;color:var(--text-secondary);font-size:0.9rem;">Put your audio plugin, camera gear, SaaS tool, or creative service directly in front of music producers, filmmakers, and brand founders.</p>' +
        '<div class="media-kit-stats">' +
        '  <div class="media-stat-card"><strong>45% / 35% / 20%</strong><span>Audio Pros • Filmmakers • Brand Buyers</span></div>' +
        '  <div class="media-stat-card"><strong>3.8% Avg CTR</strong><span>Native HTML cards — 100% AdBlock immune</span></div>' +
        '  <div class="media-stat-card"><strong>100% Share</strong><span>No rotating banner clutter on your slot</span></div>' +
        "</div>" +
        '<form id="modal-advertise-form" class="form-grid">' +
        '  <div class="form-row-2">' +
        "    <div>" +
        '      <label class="field-label" for="ad-company">Brand / Company Name *</label>' +
        '      <input class="field-input" id="ad-company" name="company" required placeholder="e.g. Prism Audio Labs">' +
        "    </div>" +
        "    <div>" +
        '      <label class="field-label" for="ad-email">Work Email *</label>' +
        '      <input class="field-input" id="ad-email" name="email" type="email" required placeholder="partners@brand.com">' +
        "    </div>" +
        "  </div>" +
        "  <div>" +
        '    <label class="field-label" for="ad-package">Select Sponsorship Package *</label>' +
        '    <select class="field-input" id="ad-package" name="package">' +
        '      <option value="In-Feed Native Card ($' +
        escapeHtml(rates.nativeCardWeekly) +
        '/wk)">In-Feed Native Marketplace Card — $' +
        escapeHtml(rates.nativeCardWeekly) +
        "/week</option>" +
        '      <option value="Homepage Partner Banner ($' +
        escapeHtml(rates.leaderboardWeekly) +
        '/wk)">Homepage Partner Leaderboard — $' +
        escapeHtml(rates.leaderboardWeekly) +
        "/week</option>" +
        '      <option value="Weekly Bundle + Newsletter ($' +
        escapeHtml(rates.newsletterSpotlight) +
        '/wk)">Banner + Native Card + Creator Newsletter — $' +
        escapeHtml(rates.newsletterSpotlight) +
        "/week</option>" +
        '      <option value="4-Week Launch Sponsor Bundle ($' +
        escapeHtml(rates.fourWeekBundle || 475) +
        ')">4-Week Launch Sponsor Bundle (Save 20%) — $' +
        escapeHtml(rates.fourWeekBundle || 475) +
        "</option>" +
        "    </select>" +
        "  </div>" +
        "  <div>" +
        '    <label class="field-label" for="ad-url">Destination URL *</label>' +
        '    <input class="field-input" id="ad-url" name="landingUrl" type="url" required placeholder="https://yourbrand.com/offer">' +
        "  </div>" +
        '  <button type="submit" class="btn btn-primary btn-lg" style="width:100%;">Reserve Ad Slot &amp; Request Invoice →</button>' +
        "</form>",
      false,
      "#ad-company"
    );

    const form = document.getElementById("modal-advertise-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = validateTrimmedForm(form, ["company", "email", "landingUrl"]);
        if (!fd) return;
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        await deliverLead("sponsor_ad_booking", {
          company: String(fd.get("company")).trim(),
          email: String(fd.get("email")).trim(),
          package: fd.get("package"),
          landingUrl: String(fd.get("landingUrl")).trim()
        });
        closeModal();
        showToast(
          "Sponsor slot inquiry received for " +
            String(fd.get("company")).trim() +
            "! Media kit & booking link sent to " +
            String(fd.get("email")).trim() +
            "."
        );
      });
    }
  }

  // ==========================================================================
  // EVENT DELEGATION, KEYBOARD FOCUS TRAP & URL DEEP-LINKING
  // ==========================================================================
  function bindEvents() {
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");

      if (action === "play-creator-audio") {
        const id = btn.getAttribute("data-creator-id");
        const creator = DATA.creators.find((x) => x.id === id) || DATA.creators[0];
        if (creator && window.studioAudio) {
          try {
            await window.studioAudio.toggleTrack(creator);
          } catch (_) {
            showToast("Audio playback requires browser sound permission.");
          }
        }
      } else if (action === "watch-creator-reel") {
        const id = btn.getAttribute("data-creator-id");
        const c = DATA.creators.find((x) => x.id === id);
        if (c) {
          openReelModal(
            c.sampleTitle,
            c.name + " • " + c.role + " • Packages from $" + c.startingPrice,
            c.videoPreset,
            {
              label: "Hire " + c.name.split(" ")[0],
              action: "open-hire-creator",
              attrName: "data-creator-id",
              attrVal: c.id
            }
          );
        }
      } else if (action === "watch-class-trailer") {
        const id = btn.getAttribute("data-class-id");
        const cl = (DATA.classes || []).find((x) => x.id === id);
        if (cl) {
          openReelModal(
            "Course Preview: " + cl.title,
            "Taught by " + cl.instructor + " • " + cl.duration,
            cl.videoPreset,
            {
              label: "Syllabus & Enroll ($" + cl.price + ")",
              action: "open-class-modal",
              attrName: "data-class-id",
              attrVal: cl.id
            }
          );
        }
      } else if (action === "open-hire-creator") {
        openHireCreatorModal(btn.getAttribute("data-creator-id"));
      } else if (action === "open-post-brief") {
        openPostBriefModal();
      } else if (action === "open-pitch-brief") {
        openPitchBriefModal(btn.getAttribute("data-brief-id"));
      } else if (action === "delete-custom-brief") {
        const id = btn.getAttribute("data-brief-id");
        state.customBriefs = state.customBriefs.filter((b) => b.id !== id);
        safeStore.set("sonicreel_custom_briefs_v1", state.customBriefs);
        renderBriefs();
        showToast("Your custom project brief has been removed.");
      } else if (action === "open-join-creator") {
        const navLinks = document.getElementById("primary-nav-links");
        const menuBtn = document.getElementById("mobile-menu-btn");
        if (navLinks && navLinks.classList.contains("mobile-open")) {
          navLinks.classList.remove("mobile-open");
          if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
        }
        openJoinCreatorModal(btn.getAttribute("data-plan") || "starter");
      } else if (action === "open-class-modal") {
        openClassModal(
          btn.getAttribute("data-class-id"),
          btn.getAttribute("data-focus-mode") || "syllabus"
        );
      } else if (action === "open-all-access") {
        openAllAccessPassModal();
      } else if (action === "open-advertise") {
        openAdvertiseModal();
      } else if (action === "partner-offer") {
        openPartnerPerkModal(btn.getAttribute("data-sponsor-key") || "leaderboard");
      } else if (action === "reset-creator-filters") {
        state.creatorCategory = "all";
        state.creatorUseCase = "all";
        state.creatorSearch = "";
        const searchInput = document.getElementById("creator-search-input");
        if (searchInput) searchInput.value = "";
        syncFilterChipStates();
        renderCreators();
      } else if (action === "quick-filter-jump") {
        const cat = btn.getAttribute("data-cat") || "all";
        state.creatorCategory = cat;
        syncFilterChipStates();
        renderCreators();
        const target = document.getElementById("marketplace");
        if (target) target.scrollIntoView({ behavior: "smooth" });
      }
    });

    // Creator category tabs
    document.querySelectorAll("[data-creator-cat]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.creatorCategory = tab.getAttribute("data-creator-cat") || "all";
        syncFilterChipStates();
        renderCreators();
      });
    });

    // Creator use-case pills
    document.querySelectorAll("[data-usecase]").forEach((pill) => {
      pill.addEventListener("click", () => {
        state.creatorUseCase = pill.getAttribute("data-usecase") || "all";
        syncFilterChipStates();
        renderCreators();
      });
    });

    // Open Briefs category tabs
    document.querySelectorAll("[data-brief-cat]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.briefFilter = tab.getAttribute("data-brief-cat") || "all";
        document.querySelectorAll("[data-brief-cat]").forEach((el) => {
          const active = el.getAttribute("data-brief-cat") === state.briefFilter;
          el.classList.toggle("active", active);
          el.setAttribute("aria-pressed", String(active));
        });
        renderBriefs();
      });
    });

    // Creator Pro monthly/annual billing toggle
    document.querySelectorAll("[data-billing-cycle]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.proBilling = tab.getAttribute("data-billing-cycle") || "monthly";
        document.querySelectorAll("[data-billing-cycle]").forEach((el) => {
          const active = el.getAttribute("data-billing-cycle") === state.proBilling;
          el.classList.toggle("active", active);
          el.setAttribute("aria-pressed", String(active));
        });
        updateCreatorPricingDisplay();
      });
    });

    const searchInput = document.getElementById("creator-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.creatorSearch = e.target.value || "";
        renderCreators();
      });
    }

    const sortSelect = document.getElementById("creator-sort-select");
    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        state.creatorSort = e.target.value || "featured";
        renderCreators();
      });
    }

    // Class category tabs
    document.querySelectorAll("[data-class-cat]").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.classCategory = tab.getAttribute("data-class-cat") || "all";
        document.querySelectorAll("[data-class-cat]").forEach((el) => {
          const active = el.getAttribute("data-class-cat") === state.classCategory;
          el.classList.toggle("active", active);
          el.setAttribute("aria-pressed", String(active));
        });
        renderClasses();
      });
    });

    // Mobile Menu Toggle
    const menuBtn = document.getElementById("mobile-menu-btn");
    const navLinks = document.getElementById("primary-nav-links");
    if (menuBtn && navLinks) {
      menuBtn.addEventListener("click", () => {
        const isOpen = navLinks.classList.toggle("mobile-open");
        menuBtn.setAttribute("aria-expanded", String(isOpen));
      });
      navLinks.addEventListener("click", (e) => {
        if (e.target.tagName === "A") {
          navLinks.classList.remove("mobile-open");
          menuBtn.setAttribute("aria-expanded", "false");
        }
      });
    }

    // Modal close events (drag-safe backdrop click, Escape key, & Tab focus trap)
    const modalClose = document.getElementById("universal-modal-close");
    const modalBackdrop = document.getElementById("universal-modal");
    const modalPanel = document.getElementById("universal-modal-panel");

    if (modalClose) {
      modalClose.addEventListener("click", closeModal);
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener("mousedown", (e) => {
        state.backdropMouseDown = e.target === modalBackdrop;
      });
      modalBackdrop.addEventListener("click", (e) => {
        if (state.backdropMouseDown && e.target === modalBackdrop) {
          closeModal();
        }
        state.backdropMouseDown = false;
      });
    }

    document.addEventListener("keydown", (e) => {
      const modalOpen = modalBackdrop && modalBackdrop.classList.contains("open");
      if (e.key === "Escape") {
        if (modalOpen) {
          closeModal();
          return;
        }
        if (navLinks && navLinks.classList.contains("mobile-open")) {
          navLinks.classList.remove("mobile-open");
          if (menuBtn) {
            menuBtn.setAttribute("aria-expanded", "false");
            menuBtn.focus();
          }
        }
      }

      // Trap Tab / Shift+Tab inside open modal dialog
      if (e.key === "Tab" && modalOpen && modalPanel) {
        const focusables = modalPanel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Footer Newsletter Form
    const newsForm = document.getElementById("newsletter-form");
    if (newsForm) {
      newsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("newsletter-email");
        const email = input ? input.value.trim() : "";
        if (!email) return;
        const submitBtn = newsForm.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        await deliverLead("newsletter_signup", { email });
        if (submitBtn) submitBtn.disabled = false;
        if (input) input.value = "";
        showToast("Subscribed! Weekly paid briefs & free studio LUTs/samples headed to " + email + ".");
      });
    }
  }

  function syncFilterChipStates() {
    document.querySelectorAll("[data-creator-cat]").forEach((el) => {
      const active = el.getAttribute("data-creator-cat") === state.creatorCategory;
      el.classList.toggle("active", active);
      el.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-usecase]").forEach((el) => {
      const active = el.getAttribute("data-usecase") === state.creatorUseCase;
      el.classList.toggle("active", active);
      el.setAttribute("aria-pressed", String(active));
    });
  }

  // Deep-link support for paid social/search ad campaigns (?cat=video, ?intent=brief, etc.)
  function handleAdDeepLinks() {
    try {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get("cat");
      if (cat && ["music", "video", "editing", "sound"].includes(cat)) {
        state.creatorCategory = cat;
        syncFilterChipStates();
        renderCreators();
      }
      const usecase = params.get("usecase");
      if (usecase && ["business", "youtube", "events", "custom"].includes(usecase)) {
        state.creatorUseCase = usecase;
        syncFilterChipStates();
        renderCreators();
      }
      const intent = params.get("intent");
      if (intent === "brief") openPostBriefModal();
      else if (intent === "pro") openJoinCreatorModal("pro");
      else if (intent === "advertise") openAdvertiseModal();
      else if (intent === "academy") {
        const acad = document.getElementById("academy");
        if (acad) acad.scrollIntoView({ behavior: "smooth" });
      }
    } catch (_) {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    initAdPixels();
    hydrateBranding();
    renderAdSlots();
    renderCreators();
    renderBriefs();
    renderClasses();
    renderTestimonials();
    setupAudioDock();
    bindEvents();
    handleAdDeepLinks();
  });
})();
