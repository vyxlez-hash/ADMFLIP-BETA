(() => {
  "use strict";

  /* =====================================================
     CONFIG
  ===================================================== */

  const API_BASE = "https://admflip-beta.onrender.com";

  const BACKEND = (
    new URLSearchParams(location.search).get("backend") ||
    (window.ADMFLIP_CONFIG && window.ADMFLIP_CONFIG.backend) ||
    API_BASE
  ).replace(/\/+$/, "");

  window.ADMFLIP = {
    backend: BACKEND
  };

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

    token: localStorage.getItem("admflip_token") || null
  };

  /* =====================================================
     HELPERS
  ===================================================== */

  const $ = (selector) =>
    document.querySelector(selector);

  const $$ = (selector) =>
    [...document.querySelectorAll(selector)];

  const el = (id) =>
    document.getElementById(id);

  function show(node) {
    if (node) {
      node.classList.remove("hidden");
    }
  }

  function hide(node) {
    if (node) {
      node.classList.add("hidden");
    }
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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
      return "/logo.png";
    }

    return (
      "https://www.roblox.com/headshot-thumbnail/image" +
      `?userId=${encodeURIComponent(id)}` +
      "&width=150&height=150&format=png"
    );
  }

  /*
    Safely get a coinflip's value.
    Different backend versions can use different names.
  */
  function coinflipValue(flip) {
    if (!flip || typeof flip !== "object") {
      return 0;
    }

    return (
      Number(
        flip.petValue ??
        flip.value ??
        flip.itemValue ??
        flip.normalValue ??
        flip.worth ??
        flip.price ??
        0
      ) || 0
    );
  }

  /*
    Safely get coinflip pet name.
  */
  function coinflipPetName(flip) {
    return (
      flip?.petName ||
      flip?.itemName ||
      flip?.name ||
      flip?.pet?.name ||
      flip?.item?.name ||
      "Pet"
    );
  }

  /*
    Safely get coinflip image.
  */
  function coinflipPetImage(flip) {
    if (!flip) {
      return "/logo.png";
    }

    if (
      flip.image ||
      flip.imageUrl ||
      flip.icon ||
      flip.thumbnail
    ) {
      return (
        flip.image ||
        flip.imageUrl ||
        flip.icon ||
        flip.thumbnail
      );
    }

    return petImage({
      name: coinflipPetName(flip)
    });
  }

  /* =====================================================
     TOAST
  ===================================================== */

  function toast(message) {
    const box = el("toast");

    if (!box) {
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

    const savedToken =
      localStorage.getItem("admflip_token");

    if (
      savedToken &&
      savedToken !== state.token
    ) {
      state.token = savedToken;
    }

    const headers = {
      Accept: "application/json",

      ...(options.body
        ? {
            "Content-Type": "application/json"
          }
        : {}),

      ...(state.token
        ? {
            Authorization:
              "Bearer " + state.token
          }
        : {}),

      ...(options.headers || {})
    };

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
        "ADMFLIP backend:",
        error
      );

      throw new Error(
        "Cannot reach the ADMFLIP backend."
      );
    }

    const text =
      await response.text();

    let data = null;

    try {
      data = text
        ? JSON.parse(text)
        : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        data &&
        typeof data === "object"
          ? data.message ||
            data.error
          : null;

      const error =
        new Error(
          message ||
          `Request failed (${response.status})`
        );

      error.status =
        response.status;

      throw error;
    }

    return data;
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
        const pageElement =
          el(id);

        if (!pageElement) {
          return;
        }

        pageElement.classList.toggle(
          "hidden",
          name !== page
        );
      }
    );

    $$(".nav-item").forEach(
      (button) => {
        if (
          button.id ===
          "topChatButton"
        ) {
          return;
        }

        button.classList.toggle(
          "active",
          button.dataset.page === page
        );
      }
    );

    if (page === "values") {
      loadValues();
    }

    if (page === "coinflip") {
      loadCoinflips();
    }

    if (page === "profile") {
      renderProfile();
    }

    history.replaceState(
      null,
      "",
      "#" + page
    );
  }

  function setupNavigation() {
    $$(".nav-item").forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            if (
              button.id ===
              "topChatButton"
            ) {
              toggleChat();
              return;
            }

            openPage(
              button.dataset.page
            );
          }
        );
      }
    );

    el("brand")?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();

        openPage("coinflip");
      }
    );
  }

  /* =====================================================
     HEADER CLEANUP
  ===================================================== */

  /*
    The HTML should contain the actual header buttons.
    This function ONLY removes accidental duplicates
    that may have been inserted by older versions of
    the script.

    It does NOT create new header buttons.
  */

  function cleanupDuplicateHeaderElements() {
    const logoSelectors = [
      ".site-logo",
      ".header-logo",
      ".brand-logo"
    ];

    logoSelectors.forEach(
      (selector) => {
        const nodes = $$(selector);

        if (nodes.length > 1) {
          nodes
            .slice(1)
            .forEach(
              (node) =>
                node.remove()
            );
        }
      }
    );

    const chatButtons =
      $$("#topChatButton");

    if (chatButtons.length > 1) {
      chatButtons
        .slice(1)
        .forEach(
          (node) =>
            node.remove()
        );
    }

    const loginButtons =
      $$("#loginBtn");

    if (loginButtons.length > 1) {
      loginButtons
        .slice(1)
        .forEach(
          (node) =>
            node.remove()
        );
    }

    const profileButtons =
      $$("#profileBtn");

    if (profileButtons.length > 1) {
      profileButtons
        .slice(1)
        .forEach(
          (node) =>
            node.remove()
        );
    }

    const accountBoxes =
      $$("#accountBox");

    if (accountBoxes.length > 1) {
      accountBoxes
        .slice(1)
        .forEach(
          (node) =>
            node.remove()
        );
    }
  }

  /* =====================================================
     ERRORS
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
      `<div class="loading">${escapeHTML(
        text
      )}</div>` +
      (
        retryFn
          ? `<button class="retry-btn" id="retryBtn">Retry</button>`
          : ""
      );

    const btn =
      el("retryBtn");

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
    const modal =
      el("loginModal");

    if (!modal) {
      return;
    }

    show(modal);

    const input =
      el("username");

    if (input) {
      input.value = "";

      setTimeout(
        () => input.focus(),
        50
      );
    }

    hide(
      el("loginProfile")
    );

    hide(
      el("phrase")
    );

    hide(
      el("verify")
    );

    const message =
      el("loginMessage");

    if (message) {
      message.textContent = "";
    }

    state.verification = null;
  }

  function closeLogin() {
    hide(
      el("loginModal")
    );
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
          Math.random() *
          words.length
        )
      ];

    const second =
      words[
        Math.floor(
          Math.random() *
          words.length
        )
      ];

    const number =
      Math.floor(
        1000 +
        Math.random() *
        9000
      );

    return (
      `ADMFLIP-${first}-${second}-${number}`
    );
  }

  async function startVerification() {
    const input =
      el("username");

    const message =
      el("loginMessage");

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
      const data =
        await api(
          "/user/" +
          encodeURIComponent(
            username
          )
        );

      const robloxUser =
        data?.user;

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

      show(
        el("verify")
      );

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

  function renderLoginProfile(
    user
  ) {
    const box =
      el("loginProfile");

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
          onerror="this.src='/logo.png'"
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
  }

  function renderPhrase(
    phrase
  ) {
    const box =
      el("phrase");

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

      button.textContent =
        "Checking...";
    }

    if (message) {
      message.textContent =
        "Checking your Roblox bio...";
    }

    try {
      const result =
        await api(
          "/check",
          {
            method: "POST",

            body: JSON.stringify({
              username:
                state.verification
                  .username,

              phrase:
                state.verification
                  .phrase
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

      if (result.token) {
        state.token =
          result.token;

        localStorage.setItem(
          "admflip_token",
          result.token
        );
      }

      if (result.user) {
        state.user =
          result.user;

        state.inventory =
          Array.isArray(
            result.user.inventory
          )
            ? result.user.inventory
            : [];
      }

      await loadAccount();

      if (!state.user && result.user) {
        state.user =
          result.user;

        state.inventory =
          Array.isArray(
            result.user.inventory
          )
            ? result.user.inventory
            : [];

        updateAccountUI();
      }

      updateAccountUI();

      renderProfile();

      closeLogin();

      toast(
        `Signed in as ${
          state.user?.username ||
          result.user?.username ||
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
    const savedToken =
      localStorage.getItem(
        "admflip_token"
      );

    if (savedToken) {
      state.token =
        savedToken;
    }

    if (!state.token) {
      state.user = null;

      state.inventory = [];

      updateAccountUI();

      return null;
    }

    try {
      const data =
        await api(
          "/account"
        );

      const account =
        data?.user;

      if (!account) {
        state.user = null;

        state.inventory = [];

        updateAccountUI();

        return null;
      }

      state.user =
        account;

      state.inventory =
        Array.isArray(
          account.inventory
        )
          ? account.inventory
          : [];

      localStorage.setItem(
        "admflip_token",
        state.token
      );

      updateAccountUI();

      renderProfile();

      return state.user;

    } catch (error) {
      console.error(
        "Load account:",
        error
      );

      const status =
        Number(error?.status || 0);

      const message =
        String(
          error?.message || ""
        ).toLowerCase();

      const authError =
        status === 401 ||
        message.includes(
          "unauthorized"
        ) ||
        message.includes(
          "invalid token"
        ) ||
        message.includes(
          "expired token"
        ) ||
        message.includes(
          "token expired"
        ) ||
        message.includes(
          "not authenticated"
        ) ||
        message.includes(
          "authentication required"
        ) ||
        message.includes(
          "invalid authentication"
        );

      if (authError) {
        state.user = null;

        state.inventory = [];

        state.token = null;

        localStorage.removeItem(
          "admflip_token"
        );

        updateAccountUI();

        renderProfile();
      }

      return null;
    }
  }

  function updateAccountUI() {
    const login =
      el("loginBtn");

    const account =
      el("accountBox");

    if (!login || !account) {
      return;
    }

    if (state.user) {
      hide(login);

      show(account);

      const username =
        el("accountUsername");

      if (username) {
        username.textContent =
          state.user.username ||
          state.user.name ||
          "User";
      }

      const avatar =
        el("accountAvatar");

      if (avatar) {
        avatar.src =
          state.user.avatar ||
          state.user.avatarUrl ||
          robloxAvatar(
            state.user.id ||
            state.user.userId
          );

        avatar.onerror = () => {
          avatar.src =
            "/logo.png";
        };
      }

      return;
    }

    show(login);

    hide(account);
  }

  async function logout() {
    try {
      await api(
        "/logout",
        {
          method: "POST"
        }
      );
    } catch (error) {
      console.warn(
        "Logout backend:",
        error
      );
    }

    state.user = null;

    state.inventory = [];

    state.verification = null;

    state.token = null;

    localStorage.removeItem(
      "admflip_token"
    );

    updateAccountUI();

    renderProfile();

    toast(
      "Signed out."
    );
  }

  /* =====================================================
     VALUES
  ===================================================== */

  async function loadValues() {
    const grid =
      el("valuesGrid");

    if (!grid) {
      return;
    }

    grid.innerHTML =
      `<div class="loading">Loading values...</div>`;

    try {
      const data =
        await api(
          "/pets"
        );

      const pets =
        Array.isArray(data)
          ? data
          : data?.pets || [];

      state.pets =
        pets;

      renderValues(
        pets
      );

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

  function renderValues(
    pets
  ) {
    const grid =
      el("valuesGrid");

    if (!grid) {
      return;
    }

    if (!pets.length) {
      grid.innerHTML =
        `<div class="loading">No pets found.</div>`;

      return;
    }

    grid.innerHTML =
      pets
        .map(
          renderPetCard
        )
        .join("");
  }

  function renderPetCard(
    pet
  ) {
    const name =
      petName(pet);

    const value =
      petValue(pet);

    const image =
      petImage(pet);

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
          onerror="if(!this.dataset.failed){this.dataset.failed='1';this.src='/logo.png';}"
        >

        <div class="pet-name">
          ${escapeHTML(name)}
        </div>

        <div class="pet-meta">

          <span>
            Value
          </span>

          <strong class="pet-value">
            ${formatValue(value)}
          </strong>

        </div>

      </article>
    `;
  }

  function setupValueSearch() {
    const input =
      el("valueSearch");

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
          .forEach(
            (card) => {
              const name =
                (
                  card.dataset
                    .petName || ""
                ).toLowerCase();

              card.style.display =
                !query ||
                name.includes(
                  query
                )
                  ? ""
                  : "none";
            }
          );
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
        await api(
          "/coinflips"
        );

      const flips =
        Array.isArray(data)
          ? data
          : data?.coinflips || [];

      state.coinflips =
        flips;

      renderCoinflips(
        flips
      );

      const active =
        el("activeCount");

      if (active) {
        active.textContent =
          formatNumber(
            flips.length
          );
      }

      /*
        IMPORTANT:
        Calculate total using the same
        normalized value helper used by
        the cards.
      */
      const total =
        flips.reduce(
          (sum, flip) => {
            return (
              sum +
              coinflipValue(flip)
            );
          },
          0
        );

      const totalNode =
        el("totalValue");

      if (totalNode) {
        totalNode.textContent =
          formatValue(total);
      }

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

  function renderCoinflips(
    flips
  ) {
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
      flips
        .map(
          (flip) => {
            const username =
              flip.username ||
              flip.user?.username ||
              "User";

            const avatar =
              flip.avatar ||
              flip.avatarUrl ||
              flip.user?.avatar ||
              robloxAvatar(
                flip.userId ||
                flip.user?.id
              );

            const name =
              coinflipPetName(
                flip
              );

            const value =
              coinflipValue(
                flip
              );

            const image =
              coinflipPetImage(
                flip
              );

            const side =
              String(
                flip.side ||
                "heads"
              ).toLowerCase();

            /*
              Use a consistent class and
              icon for Heads/Tails.
            */
            const sideLabel =
              side === "tails"
                ? "T"
                : "H";

            const sideClass =
              side === "tails"
                ? "tails"
                : "heads";

            return `
              <article
                class="coinflip-card"
                data-id="${escapeHTML(
                  flip.id ||
                  flip._id ||
                  ""
                )}"
              >

                <div class="coinflip-player">

                  <img
                    src="${escapeHTML(avatar)}"
                    alt=""
                    onerror="this.src='/logo.png'"
                  >

                  <div>

                    <strong>
                      ${escapeHTML(
                        username
                      )}
                    </strong>

                    <small>
                      Coinflip
                    </small>

                  </div>

                </div>

                <div class="coinflip-pet">

                  <img
                    src="${escapeHTML(image)}"
                    alt="${escapeHTML(name)}"
                    onerror="this.src='/logo.png'"
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

                <div
                  class="coinflip-value"
                  title="Coinflip value"
                >
                  <span class="value-icon">
                    $
                  </span>

                  <strong>
                    ${formatValue(value)}
                  </strong>
                </div>

                <div
                  class="coinflip-side ${sideClass}"
                  title="${escapeHTML(
                    side
                  )}"
                >
                  <span class="side-letter">
                    ${sideLabel}
                  </span>

                  <span class="side-name">
                    ${escapeHTML(
                      side === "tails"
                        ? "Tails"
                        : "Heads"
                    )}
                  </span>
                </div>

              </article>
            `;
          }
        )
        .join("");
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

    state.selectedPet =
      null;

    state.selectedSide =
      null;

    hide(
      el("sideArea")
    );

    hide(
      el("selectedPetPreview")
    );

    $$(".side-btn").forEach(
      (button) =>
        button.classList.remove(
          "selected"
        )
    );

    loadInventory();
  }

  function closeCreateCoinflip() {
    hide(
      el("createModal")
    );
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

      state.inventory =
        pets;

      if (!pets.length) {
        grid.innerHTML =
          `<div class="loading">No pets are available in your inventory.</div>`;

        return;
      }

      grid.innerHTML =
        pets
          .map(
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
                  onerror="this.src='/logo.png'"
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
          )
          .join("");

      $$("#createInventory .pet-card")
        .forEach(
          (card) => {
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
                      card.dataset
                        .index
                    )
                  ];

                show(
                  el("sideArea")
                );

                const preview =
                  el(
                    "selectedPetPreview"
                  );

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
          }
        );

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

      renderChat(
        messages
      );

      try {
        const online =
          await api(
            "/chat/online"
          );

        setOnlineCount(
          online?.online ||
          0
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
    }
  }

  function renderChat(
    messages
  ) {
    const container =
      el(
        "panelChatMessages"
      );

    if (!container) {
      return;
    }

    if (!messages.length) {
      container.innerHTML =
        `<div class="loading">No messages yet.</div>`;

      return;
    }

    container.innerHTML =
      messages
        .map(
          (message) => {
            const username =
              message.username ||
              "User";

            const avatar =
              message.avatar ||
              robloxAvatar(
                message.userId
              );

            const text =
              message.message ||
              "";

            const pinned =
              Boolean(
                message.pinned
              ) ||
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
                      ${escapeHTML(
                        username
                      )}
                    </div>

                    <div class="chat-text">
                      ${escapeHTML(
                        text
                      )}
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
                  onerror="this.src='/logo.png'"
                >

                <div class="chat-content">

                  <div class="chat-username">
                    ${escapeHTML(
                      username
                    )}
                  </div>

                  <div class="chat-text">
                    ${escapeHTML(
                      text
                    )}
                  </div>

                </div>

              </div>
            `;
          }
        )
        .join("");

    container.scrollTop =
      container.scrollHeight;
  }

  function setOnlineCount(
    count
  ) {
    const node =
      el(
        "panelOnlineCount"
      );

    if (node) {
      node.textContent =
        formatNumber(count);
    }

    const coinflipOnline =
      el(
        "coinflipOnline"
      );

    if (coinflipOnline) {
      coinflipOnline.textContent =
        formatNumber(count);
    }
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
    state.chatOpen =
      true;

    document.body.classList.add(
      "chat-open"
    );

    el(
      "topChatButton"
    )?.classList.add(
      "active"
    );

    loadChat();
  }

  function closeChat() {
    state.chatOpen =
      false;

    document.body.classList.remove(
      "chat-open"
    );

    el(
      "topChatButton"
    )?.classList.remove(
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
      el(
        "profileContent"
      );

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
      state.user.avatarUrl ||
      robloxAvatar(
        state.user.id ||
        state.user.userId
      );

    const inventory =
      Array.isArray(
        state.user.inventory
      )
        ? state.user.inventory
        : state.inventory || [];

    container.innerHTML = `
      <div class="profile-card">

        <div class="profile-user">

          <img
            src="${escapeHTML(avatar)}"
            alt=""
            onerror="this.src='/logo.png'"
          >

          <div>

            <strong>
              ${escapeHTML(
                state.user.username ||
                state.user.name ||
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
                  .map(
                    renderPetCard
                  )
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
        () => {
          openPage(
            "profile"
          );
        }
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
          event.key !==
          "Escape"
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
     INIT
  ===================================================== */

  async function init() {
    finishLoadingScreen();

    /*
      Remove duplicate elements left by
      previous versions without creating
      additional header elements.
    */
    cleanupDuplicateHeaderElements();

    setupNavigation();

    setupEvents();

    /*
      Restore account before the rest of
      the website loads.
    */
    await loadAccount();

    await Promise.allSettled([
      loadValues(),
      loadCoinflips(),
      loadChat()
    ]);

    const initial =
      location.hash.replace(
        "#",
        ""
      ) || "coinflip";

    openPage(
      pages[initial]
        ? initial
        : "coinflip"
    );

    /*
      Refresh live data without touching
      authentication state.
    */
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
      },
      5000
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
      init
    );
  } else {
    init();
  }

})();
