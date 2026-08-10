(() => {
  "use strict";

  /* =====================================================
     ADMFLIP CONFIG
  ===================================================== */

  const DEFAULT_BACKEND = "https://admflip-beta.onrender.com";

  const BACKEND = (
    new URLSearchParams(location.search).get("backend") ||
    (window.ADMFLIP_CONFIG && window.ADMFLIP_CONFIG.backend) ||
    DEFAULT_BACKEND
  ).replace(/\/+$/, "");

  window.ADMFLIP = {
    backend: BACKEND
  };

  console.log("[ADMFLIP] Backend:", BACKEND);

  /* =====================================================
     STATE
  ===================================================== */

  const state = {
    page: "coinflip",
    user: null,
    verification: null,
    pets: [],
    inventory: [],
    selectedPet: null,
    selectedSide: null,
    coinflips: [],
    chatOpen: false,
    onlineCount: 0,
    token: localStorage.getItem("admflip_token") || null
  };

  /* =====================================================
     CONSTANTS
  ===================================================== */

  // IMPORTANT:
  // ADMFLIP logo = logo.png
  // Roblox login icon = roblox.png

  const LOGO = "/logo.png";
  const ROBLOX_LOGO = "/roblox.png";
  const BACKGROUND = "/blurry.png";
  const TOKEN_KEY = "admflip_token";

  /* =====================================================
     DOM HELPERS
  ===================================================== */

  const $ = (selector) => document.querySelector(selector);

  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const el = (id) => document.getElementById(id);

  function show(node) {
    if (node) node.classList.remove("hidden");
  }

  function hide(node) {
    if (node) node.classList.add("hidden");
  }

  /* =====================================================
     CLEAN RAW MARKDOWN / CODE FENCE LEAKS
  ===================================================== */

  function cleanDocumentLeak() {
    const body = document.body;

    if (!body) return;

    const badPatterns = [
      /^###\s*index\.html/i,
      /^###\s*script\.js/i,
      /^###\s*style\.css/i,
      /^:::writing/i,
      /^\{\{.*writing/i,
      /^```html/i,
      /^```javascript/i,
      /^```js/i
    ];

    [...body.childNodes].forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;

      const text = node.textContent.trim();

      if (!text) return;

      if (badPatterns.some((pattern) => pattern.test(text))) {
        node.remove();
      }
    });

    // Remove accidental writing/code labels inside the page.
    $$("body *").forEach((node) => {
      if (node.children.length > 0) return;

      const text = (node.textContent || "").trim();

      if (
        /^###\s*(index\.html|script\.js|style\.css)/i.test(text) ||
        /^:::writing/i.test(text) ||
        /^```(html|javascript|js|css)?$/i.test(text)
      ) {
        node.remove();
      }
    });
  }

  /* =====================================================
     SAFE HTML
  ===================================================== */

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* =====================================================
     NUMBER FORMAT
  ===================================================== */

  function formatNumber(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return "0";
    }

    return n.toLocaleString();
  }

  function formatValue(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return "0";
    }

    if (n >= 1000000000) {
      return (
        (n / 1000000000).toFixed(
          n >= 10000000000 ? 0 : 1
        ) + "B"
      );
    }

    if (n >= 1000000) {
      return (
        (n / 1000000).toFixed(
          n >= 10000000 ? 0 : 1
        ) + "M"
      );
    }

    if (n >= 1000) {
      return (
        (n / 1000).toFixed(
          n >= 100000 ? 0 : 1
        ) + "K"
      );
    }

    return n.toLocaleString();
  }

  /* =====================================================
     PET HELPERS
  ===================================================== */

  function petName(pet) {
    if (typeof pet === "string") {
      return pet;
    }

    return (
      pet?.name ||
      pet?.petName ||
      pet?.itemName ||
      pet?.displayName ||
      "Unknown Pet"
    );
  }

  function petValue(pet) {
    if (typeof pet === "string") {
      return 0;
    }

    return (
      Number(
        pet?.value ??
        pet?.normalValue ??
        pet?.worth ??
        pet?.price ??
        pet?.petValue ??
        0
      ) || 0
    );
  }

  function petImage(pet) {
    const name = petName(pet);

    if (
      typeof pet !== "string" &&
      (
        pet?.image ||
        pet?.imageUrl ||
        pet?.icon ||
        pet?.thumbnail
      )
    ) {
      return (
        pet.image ||
        pet.imageUrl ||
        pet.icon ||
        pet.thumbnail
      );
    }

    return (
      "https://amvgg.com/items/" +
      encodeURIComponent(name) +
      ".webp"
    );
  }

  function robloxAvatar(id) {
    if (!id) {
      return ROBLOX_LOGO;
    }

    return (
      "https://www.roblox.com/headshot-thumbnail/image" +
      `?userId=${encodeURIComponent(id)}` +
      "&width=150&height=150&format=png"
    );
  }

  /* =====================================================
     IMAGE FIX
  ===================================================== */

  function fixImage(image, fallback = null) {
    if (!image) return;

    image.removeAttribute("srcset");

    image.addEventListener(
      "error",
      () => {
        if (image.dataset.admflipFallback) {
          return;
        }

        image.dataset.admflipFallback = "1";

        if (fallback) {
          image.src = fallback;
        }
      },
      { once: true }
    );
  }

  function fixLogoImages(root = document) {
    if (!root) return;

    const images =
      root.querySelectorAll
        ? root.querySelectorAll("img")
        : [];

    images.forEach((image) => {
      const source =
        image.getAttribute("src") || "";

      /*
       * ONLY images explicitly intended to be
       * the ADMFLIP logo get logo.png.
       */
      const isMainLogo =
        image.dataset.admflipLogo === "true" ||
        image.classList.contains("site-logo") ||
        image.classList.contains("logo-image") ||
        image.closest(".site-logo, .brand-logo, #brandLogo");

      if (isMainLogo) {
        image.src = LOGO;
        image.removeAttribute("srcset");
        image.style.objectFit = "contain";
        image.style.filter = "none";

        fixImage(image, LOGO);
        return;
      }

      /*
       * Roblox icons/avatars get roblox.png.
       */
      const isRobloxImage =
        image.dataset.robloxLogo === "true" ||
        image.classList.contains("roblox-logo") ||
        image.classList.contains("roblox-icon");

      if (isRobloxImage) {
        image.src = ROBLOX_LOGO;
        image.removeAttribute("srcset");

        fixImage(image, ROBLOX_LOGO);
        return;
      }

      /*
       * DO NOT replace random broken pet images
       * with logo.png.
       */
      fixImage(image);
    });
  }

  function forceMainLogo() {
    const selectors = [
      "#brand img",
      "#brandLogo",
      ".brand-logo img",
      ".site-logo img",
      ".header-logo img",
      ".navbar-brand img",
      ".logo img"
    ];

    let found = false;

    selectors.forEach((selector) => {
      $$(selector).forEach((image) => {
        image.src = LOGO;
        image.removeAttribute("srcset");

        image.style.objectFit = "contain";
        image.style.filter = "none";

        image.dataset.admflipLogo = "true";

        fixImage(image, LOGO);

        found = true;
      });
    });

    /*
     * If the header has a plain <img> that is clearly
     * the ADMFLIP logo, fix only that image.
     */
    if (!found) {
      $$("header img, nav img").forEach((image) => {
        const alt =
          (image.alt || "").toLowerCase();

        const src =
          (image.getAttribute("src") || "").toLowerCase();

        if (
          alt.includes("admflip") ||
          alt === "logo" ||
          src.endsWith("/logo.png") ||
          src.includes("admflip-logo")
        ) {
          image.src = LOGO;
          image.removeAttribute("srcset");
          image.dataset.admflipLogo = "true";

          fixImage(image, LOGO);

          found = true;
        }
      });
    }

    fixLogoImages();
  }

  /* =====================================================
     SVG ICON SYSTEM
  ===================================================== */

  const ICONS = {
    coinflip: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="M9.5 9.5c.7-.9 1.6-1.3 2.7-1.3 1.4 0 2.3.7 2.3 1.8 0 1.1-.8 1.5-2.1 1.9-1.4.4-2.4.8-2.4 2.1 0 1.2 1 1.9 2.5 1.9 1.1 0 2-.4 2.7-1.2"></path>
      </svg>
    `,

    values: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19V9"></path>
        <path d="M12 19V5"></path>
        <path d="M19 19v-7"></path>
        <path d="M3 19h18"></path>
      </svg>
    `,

    chat: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"></path>
        <path d="M8 11h.01"></path>
        <path d="M12 11h.01"></path>
        <path d="M16 11h.01"></path>
      </svg>
    `,

    login: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2"></rect>
        <path d="M9 12h7"></path>
        <path d="m13 9 3 3-3 3"></path>
      </svg>
    `,

    users: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3"></circle>
        <path d="M3.5 19c.5-3.1 2.3-5 5.5-5s5 1.9 5.5 5"></path>
        <path d="M16 5.5a3 3 0 0 1 0 5.8"></path>
        <path d="M17 14c2.1.4 3.4 2 3.8 4"></path>
      </svg>
    `,

    total: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="M12 7v10"></path>
        <path d="M15 9.2c-.7-.7-1.6-1-2.7-1-1.4 0-2.4.7-2.4 1.8 0 1.1 1 1.6 2.6 2 1.5.4 2.4.9 2.4 2 0 1.1-1 1.9-2.5 1.9-1.2 0-2.2-.4-3-1.2"></path>
      </svg>
    `,

    online: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="3"></circle>
        <path d="M3.5 19c.5-3.1 2.3-5 5.5-5s5 1.9 5.5 5"></path>
        <path d="M17 8v6"></path>
        <path d="M14 11h6"></path>
      </svg>
    `
  };

  function installIconStyles() {
    if (el("admflip-icon-styles")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "admflip-icon-styles";

    style.textContent = `
      .admflip-icon {
        width: 17px;
        height: 17px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 17px;
        vertical-align: middle;
      }

      .admflip-icon svg {
        width: 100%;
        height: 100%;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .admflip-nav-icon {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 7px;
        vertical-align: -3px;
      }

      .admflip-nav-icon svg {
        width: 100%;
        height: 100%;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .admflip-stat-icon {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 6px;
        vertical-align: -3px;
      }

      .admflip-stat-icon svg {
        width: 100%;
        height: 100%;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .admflip-roblox-icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
        vertical-align: -3px;
        margin-right: 7px;
      }
    `;

    document.head.appendChild(style);
  }

  function makeIcon(name, className = "admflip-icon") {
    const wrapper = document.createElement("span");

    wrapper.className = className;
    wrapper.innerHTML = ICONS[name] || "";

    return wrapper;
  }

  function addButtonIcon(button, iconName) {
    if (!button || !ICONS[iconName]) {
      return;
    }

    if (button.querySelector(".admflip-nav-icon")) {
      return;
    }

    const icon = makeIcon(
      iconName,
      "admflip-nav-icon"
    );

    button.insertBefore(
      icon,
      button.firstChild
    );
  }

  function installHeaderIcons() {
    installIconStyles();

    $$(".nav-item").forEach((button) => {
      const text =
        (button.textContent || "").trim().toLowerCase();

      if (text.includes("coinflip")) {
        addButtonIcon(button, "coinflip");
      } else if (text.includes("values")) {
        addButtonIcon(button, "values");
      } else if (text.includes("chat")) {
        addButtonIcon(button, "chat");
      }
    });

    const chatButton = el("topChatButton");

    if (chatButton) {
      addButtonIcon(chatButton, "chat");
    }

    const loginButton = el("loginBtn");

    if (loginButton && !loginButton.querySelector(".roblox-login-icon")) {
      const icon = document.createElement("img");

      icon.src = ROBLOX_LOGO;
      icon.alt = "";
      icon.className = "admflip-roblox-icon roblox-login-icon";
      icon.dataset.robloxLogo = "true";

      loginButton.insertBefore(
        icon,
        loginButton.firstChild
      );

      fixImage(icon, ROBLOX_LOGO);
    }

    /*
     * Fix common stat cards.
     */
    const active = el("activeCount");

    if (active) {
      const card = active.closest(
        ".stat-card, .stat, .card, .dashboard-card"
      );

      const label =
        card?.querySelector(
          ".stat-label, .card-label, .label"
        );

      if (label && !label.querySelector(".admflip-stat-icon")) {
        label.insertBefore(
          makeIcon("coinflip", "admflip-stat-icon"),
          label.firstChild
        );
      }
    }

    const total = el("totalValue");

    if (total) {
      const card = total.closest(
        ".stat-card, .stat, .card, .dashboard-card"
      );

      const label =
        card?.querySelector(
          ".stat-label, .card-label, .label"
        );

      if (label && !label.querySelector(".admflip-stat-icon")) {
        label.insertBefore(
          makeIcon("total", "admflip-stat-icon"),
          label.firstChild
        );
      }
    }

    const online = el("coinflipOnline");

    if (online) {
      const card = online.closest(
        ".stat-card, .stat, .card, .dashboard-card"
      );

      const label =
        card?.querySelector(
          ".stat-label, .card-label, .label"
        );

      if (label && !label.querySelector(".admflip-stat-icon")) {
        label.insertBefore(
          makeIcon("online", "admflip-stat-icon"),
          label.firstChild
        );
      }
    }
  }

  /* =====================================================
     BACKGROUND
  ===================================================== */

  function installBackground() {
    if (el("admflip-background-fix")) {
      return;
    }

    const style = document.createElement("style");

    style.id = "admflip-background-fix";

    style.textContent = `
      html,
      body {
        background: #050507 !important;
        min-height: 100%;
      }

      body {
        position: relative;
        isolation: isolate;
      }

      body::before {
        content: "";
        position: fixed;
        inset: -35px;
        z-index: -3;
        pointer-events: none;

        background-image: url("/blurry.png");
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;

        filter: blur(18px);
        transform: scale(1.06);
        opacity: 0.72;
      }

      body::after {
        content: "";
        position: fixed;
        inset: 0;
        z-index: -2;
        pointer-events: none;

        background:
          linear-gradient(
            180deg,
            rgba(0, 0, 0, 0.58),
            rgba(0, 0, 0, 0.72)
          );
      }

      header,
      nav,
      main,
      section,
      article,
      .modal,
      .modal-content,
      .panel,
      .card,
      button,
      input,
      textarea,
      select,
      .chat,
      .chat-panel,
      .sidebar,
      .topbar,
      .navbar {
        position: relative;
        z-index: 1;
      }

      img {
        position: relative;
        z-index: 1;
      }
    `;

    document.head.appendChild(style);
  }

  /* =====================================================
     TOAST
  ===================================================== */

  function toast(message) {
    const box = el("toast");

    if (!box) {
      console.warn("[ADMFLIP TOAST]", message);
      return;
    }

    box.textContent = message;

    box.classList.add("show");

    clearTimeout(box._timeout);

    box._timeout = setTimeout(() => {
      box.classList.remove("show");
    }, 2800);
  }

  /* =====================================================
     API
  ===================================================== */

  async function api(path, options = {}) {
    const cleanPath =
      String(path || "").startsWith("/")
        ? String(path)
        : "/" + String(path);

    const headers = {
      Accept: "application/json"
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    if (state.token) {
      headers.Authorization =
        "Bearer " + state.token;
    }

    Object.assign(
      headers,
      options.headers || {}
    );

    let response;

    try {
      response = await fetch(
        BACKEND + cleanPath,
        {
          credentials: "include",
          cache: "no-store",
          ...options,
          headers
        }
      );
    } catch (error) {
      console.error(
        "[ADMFLIP API NETWORK]",
        error
      );

      throw new Error(
        "Cannot reach the ADMFLIP backend."
      );
    }

    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        data &&
        typeof data === "object"
          ? (
              data.message ||
              data.error ||
              data.details
            )
          : null;

      throw new Error(
        message ||
        `Request failed (${response.status})`
      );
    }

    return data;
  }

  /* =====================================================
     TOKEN
  ===================================================== */

  function saveToken(token) {
    if (!token) {
      return;
    }

    state.token = String(token);

    localStorage.setItem(
      TOKEN_KEY,
      state.token
    );
  }

  function clearToken() {
    state.token = null;

    localStorage.removeItem(
      TOKEN_KEY
    );
  }

  function restoreToken() {
    const token =
      localStorage.getItem(
        TOKEN_KEY
      );

    if (token && token.trim()) {
      state.token = token.trim();
      return true;
    }

    state.token = null;

    return false;
  }

  /* =====================================================
     NAVIGATION
  ===================================================== */

  const pages = {
    coinflip: "coinflipPage",
    values: "valuesPage",
    profile: "profilePage"
  };

  function openPage(page) {
    if (!pages[page]) {
      page = "coinflip";
    }

    state.page = page;

    Object.entries(pages).forEach(
      ([name, id]) => {
        const pageElement = el(id);

        if (!pageElement) {
          return;
        }

        pageElement.classList.toggle(
          "hidden",
          name !== page
        );
      }
    );

    $$(".nav-item").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    });

    if (page === "values") {
      loadValues();
    }

    if (page === "coinflip") {
      loadCoinflips();
    }

    if (page === "profile") {
      renderProfile();
    }

    installHeaderIcons();

    try {
      history.replaceState(
        null,
        "",
        "#" + page
      );
    } catch {}
  }

  function setupNavigation() {
    $$(".nav-item").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          if (button.id === "topChatButton") {
            toggleChat();
            return;
          }

          openPage(
            button.dataset.page
          );
        }
      );
    });

    el("brand")?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();

        openPage("coinflip");
      }
    );

    installHeaderIcons();
  }

  /* =====================================================
     ERROR
  ===================================================== */

  function renderError(
    container,
    text,
    retryFn
  ) {
    if (!container) {
      return;
    }

    container.innerHTML =
      `<div class="loading">${escapeHTML(text)}</div>` +
      (
        retryFn
          ? `<button class="retry-btn" id="retryBtn">Retry</button>`
          : ""
      );

    const btn = el("retryBtn");

    if (btn) {
      btn.addEventListener(
        "click",
        retryFn
      );
    }
  }

  /* =====================================================
     LOGIN
  ===================================================== */

  function openLogin() {
    const modal = el("loginModal");

    if (!modal) {
      return;
    }

    show(modal);

    const input = el("username");

    if (input) {
      input.value = "";

      setTimeout(
        () => input.focus(),
        50
      );
    }

    hide(el("loginProfile"));
    hide(el("phrase"));
    hide(el("verify"));

    const message = el("loginMessage");

    if (message) {
      message.textContent = "";
    }

    state.verification = null;
  }

  function closeLogin() {
    hide(el("loginModal"));
  }

  function makeVerificationPhrase() {
    const words = [
      "silver",
      "tiger",
      "nova",
      "pixel",
      "shadow",
      "comet",
      "ember",
      "frost",
      "orbit",
      "rocket",
      "storm",
      "velvet",
      "lunar",
      "cobalt",
      "sunset",
      "raven",
      "mint",
      "blaze"
    ];

    const first =
      words[
        Math.floor(
          Math.random() * words.length
        )
      ];

    const second =
      words[
        Math.floor(
          Math.random() * words.length
        )
      ];

    const number =
      Math.floor(
        1000 +
        Math.random() * 9000
      );

    return `ADMFLIP-${first}-${second}-${number}`;
  }

  async function startVerification() {
    const input = el("username");
    const message = el("loginMessage");

    if (!input) {
      return;
    }

    const username =
      input.value.trim();

    if (!username) {
      if (message) {
        message.textContent =
          "Enter your Roblox username.";
      }

      return;
    }

    if (message) {
      message.textContent =
        "Searching Roblox...";
    }

    try {
      const data = await api(
        "/user/" +
        encodeURIComponent(username)
      );

      const robloxUser = data?.user;

      if (!robloxUser?.id) {
        throw new Error(
          "Roblox user was not found."
        );
      }

      const phrase =
        makeVerificationPhrase();

      state.verification = {
        username:
          robloxUser.username ||
          username,
        robloxUser,
        phrase
      };

      renderLoginProfile(
        robloxUser
      );

      renderPhrase(
        phrase
      );

      show(el("verify"));

      if (message) {
        message.textContent =
          "Add the phrase to your Roblox About/Bio, save it, then click Verify.";
      }
    } catch (error) {
      console.error(
        "Roblox search:",
        error
      );

      if (message) {
        message.textContent =
          error.message ||
          "Unable to find that Roblox account.";
      }
    }
  }

  function renderLoginProfile(user) {
    const box = el("loginProfile");

    if (!box) {
      return;
    }

    const username =
      user.username ||
      "Roblox User";

    const id =
      user.id ||
      user.userId;

    const avatar =
      user.avatar ||
      robloxAvatar(id);

    box.innerHTML = `
      <div class="login-profile-inner">
        <img
          src="${escapeHTML(avatar)}"
          alt="${escapeHTML(username)}"
        >

        <div>
          <strong>
            ${escapeHTML(username)}
          </strong>

          <span>
            Roblox account found
          </span>
        </div>
      </div>
    `;

    show(box);

    const avatarImage =
      box.querySelector("img");

    if (avatarImage) {
      fixImage(
        avatarImage,
        ROBLOX_LOGO
      );
    }
  }

  function renderPhrase(phrase) {
    const box = el("phrase");

    if (!box) {
      return;
    }

    box.innerHTML = `
      <div class="phrase-label">
        VERIFICATION PHRASE
      </div>

      <strong>
        ${escapeHTML(phrase)}
      </strong>

      <p>
        Copy this exact phrase into
        your Roblox Profile → About/Bio.
      </p>
    `;

    show(box);
  }

  async function verifyRobloxBio() {
    const message =
      el("loginMessage");

    const button =
      el("verify");

    if (
      !state.verification ||
      !state.verification.username ||
      !state.verification.phrase
    ) {
      if (message) {
        message.textContent =
          "Search for your Roblox username first.";
      }

      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "Checking...";
    }

    if (message) {
      message.textContent =
        "Checking your Roblox bio...";
    }

    try {
      const result = await api(
        "/check",
        {
          method: "POST",

          body: JSON.stringify({
            username:
              state.verification.username,

            phrase:
              state.verification.phrase
          })
        }
      );

      if (
        !result ||
        result.success !== true
      ) {
        throw new Error(
          result?.message ||
          "Verification failed."
        );
      }

      state.user =
        result.user || null;

      if (result.token) {
        saveToken(result.token);
      }

      await loadAccount();

      updateAccountUI();

      closeLogin();

      toast(
        `Verified as ${
          state.user?.username ||
          "User"
        }`
      );

      openPage("coinflip");

      await Promise.allSettled([
        loadCoinflips(),
        loadChat()
      ]);
    } catch (error) {
      console.error(
        "Verification:",
        error
      );

      if (message) {
        message.textContent =
          error.message ||
          "Verification failed.";
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent =
          "Verify Roblox Bio";
      }
    }
  }

  /* =====================================================
     ACCOUNT
  ===================================================== */

  async function loadAccount() {
    restoreToken();

    if (!state.token) {
      state.user = null;

      updateAccountUI();

      return null;
    }

    try {
      const data =
        await api("/account");

      const account =
        data?.user;

      if (!account) {
        state.user = null;

        updateAccountUI();

        return null;
      }

      state.user = account;

      state.inventory =
        Array.isArray(account.inventory)
          ? account.inventory
          : [];

      updateAccountUI();

      return state.user;
    } catch (error) {
      console.warn(
        "[ADMFLIP] Account restore failed:",
        error.message
      );

      const message =
        String(
          error.message || ""
        ).toLowerCase();

      const authError =
        message.includes("unauthorized") ||
        message.includes("invalid token") ||
        message.includes("token expired") ||
        message.includes("not authenticated") ||
        message.includes("authentication required");

      if (authError) {
        clearToken();
      }

      state.user = null;

      updateAccountUI();

      return null;
    }
  }

  function updateAccountUI() {
    const login = el("loginBtn");
    const account = el("accountBox");

    if (!state.user) {
      show(login);
      hide(account);

      installHeaderIcons();

      return;
    }

    hide(login);
    show(account);

    const username =
      el("accountUsername");

    if (username) {
      username.textContent =
        state.user.username ||
        "User";
    }

    const avatar =
      el("accountAvatar");

    if (avatar) {
      avatar.src =
        state.user.avatar ||
        robloxAvatar(
          state.user.id
        );

      avatar.onerror = () => {
        avatar.src = ROBLOX_LOGO;
      };
    }

    installHeaderIcons();
  }

  async function logout() {
    try {
      if (state.token) {
        await api(
          "/logout",
          {
            method: "POST"
          }
        );
      }
    } catch {}

    state.user = null;
    state.inventory = [];
    state.verification = null;

    clearToken();

    updateAccountUI();

    renderProfile();

    toast("Signed out.");
  }

  /* =====================================================
     VALUES
  ===================================================== */

  async function loadValues() {
    const grid = el("valuesGrid");

    if (!grid) {
      return;
    }

    grid.innerHTML =
      `<div class="loading">Loading values...</div>`;

    try {
      const data =
        await api("/pets");

      const pets =
        Array.isArray(data)
          ? data
          : data?.pets || [];

      state.pets = pets;

      renderValues(pets);
    } catch (error) {
      console.error(
        "Values:",
        error
      );

      renderError(
        grid,
        "Values are currently unavailable.",
        loadValues
      );
    }
  }

  function renderValues(pets) {
    const grid = el("valuesGrid");

    if (!grid) {
      return;
    }

    if (!pets.length) {
      grid.innerHTML =
        `<div class="loading">No pets found.</div>`;

      return;
    }

    grid.innerHTML =
      pets.map(
        renderPetCard
      ).join("");

    fixLogoImages(grid);
  }

  function renderPetCard(pet) {
    const name = petName(pet);
    const value = petValue(pet);
    const image = petImage(pet);

    return `
      <article
        class="pet-card"
        data-pet-name="${escapeHTML(name)}"
      >
        <img
          class="pet-image"
          src="${escapeHTML(image)}"
          alt="${escapeHTML(name)}"
          loading="lazy"
        >

        <div class="pet-name">
          ${escapeHTML(name)}
        </div>

        <div class="pet-meta">
          <span>Value</span>

          <strong class="pet-value">
            ${formatValue(value)}
          </strong>
        </div>
      </article>
    `;
  }

  function setupValueSearch() {
    const input = el("valueSearch");

    if (!input) {
      return;
    }

    input.addEventListener(
      "input",
      () => {
        const query =
          input.value
            .trim()
            .toLowerCase();

        $$("#valuesGrid .pet-card")
          .forEach((card) => {
            const name =
              (
                card.dataset.petName ||
                ""
              ).toLowerCase();

            card.style.display =
              !query ||
              name.includes(query)
                ? ""
                : "none";
          });
      }
    );
  }

  /* =====================================================
     COINFLIPS
  ===================================================== */

  async function loadCoinflips() {
    const container =
      el("coinflips");

    if (!container) {
      return;
    }

    try {
      const data =
        await api("/coinflips");

      const flips =
        Array.isArray(
          data?.coinflips
        )
          ? data.coinflips
          : [];

      state.coinflips = flips;

      renderCoinflips(flips);

      const active =
        el("activeCount");

      if (active) {
        active.textContent =
          formatNumber(
            flips.length
          );
      }

      const total =
        flips.reduce(
          (sum, flip) =>
            sum +
            (
              Number(
                flip.petValue
              ) || 0
            ),
          0
        );

      const totalNode =
        el("totalValue");

      if (totalNode) {
        totalNode.textContent =
          formatValue(total);
      }

      installHeaderIcons();
    } catch (error) {
      console.error(
        "Coinflips:",
        error
      );

      renderError(
        container,
        "Unable to load coinflips.",
        loadCoinflips
      );
    }
  }

  function renderCoinflips(flips) {
    const container =
      el("coinflips");

    if (!container) {
      return;
    }

    if (!flips.length) {
      container.innerHTML =
        `<div class="loading">No active coinflips.</div>`;

      return;
    }

    container.innerHTML =
      flips.map((flip) => {
        const username =
          flip.username ||
          "User";

        const avatar =
          flip.avatar ||
          robloxAvatar(
            flip.robloxId ||
            flip.userId
          );

        const name =
          flip.petName ||
          "Pet";

        const value =
          flip.petValue ||
          0;

        const image =
          flip.image ||
          petImage({ name });

        return `
          <article
            class="coinflip-card"
            data-id="${escapeHTML(flip.id)}"
          >
            <div class="coinflip-player">

              <img
                src="${escapeHTML(avatar)}"
                alt=""
              >

              <div>
                <strong>
                  ${escapeHTML(username)}
                </strong>

                <small>
                  Coinflip
                </small>
              </div>

            </div>

            <div class="coinflip-pet">

              <img
                src="${escapeHTML(image)}"
                alt=""
              >

              <div>
                <strong>
                  ${escapeHTML(name)}
                </strong>

                <small class="muted">
                  ${formatValue(value)}
                </small>
              </div>

            </div>

            <div class="coinflip-side">
              ${escapeHTML(
                flip.side || "heads"
              )}
            </div>

          </article>
        `;
      }).join("");

    fixLogoImages(container);
  }

  /* =====================================================
     CREATE COINFLIP
  ===================================================== */

  function openCreateCoinflip() {
    if (!state.user) {
      toast(
        "Verify your Roblox account first."
      );

      openLogin();

      return;
    }

    const modal =
      el("createModal");

    show(modal);

    state.selectedPet = null;
    state.selectedSide = null;

    hide(el("sideArea"));

    $$(".side-btn").forEach(
      (button) =>
        button.classList.remove(
          "selected"
        )
    );

    loadInventory();
  }

  function closeCreateCoinflip() {
    hide(el("createModal"));
  }

  async function loadInventory() {
    const grid =
      el("createInventory");

    if (!grid) {
      return;
    }

    grid.innerHTML =
      `<div class="loading">Loading inventory...</div>`;

    try {
      const account =
        await loadAccount();

      if (!account) {
        grid.innerHTML =
          `<div class="loading">Please verify your account.</div>`;

        return;
      }

      const pets =
        Array.isArray(
          account.inventory
        )
          ? account.inventory
          : [];

      state.inventory = pets;

      if (!pets.length) {
        grid.innerHTML =
          `<div class="loading">No pets are available in your inventory.</div>`;

        return;
      }

      grid.innerHTML =
        pets.map(
          (pet, index) => `
            <article
              class="pet-card"
              data-index="${index}"
            >
              <img
                class="pet-image"
                src="${escapeHTML(
                  petImage(pet)
                )}"
                alt="${escapeHTML(
                  petName(pet)
                )}"
              >

              <div class="pet-name">
                ${escapeHTML(
                  petName(pet)
                )}
              </div>

              <div class="pet-meta">
                <span>
                  Value
                </span>

                <strong class="pet-value">
                  ${formatValue(
                    petValue(pet)
                  )}
                </strong>
              </div>
            </article>
          `
        ).join("");

      fixLogoImages(grid);

      $$("#createInventory .pet-card")
        .forEach((card) => {
          card.addEventListener(
            "click",
            () => {
              $$("#createInventory .pet-card")
                .forEach(
                  (item) =>
                    item.classList.remove(
                      "selected"
                    )
                );

              card.classList.add(
                "selected"
              );

              state.selectedPet =
                state.inventory[
                  Number(
                    card.dataset.index
                  )
                ];

              show(
                el("sideArea")
              );

              const preview =
                el("selectedPetPreview");

              if (preview) {
                preview.innerHTML = `
                  <strong>
                    Selected:
                  </strong>

                  ${escapeHTML(
                    petName(
                      state.selectedPet
                    )
                  )}

                  ·

                  ${formatValue(
                    petValue(
                      state.selectedPet
                    )
                  )}
                `;

                show(preview);
              }
            }
          );
        });
    } catch (error) {
      console.error(
        "Inventory:",
        error
      );

      renderError(
        grid,
        "Inventory unavailable.",
        loadInventory
      );
    }
  }

  function setupSideButtons() {
    $$(".side-btn").forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            $$(".side-btn")
              .forEach(
                (item) =>
                  item.classList.remove(
                    "selected"
                  )
              );

            button.classList.add(
              "selected"
            );

            state.selectedSide =
              button.dataset.side;
          }
        );
      }
    );
  }

  async function postCoinflip() {
    if (!state.user) {
      openLogin();
      return;
    }

    if (!state.selectedPet) {
      toast(
        "Select a pet first."
      );

      return;
    }

    if (!state.selectedSide) {
      toast(
        "Choose Heads or Tails."
      );

      return;
    }

    try {
      await api(
        "/coinflips",
        {
          method: "POST",

          body: JSON.stringify({
            itemId:
              state.selectedPet.id ||
              state.selectedPet.itemId,

            side:
              state.selectedSide
          })
        }
      );

      toast(
        "Coinflip created."
      );

      closeCreateCoinflip();

      await Promise.all([
        loadCoinflips(),
        loadAccount()
      ]);
    } catch (error) {
      console.error(
        "Create coinflip:",
        error
      );

      toast(
        error.message ||
        "Could not create coinflip."
      );
    }
  }

  /* =====================================================
     CHAT
  ===================================================== */

  async function loadChat() {
    try {
      const data =
        await api(
          "/chat/messages"
        );

      const messages =
        data?.messages || [];

      renderChat(messages);

      try {
        const presence =
          await api("/presence");

        const online =
          Number(
            presence?.online ??
            presence?.count ??
            presence?.onlineUsers
          );

        if (Number.isFinite(online)) {
          setOnlineCount(online);
          return;
        }
      } catch {}

      try {
        const online =
          await api(
            "/chat/online"
          );

        setOnlineCount(
          Number(
            online?.online ||
            online?.count ||
            0
          )
        );
      } catch {
        setOnlineCount(0);
      }
    } catch (error) {
      console.error(
        "Chat:",
        error
      );

      renderChat([]);

      setOnlineCount(0);
    }
  }

  function renderChat(messages) {
    const container =
      el("panelChatMessages");

    if (!container) {
      return;
    }

    if (!messages.length) {
      container.innerHTML =
        `<div class="loading">No messages yet.</div>`;

      return;
    }

    container.innerHTML =
      messages.map((message) => {
        const username =
          message.username ||
          "User";

        const avatar =
          message.avatar ||
          robloxAvatar(
            message.robloxId ||
            message.userId
          );

        const text =
          message.message || "";

        const pinned =
          Boolean(message.pinned) ||
          message.type ===
            "announcement";

        if (pinned) {
          return `
            <div class="chat-message chat-announcement">

              <div>

                <div class="chat-announcement-pin">
                  📌 PINNED
                </div>

                <div class="chat-username">
                  ${escapeHTML(username)}
                </div>

                <div class="chat-text">
                  ${escapeHTML(text)}
                </div>

              </div>

            </div>
          `;
        }

        return `
          <div class="chat-message">

            <img
              class="chat-avatar"
              src="${escapeHTML(avatar)}"
              alt=""
            >

            <div class="chat-content">

              <div class="chat-username">
                ${escapeHTML(username)}
              </div>

              <div class="chat-text">
                ${escapeHTML(text)}
              </div>

            </div>

          </div>
        `;
      }).join("");

    fixLogoImages(container);

    container.scrollTop =
      container.scrollHeight;
  }

  function setOnlineCount(count) {
    const safeCount =
      Number(count);

    const finalCount =
      Number.isFinite(safeCount)
        ? Math.max(0, safeCount)
        : 0;

    state.onlineCount =
      finalCount;

    [
      "panelOnlineCount",
      "coinflipOnline",
      "onlineCount",
      "onlineUsers",
      "chatOnlineCount"
    ].forEach((id) => {
      const node = el(id);

      if (node) {
        node.textContent =
          formatNumber(
            finalCount
          );
      }
    });

    installHeaderIcons();
  }

  async function sendChatMessage() {
    const input =
      el("panelChatInput");

    if (!input) {
      return;
    }

    const text =
      input.value.trim();

    if (!text) {
      return;
    }

    if (!state.user) {
      toast(
        "Verify your Roblox account before chatting."
      );

      openLogin();

      return;
    }

    input.disabled = true;

    try {
      await api(
        "/chat/messages",
        {
          method: "POST",

          body: JSON.stringify({
            message: text
          })
        }
      );

      input.value = "";

      await loadChat();
    } catch (error) {
      toast(
        error.message ||
        "Could not send message."
      );
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function openChat() {
    state.chatOpen = true;

    document.body.classList.add(
      "chat-open"
    );

    el("topChatButton")
      ?.classList.add(
        "active"
      );

    loadChat();
  }

  function closeChat() {
    state.chatOpen = false;

    document.body.classList.remove(
      "chat-open"
    );

    el("topChatButton")
      ?.classList.remove(
        "active"
      );
  }

  function toggleChat() {
    if (state.chatOpen) {
      closeChat();
    } else {
      openChat();
    }
  }

  /* =====================================================
     PROFILE
  ===================================================== */

  function renderProfile() {
    const container =
      el("profileContent");

    if (!container) {
      return;
    }

    if (!state.user) {
      container.innerHTML = `
        <div class="panel">

          <h2>
            Not signed in
          </h2>

          <p class="muted">
            Login with Roblox to view your profile.
          </p>

        </div>
      `;

      return;
    }

    const avatar =
      state.user.avatar ||
      robloxAvatar(
        state.user.id
      );

    const inventory =
      Array.isArray(
        state.user.inventory
      )
        ? state.user.inventory
        : [];

    container.innerHTML = `
      <div class="profile-card">

        <div class="profile-user">

          <img
            src="${escapeHTML(avatar)}"
            alt=""
          >

          <div>

            <strong>
              ${escapeHTML(
                state.user.username ||
                "User"
              )}
            </strong>

            <span>
              Roblox account verified
            </span>

          </div>

        </div>

        <div class="profile-stats">

          <div class="profile-stat">

            <span>
              TOTAL WAGERED
            </span>

            <strong>
              ${formatValue(
                state.user.wagered ||
                0
              )}
            </strong>

          </div>

          <div class="profile-stat">

            <span>
              PROFIT
            </span>

            <strong>
              ${formatValue(
                state.user.profit ||
                0
              )}
            </strong>

          </div>

          <div class="profile-stat">

            <span>
              GAMES PLAYED
            </span>

            <strong>
              ${formatNumber(
                state.user.coinflips ||
                0
              )}
            </strong>

          </div>

        </div>

        <div class="eyebrow">
          INVENTORY
        </div>

        <h2>
          Your Pets
        </h2>

        <div class="values-grid">

          ${
            inventory.length
              ? inventory
                  .map(renderPetCard)
                  .join("")
              : `
                <div class="loading">
                  No pets in your inventory.
                </div>
              `
          }

        </div>

      </div>
    `;

    fixLogoImages(container);
  }

  /* =====================================================
     EVENTS
  ===================================================== */

  function setupEvents() {
    el("loginBtn")
      ?.addEventListener(
        "click",
        openLogin
      );

    el("closeLogin")
      ?.addEventListener(
        "click",
        closeLogin
      );

    el("usernameForm")
      ?.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();

          startVerification();
        }
      );

    el("verify")
      ?.addEventListener(
        "click",
        verifyRobloxBio
      );

    el("profileBtn")
      ?.addEventListener(
        "click",
        () =>
          openPage("profile")
      );

    el("logoutBtn")
      ?.addEventListener(
        "click",
        logout
      );

    el("createCoinflipBtn")
      ?.addEventListener(
        "click",
        openCreateCoinflip
      );

    el("closeCreateModal")
      ?.addEventListener(
        "click",
        closeCreateCoinflip
      );

    el("postCoinflipBtn")
      ?.addEventListener(
        "click",
        postCoinflip
      );

    el("chatClose")
      ?.addEventListener(
        "click",
        closeChat
      );

    el("panelChatForm")
      ?.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();

          sendChatMessage();
        }
      );

    setupSideButtons();

    setupValueSearch();

    document.addEventListener(
      "click",
      (event) => {
        const target =
          event.target;

        if (
          target?.classList?.contains(
            "modal"
          )
        ) {
          target.classList.add(
            "hidden"
          );
        }
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !== "Escape"
        ) {
          return;
        }

        closeLogin();
        closeCreateCoinflip();
        closeChat();
      }
    );
  }

  /* =====================================================
     LOADING SCREEN
  ===================================================== */

  function finishLoadingScreen() {
    const screen =
      el("loadingScreen");

    if (!screen) {
      return;
    }

    setTimeout(
      () => {
        screen.classList.add(
          "is-hidden"
        );

        setTimeout(
          () => {
            screen.remove();
          },
          260
        );
      },
      700
    );
  }

  /* =====================================================
     SESSION HEARTBEAT
  ===================================================== */

  async function heartbeat() {
    if (!state.token) {
      return;
    }

    try {
      const data =
        await api("/account");

      if (data?.user) {
        state.user =
          data.user;

        state.inventory =
          Array.isArray(
            data.user.inventory
          )
            ? data.user.inventory
            : [];

        updateAccountUI();
      }
    } catch (error) {
      const message =
        String(
          error.message || ""
        ).toLowerCase();

      const authError =
        message.includes(
          "unauthorized"
        ) ||
        message.includes(
          "invalid token"
        ) ||
        message.includes(
          "token expired"
        ) ||
        message.includes(
          "not authenticated"
        ) ||
        message.includes(
          "authentication required"
        );

      if (authError) {
        clearToken();

        state.user = null;

        updateAccountUI();
      }
    }
  }

  /* =====================================================
     IMAGE OBSERVER
  ===================================================== */

  function setupImageObserver() {
    if (!window.MutationObserver) {
      return;
    }

    const observer =
      new MutationObserver(
        (mutations) => {
          mutations.forEach(
            (mutation) => {
              mutation.addedNodes.forEach(
                (node) => {
                  if (
                    node.nodeType !==
                    1
                  ) {
                    return;
                  }

                  if (
                    node.tagName ===
                    "IMG"
                  ) {
                    fixLogoImages(
                      node.parentElement ||
                      document
                    );
                  } else {
                    fixLogoImages(
                      node
                    );
                  }

                  installHeaderIcons();
                }
              );
            }
          );
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  /* =====================================================
     INITIALIZATION
  ===================================================== */

  async function init() {
    restoreToken();

    /*
     * Remove the accidental
     * "### index.html / :::writing..."
     * text from the page.
     */
    cleanDocumentLeak();

    installBackground();

    installIconStyles();

    forceMainLogo();

    setupImageObserver();

    finishLoadingScreen();

    setupNavigation();

    setupEvents();

    installHeaderIcons();

    await loadAccount();

    await Promise.allSettled([
      loadValues(),
      loadCoinflips(),
      loadChat()
    ]);

    const initial =
      location.hash
        .replace("#", "") ||
      "coinflip";

    openPage(
      pages[initial]
        ? initial
        : "coinflip"
    );

    installHeaderIcons();

    setInterval(
      () => {
        if (
          state.page ===
          "coinflip"
        ) {
          loadCoinflips();
        }

        if (
          state.chatOpen
        ) {
          loadChat();
        }

        installHeaderIcons();
      },
      5000
    );

    setInterval(
      heartbeat,
      30000
    );

    setTimeout(
      forceMainLogo,
      100
    );

    setTimeout(
      installHeaderIcons,
      100
    );

    setTimeout(
      forceMainLogo,
      500
    );

    setTimeout(
      installHeaderIcons,
      500
    );

    setTimeout(
      forceMainLogo,
      1500
    );

    setTimeout(
      installHeaderIcons,
      1500
    );
  }

  /* =====================================================
     START
  ===================================================== */

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

})();
