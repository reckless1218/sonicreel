/**
 * ============================================================================
 * SONICREEL — OWNER CONFIGURATION FILE (config.js)
 * ============================================================================
 * Edit the values below to customize your brand name, contact email, pricing,
 * form delivery, ad pixels, and Google AdSense / Sponsor settings!
 * ============================================================================
 */
window.SITE_CONFIG = {
  // 1. BRANDING & IDENTITY
  brandName: "SonicReel",
  brandTagline: "Studio-Grade Custom Music, Commercial Video & Live Pro Classes",
  domainUrl: "https://reckless1218.github.io/sonicreel",
  contactEmail: "hello@sonicreel.studio",
  supportCity: "Austin, TX • Remote Worldwide",
  foundedYear: 2026,

  // 2. EMAIL LEAD CAPTURE (Optional — Free via Formspree.io or Web3Forms)
  // Paste a free Formspree endpoint like "https://formspree.io/f/xyzwabcd"
  // to receive every Hire Request, Creator Signup, Class Booking, and Ad Inquiry
  // straight to your inbox (including UTM ad campaign attribution!).
  formEndpointUrl: "",

  // 3. ADVERTISING & MONETIZATION ENGINE
  ads: {
    // Set mode to "house_sponsors" (clean partner promos + "Advertise Here" slots)
    // or "adsense" once Google approves your domain!
    mode: "house_sponsors",

    // Google AdSense settings (used when mode === "adsense")
    // Leave slot IDs blank to run AdSense Auto Ads, or paste specific unit IDs.
    adsensePublisherId: "",
    adsenseLeaderboardSlotId: "",
    adsenseInFeedSlotId: "",

    // Direct Self-Serve Sponsorship Rates (shown in the "Advertise With Us" media kit)
    rates: {
      nativeCardWeekly: 99,
      leaderboardWeekly: 149,
      newsletterSpotlight: 199,
      fourWeekBundle: 475
    }
  },

  // 4. PLATFORM COMMISSION, CREATOR PRO & STUDIO PASS PRICING
  pricing: {
    marketplaceFeePercent: 10,  // Standard platform fee on Free Starter creator bookings
    creatorProMonthly: 19,      // Founding monthly rate (founding price)
    creatorProAnnualMonthly: 15,// Effective monthly rate when billed annually ($180/yr)
    studioAgencyMonthly: 49,    // Production Agency plan (team roster + homepage spotlight)
    allAccessPassYearly: 199    // Unlocks all Studio Academy on-demand classes + monthly review
  },

  // 5. PAID AD PIXELS (Optional — paste IDs when launching Meta, TikTok or Google Ads)
  pixels: {
    metaPixelId: "",
    gtagId: "",
    tiktokPixelId: ""
  },

  // 6. SOCIAL LINKS (Rendered automatically in the footer)
  social: {
    // Add real profile URLs here, e.g. instagram: "https://instagram.com/yourhandle"
  }
};
