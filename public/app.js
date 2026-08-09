(() => {
  "use strict";

  /*
    ============================================================
    ADMFLIP FRONTEND
    ============================================================

    IMPORTANT:
    The browser talks to THIS Render website.

    Roblox requests are handled by server.js.
    The browser never directly calls users.roblox.com.

    Your backend already provides:

      GET  /pets
      GET  /user/:username
      POST /check
      GET  /account/:robloxId
      GET  /coinflips
      POST /coinflips
      GET  /leaderboard
      GET  /chat/messages
      POST /chat/messages
      GET  /chat/online
  */

  const BACKEND = "";

  const state = {
    page: "coinflip",

    user: null,

    verification: null,

    pets: [],

    selectedPet: null,

    selectedSide: null,

    coinflips: [],

    chatOpen: false
  };


  /* ============================================================
     DOM HELPERS
  ============================================================ */

  const $ = selector =>
    document.querySelector(selector);

  const $$ = selector =>
    [...document.querySelectorAll(selector)];

  const el = id =>
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
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "0";
    }

    return number.toLocaleString();
  }


  function formatValue(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "0";
    }

    if (number >= 1000000000) {
      return (
        (number / 1000000000)
          .toFixed(number >= 10000000000 ? 0 : 1)
        + "B"
      );
    }

    if (number >= 1000000) {
      return (
        (number / 1000000)
          .toFixed(number >= 10000000 ? 0 : 1)
        + "M"
      );
    }

    if (number >= 1000) {
      return (
        (number / 1000)
          .toFixed(number >= 100000 ? 0 : 1)
        + "K"
      );
    }

    return number.toLocaleString();
  }


  /* ============================================================
     PET HELPERS
  ============================================================ */

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

    return Number(
      pet?.value ??
      pet?.normalValue ??
      pet?.worth ??
      pet?.price ??
      0
    ) || 0;
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


  /* ============================================================
     TOAST
  ============================================================ */

  function toast(message) {

    const box = el("toast");

    if (!box) {
      return;
    }

    box.textContent = message;

    box.classList.add("show");

    clearTimeout(box._timeout);

    box._timeout =
      setTimeout(() => {
        box.classList.remove("show");
      }, 2500);
  }


  /* ============================================================
     API
  ============================================================ */

  async function api(path, options = {}) {

    const cleanPath =
      String(path || "").startsWith("/")
        ? String(path)
        : "/" + String(path);


    let response;

    try {

      response =
        await fetch(
          BACKEND + cleanPath,
          {
            credentials: "include",
            cache: "no-store",
            ...options,

            headers: {

              ...(options.body
                ? {
                    "Content-Type":
                      "application/json"
                  }
                : {}),

              ...(options.headers || {})
            }
          }
        );

    } catch (error) {

      console.error(
        "ADMFLIP API connection error:",
        error
      );

      throw new Error(
        "Backend is unreachable. Refresh the page and try again."
      );
    }


    const text =
      await response.text();


    let data = null;


    try {

      data =
        text
          ? JSON.parse(text)
          : null;

    } catch {

      data = text;
    }


    if (!response.ok) {

      const message =
        data &&
        typeof data === "object"
          ? (
              data.message ||
              data.error
            )
          : null;


      throw new Error(
        message ||
        `Request failed (${response.status})`
      );
    }


    return data;
  }


  /* ============================================================
     PAGES
  ============================================================ */

  const pages = {

    coinflip:
      "coinflipPage",

    leaderboard:
      "leaderboardPage",

    values:
      "valuesPage",

    chat:
      "chatPage",

    profile:
      "profilePage"
  };


  function openPage(page) {

    if (!pages[page]) {
      page = "coinflip";
    }


    state.page = page;


    Object.entries(pages)
      .forEach(
        ([name, id]) => {

          const node =
            el(id);

          if (node) {

            node.classList.toggle(
              "hidden",
              name !== page
            );

          }

        }
      );


    $$(".nav-item")
      .forEach(
        button => {

          button.classList.toggle(
            "active",
            button.dataset.page === page
          );

        }
      );


    if (page === "coinflip") {
      loadCoinflips();
    }


    if (page === "values") {
      loadValues();
    }


    if (page === "leaderboard") {
      loadLeaderboard();
    }


    if (page === "chat") {
      loadChat();
    }


    if (page === "profile") {
      renderProfile();
    }


    if (
      location.hash !==
      "#" + page
    ) {

      history.replaceState(
        null,
        "",
        "#" + page
      );

    }
  }


  function setupNavigation() {

    $$(".nav-item")
      .forEach(
        button => {

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


    $$(".brand")
      .forEach(
        brand => {

          brand.addEventListener(
            "click",
            event => {

              event.preventDefault();

              openPage("coinflip");

            }
          );

        }
      );


    window.addEventListener(
      "hashchange",
      () => {

        const page =
          location.hash
            .replace("#", "") ||
          "coinflip";


        if (page === "chat") {

          history.replaceState(
            null,
            "",
            location.pathname +
            location.search
          );

          openPage("coinflip");

          openChat();

          return;
        }


        if (pages[page]) {
          openPage(page);
        }

      }
    );


    const initial =
      location.hash
        .replace("#", "") ||
      "coinflip";


    openPage(
      pages[initial] &&
      initial !== "chat"
        ? initial
        : "coinflip"
    );
  }


  /* ============================================================
     LOGIN
  ============================================================ */

  function openLogin() {

    const modal =
      el("loginModal");


    if (!modal) {

      console.error(
        "loginModal is missing from index.html"
      );

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


    const verify =
      el("verify");


    if (verify) {

      verify.style.display =
        "none";

      verify.disabled =
        false;

      verify.textContent =
        "Verify";
    }


    const message =
      el("loginMessage");


    if (message) {
      message.textContent = "";
    }


    setupLoginEvents();
  }


  function closeLogin() {

    closeModal(
      "loginModal"
    );
  }


  let loginEventsBound =
    false;


  function setupLoginEvents() {

    if (loginEventsBound) {
      return;
    }


    loginEventsBound =
      true;


    el("closeLogin")
      ?.addEventListener(
        "click",
        closeLogin
      );


    el("username")
      ?.addEventListener(
        "keydown",
        event => {

          if (
            event.key ===
            "Enter"
          ) {

            event.preventDefault();

            startVerification();
          }

        }
      );


    el("continueLogin")
      ?.addEventListener(
        "click",
        startVerification
      );


    el("startLogin")
      ?.addEventListener(
        "click",
        startVerification
      );


    el("verify")
      ?.addEventListener(
        "click",
        verifyRobloxBio
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
      "maple",
      "swift",
      "cosmic",
      "prism",
      "thunder",
      "cobalt",
      "sunset",
      "raven",
      "mint",
      "blaze"

    ];


    const randomWord =
      () =>
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
      "admflip-" +
      randomWord() +
      "-" +
      randomWord() +
      "-" +
      number
    );
  }


  /* ============================================================
     ROBLOX LOOKUP
     ============================================================

     THIS IS THE IMPORTANT FIX.

     Do NOT call users.roblox.com from the browser.

     Your server already has:

       GET /user/:username

     and the server contacts Roblox.
  ============================================================ */

  async function robloxLookup(
    username
  ) {

    const clean =
      String(username || "")
        .trim();


    if (!clean) {

      throw new Error(
        "Enter your Roblox username."
      );
    }


    const data =
      await api(
        "/user/" +
        encodeURIComponent(clean)
      );


    if (
      !data ||
      data.success === false
    ) {

      throw new Error(
        data?.message ||
        "Roblox username not found."
      );
    }


    const user =
      data.user ||
      data.data ||
      data;


    if (!user?.id) {

      throw new Error(
        "Roblox returned an invalid user."
      );
    }


    return {

      id:
        user.id,

      username:
        user.username ||
        user.name ||
        clean,

      avatar:
        user.avatar ||
        ""

    };
  }


  /* ============================================================
     START LOGIN / ROBLOX SEARCH
  ============================================================ */

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


    const startButtons = [

      el("continueLogin"),

      el("startLogin")

    ].filter(Boolean);


    startButtons.forEach(
      button => {
        button.disabled = true;
      }
    );


    try {

      const user =
        await robloxLookup(
          username
        );


      state.verification = {

        username:
          user.username,

        robloxUser:
          user,

        phrase:
          makeVerificationPhrase()

      };


      renderLoginProfile(
        user
      );


      renderPhrase(
        state.verification.phrase
      );


      const verify =
        el("verify");


      if (verify) {

        verify.style.display =
          "block";

        verify.disabled =
          false;

        verify.textContent =
          "Verify";

      }


      if (message) {

        message.textContent =
          "Add the exact phrase to your Roblox About/Bio, save it, then click Verify.";

      }


    } catch (error) {

      console.error(
        "ADMFLIP Roblox lookup:",
        error
      );


      if (message) {

        message.textContent =
          error.message ||
          "Unable to find that Roblox account.";

      }


    } finally {

      startButtons.forEach(
        button => {
          button.disabled = false;
        }
      );

    }
  }


  /* ============================================================
     LOGIN PROFILE
  ============================================================ */

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


    const avatar =
      user.avatar ||
      (
        user.id
          ? (
              "https://www.roblox.com/headshot-thumbnail/image" +
              "?userId=" +
              encodeURIComponent(user.id) +
              "&width=150&height=150&format=png"
            )
          : "/logo.png"
      );


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


  /* ============================================================
     VERIFICATION PHRASE
  ============================================================ */

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
        Copy this exact phrase into your Roblox profile About/Bio.
      </p>

    `;


    show(box);
  }


  /* ============================================================
     VERIFY BIO
     ============================================================

     THIS ALSO USES THE BACKEND.

     The browser does NOT contact Roblox directly.

     POST /check
  ============================================================ */

  async function verifyRobloxBio() {

    const message =
      el("loginMessage");


    const button =
      el("verify");


    if (
      !state.verification?.username ||
      !state.verification?.phrase
    ) {

      if (message) {

        message.textContent =
          "Search for your Roblox username first.";

      }

      return;
    }


    if (button) {

      button.disabled =
        true;

      button.textContent =
        "Checking...";

    }


    if (message) {

      message.textContent =
        "Checking your Roblox profile bio...";

    }


    try {

      const result =
        await api(
          "/check",
          {
            method: "POST",

            body:
              JSON.stringify({

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


      state.user = {

        id:
          result.id ||
          state.verification.robloxUser.id,

        username:
          result.username ||
          state.verification.username,

        avatar:
          result.avatar ||
          state.verification.robloxUser.avatar ||
          "",

        verified:
          true,

        wagered: 0,

        profit: 0,

        coinflips: 0,

        wins: 0

      };


      /*
        Load the actual account from MongoDB.
      */

      try {

        await loadAccount();

      } catch (error) {

        console.warn(
          "Account data could not be loaded yet:",
          error
        );

      }


      saveUser();

      updateAccountUI();


      closeModal(
        "loginModal"
      );


      toast(
        "Verified as " +
        state.user.username
      );


      await Promise.allSettled([

        loadCoinflips(),

        loadChat()

      ]);


      renderProfile();


    } catch (error) {

      console.error(
        "ADMFLIP verification:",
        error
      );


      if (message) {

        message.textContent =
          error.message ||
          "Verification failed.";

      }


    } finally {

      if (button) {

        button.disabled =
          false;

        button.textContent =
          "Verify";

      }

    }
  }


  /* ============================================================
     ACCOUNT STORAGE
  ============================================================ */

  function saveUser() {

    try {

      localStorage.setItem(
        "admflip_user",
        JSON.stringify(
          state.user
        )
      );

    } catch {}
  }


  function loadSavedUser() {

    try {

      const saved =
        localStorage.getItem(
          "admflip_user"
        );


      if (saved) {

        state.user =
          JSON.parse(saved);

      }

    } catch {

      state.user =
        null;

    }


    updateAccountUI();


    /*
      Refresh saved account information.
    */

    if (state.user?.id) {

      loadAccount()
        .catch(() => {});

    }
  }


  async function loadAccount() {

    if (!state.user?.id) {
      return null;
    }


    const data =
      await api(
        "/account/" +
        encodeURIComponent(
          state.user.id
        )
      );


    const account =
      data?.user ||
      data?.account ||
      data?.data;


    if (!account) {

      throw new Error(
        "Account data unavailable."
      );
    }


    state.user = {

      ...state.user,

      ...account,

      id:
        account.id ||
        account.robloxId ||
        state.user.id,

      username:
        account.username ||
        state.user.username,

      avatar:
        account.avatar ||
        state.user.avatar ||
        ""

    };


    saveUser();

    updateAccountUI();

    renderProfile();


    return account;
  }


  function updateAccountUI() {

    const login =
      el("loginBtn");


    const account =
      el("accountBox");


    if (!state.user) {

      show(login);

      hide(account);

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
        (
          state.user.id
            ? (
                "https://www.roblox.com/headshot-thumbnail/image" +
                "?userId=" +
                encodeURIComponent(
                  state.user.id
                ) +
                "&width=150&height=150&format=png"
              )
            : "/logo.png"
        );

    }
  }


  function logout() {

    state.user =
      null;

    state.verification =
      null;


    try {

      localStorage.removeItem(
        "admflip_user"
      );

    } catch {}


    updateAccountUI();

    renderProfile();

    toast(
      "Signed out."
    );
  }


  function setupAccount() {

    el("loginBtn")
      ?.addEventListener(
        "click",
        openLogin
      );


    el("inventoryBtn")
      ?.addEventListener(
        "click",
        openInventory
      );


    el("logoutBtn")
      ?.addEventListener(
        "click",
        logout
      );


    el("profileBtn")
      ?.addEventListener(
        "click",
        () =>
          openPage("profile")
      );
  }


  /* ============================================================
     VALUES
  ============================================================ */

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
          : (
              data?.pets ||
              data?.values ||
              data?.items ||
              data?.data ||
              []
            );


      state.pets =
        pets;


      renderValues(
        pets
      );


    } catch (error) {

      console.error(
        "ADMFLIP values:",
        error
      );


      grid.innerHTML =
        `<div class="loading">Values are currently unavailable.</div>`;
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


    if (
      !Array.isArray(pets) ||
      pets.length === 0
    ) {

      grid.innerHTML =
        `<div class="loading">No pets found.</div>`;

      return;
    }


    grid.innerHTML =
      pets
        .map(
          petCard
        )
        .join("");
  }


  function petCard(
    pet
  ) {

    const name =
      petName(pet);


    const image =
      petImage(pet);


    const value =
      petValue(pet);


    const rarity =
      pet?.rarity ||
      pet?.type ||
      "";


    return `

      <article
        class="pet-card"
        data-pet-name="${escapeHTML(
          name
        )}"
      >

        <img
          class="pet-image"
          src="${escapeHTML(image)}"
          alt="${escapeHTML(name)}"
          loading="lazy"
          onerror="
            if(!this.dataset.failed){
              this.dataset.failed='1';
              this.src='/logo.png';
            }
          "
        >


        <div class="pet-name">
          ${escapeHTML(name)}
        </div>


        ${
          rarity
            ? `
              <div class="pet-rarity">
                ${escapeHTML(rarity)}
              </div>
            `
            : ""
        }


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
            card => {

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

            }
          );
      }
    );
  }


  /* ============================================================
     COINFLIPS
  ============================================================ */

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
          : (
              data?.coinflips ||
              data?.flips ||
              data?.data ||
              []
            );


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


      let total =
        0;


      flips.forEach(
        flip => {

          const pet =
            flip.pet ||
            flip.item ||
            {};


          const raw =
            flip.totalValue ??
            flip.value ??
            flip.petValue ??
            pet.value ??
            pet.val ??
            0;


          const value =
            Number(
              String(raw)
                .replace(
                  /[^0-9.-]/g,
                  ""
                )
            );


          if (
            Number.isFinite(
              value
            )
          ) {

            total += value;

          }

        }
      );


      const totalNode =
        el("totalValue");


      if (totalNode) {

        totalNode.textContent =
          formatValue(total);

        totalNode.title =
          total.toLocaleString() +
          " total value";

      }


      const online =
        data?.coinflippingNow ??
        data?.coinflipping ??
        data?.online ??
        data?.onlineCount ??
        flips.length;


      const onlineNode =
        el("coinflipOnline");


      if (onlineNode) {

        onlineNode.textContent =
          formatNumber(
            online
          );
      }


    } catch (error) {

      console.error(
        "ADMFLIP coinflips:",
        error
      );


      container.innerHTML =
        `<div class="loading">Unable to load coinflips right now.</div>`;


      const active =
        el("activeCount");


      const total =
        el("totalValue");


      if (active) {
        active.textContent = "0";
      }


      if (total) {
        total.textContent = "0";
      }
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


    if (
      !Array.isArray(flips) ||
      flips.length === 0
    ) {

      container.innerHTML =
        `<div class="loading">No active coinflips.</div>`;

      return;
    }


    container.innerHTML =
      flips
        .map(
          flip => {

            const username =
              flip.username ||
              flip.user?.username ||
              flip.creatorUsername ||
              "Player";


            const pet =
              flip.pet ||
              flip.item ||
              {

                name:
                  flip.petName ||
                  "Pet",

                value:
                  flip.petValue ||
                  0,

                image:
                  flip.image ||
                  ""

              };


            const side =
              flip.side ||
              "heads";


            const image =
              petImage(pet);


            const name =
              petName(pet);


            const value =
              petValue(pet);


            return `

              <article class="coinflip">

                <div class="cf-users">

                  <span>
                    ${escapeHTML(username)}
                  </span>

                  <span>
                    ${escapeHTML(side)}
                  </span>

                </div>


                <div class="cf-body">

                  <div class="cf-side">

                    <div class="cf-pet">

                      <img
                        src="${escapeHTML(image)}"
                        alt="${escapeHTML(name)}"
                        onerror="this.src='/logo.png'"
                      >

                      <div>

                        <b>
                          ${escapeHTML(name)}
                        </b>

                        <small>
                          Value:
                          ${formatValue(value)}
                        </small>

                      </div>

                    </div>

                  </div>


                  <div class="cf-center">

                    <div class="coin">
                      FLIP
                    </div>

                    <small>
                      Waiting
                    </small>

                  </div>


                  <div class="cf-side">

                    <div class="cf-pet">

                      <div class="waiting-icon">
                        ?
                      </div>

                      <div>

                        <b>
                          Waiting for player
                        </b>

                        <small>
                          Join this flip
                        </small>

                      </div>

                    </div>

                  </div>

                </div>

              </article>

            `;

          }
        )
        .join("");
  }


  /* ============================================================
     CREATE COINFLIP
  ============================================================ */

  function setupCreateCoinflip() {

    el("createCoinflipBtn")
      ?.addEventListener(
        "click",
        openCreate
      );
  }


  async function openCreate() {

    if (!state.user) {

      toast(
        "Verify your Roblox account first."
      );

      openLogin();

      return;
    }


    const modal =
      createModal(
        "createModal",
        `

          <div class="modal-box large">

            <button
              id="closeCreate"
              class="modal-close"
              type="button"
            >
              ×
            </button>


            <div class="eyebrow">
              NEW FLIP
            </div>


            <h2>
              Create Coinflip
            </h2>


            <p class="muted">
              Select a pet and choose your side.
            </p>


            <div
              id="createInventory"
              class="pet-grid"
            >
              <div class="loading">
                Loading...
              </div>
            </div>


            <div
              id="sideArea"
              class="side-area hidden"
            >

              <h3>
                Choose your side
              </h3>


              <div class="side-buttons">

                <button
                  class="side-btn"
                  data-side="heads"
                  type="button"
                >
                  <span>H</span>
                  HEADS
                </button>


                <button
                  class="side-btn"
                  data-side="tails"
                  type="button"
                >
                  <span>T</span>
                  TAILS
                </button>

              </div>


              <button
                id="postCoinflip"
                class="primary full"
                type="button"
              >
                Post Coinflip
              </button>

            </div>

          </div>

        `
      );


    show(modal);


    state.selectedPet =
      null;


    state.selectedSide =
      null;


    el("closeCreate")
      ?.addEventListener(
        "click",
        () =>
          closeModal(
            "createModal"
          )
      );


    $$("#createModal .side-btn")
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              $$("#createModal .side-btn")
                .forEach(
                  x =>
                    x.classList.remove(
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


    el("postCoinflip")
      ?.addEventListener(
        "click",
        postCoinflip
      );


    try {

      const userId =
        state.user.id ||
        state.user.userId;


      const data =
        await api(
          "/account/" +
          encodeURIComponent(
            userId
          )
        );


      const account =
        data?.user ||
        data?.account ||
        data?.data;


      const pets =
        account?.inventory ||
        data?.pets ||
        data?.inventory ||
        data?.items ||
        [];


      renderCreateInventory(
        pets
      );


    } catch (error) {

      console.error(
        "ADMFLIP inventory:",
        error
      );


      const grid =
        el("createInventory");


      if (grid) {

        grid.innerHTML =
          `<div class="loading">Inventory unavailable.</div>`;

      }
    }
  }


  function renderCreateInventory(
    pets
  ) {

    const grid =
      el("createInventory");


    if (!grid) {
      return;
    }


    if (
      !Array.isArray(pets) ||
      pets.length === 0
    ) {

      grid.innerHTML =
        `<div class="loading">No pets available.</div>`;

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
        card => {

          card.addEventListener(
            "click",
            () => {

              $$("#createInventory .pet-card")
                .forEach(
                  x =>
                    x.classList.remove(
                      "selected"
                    )
                );


              card.classList.add(
                "selected"
              );


              state.selectedPet =
                pets[
                  Number(
                    card.dataset.index
                  )
                ];


              show(
                el("sideArea")
              );

            }
          );

        }
      );
  }


  async function postCoinflip() {

    if (!state.selectedPet) {

      toast(
        "Select a pet first."
      );

      return;
    }


    if (!state.selectedSide) {

      toast(
        "Choose heads or tails."
      );

      return;
    }


    try {

      await api(
        "/coinflips",
        {

          method:
            "POST",

          body:
            JSON.stringify({

              username:
                state.user.username,

              userId:
                state.user.id ||
                state.user.userId,

              robloxId:
                state.user.id ||
                state.user.userId,

              pet:
                state.selectedPet,

              petName:
                petName(
                  state.selectedPet
                ),

              side:
                state.selectedSide

            })
        }
      );


      toast(
        "Coinflip created."
      );


      closeModal(
        "createModal"
      );


      await loadCoinflips();


    } catch (error) {

      console.error(
        "ADMFLIP create coinflip:",
        error
      );


      toast(
        error.message ||
        "Could not create coinflip."
      );
    }
  }


  /* ============================================================
     LEADERBOARD
  ============================================================ */

  async function loadLeaderboard() {

    const container =
      el("leaderboard");


    if (!container) {
      return;
    }


    container.innerHTML =
      `<div class="loading">Loading leaderboard...</div>`;


    try {

      const data =
        await api(
          "/leaderboard"
        );


      const players =
        Array.isArray(data)
          ? data
          : (
              data?.users ||
              data?.players ||
              data?.leaderboard ||
              data?.data ||
              []
            );


      renderLeaderboard(
        players
      );


    } catch (error) {

      console.error(
        "ADMFLIP leaderboard:",
        error
      );


      container.innerHTML =
        `<div class="loading">Leaderboard unavailable.</div>`;
    }
  }


  function renderLeaderboard(
    players
  ) {

    const container =
      el("leaderboard");


    if (!container) {
      return;
    }


    if (
      !Array.isArray(players) ||
      players.length === 0
    ) {

      container.innerHTML =
        `<div class="loading">No leaderboard data yet.</div>`;

      return;
    }


    container.innerHTML =
      players
        .map(
          (player, index) => {

            const username =
              player.username ||
              player.name ||
              "User";


            const avatar =
              player.avatar ||
              "/logo.png";


            const wagered =
              player.wagered ??
              player.total ??
              player.value ??
              0;


            return `

              <div class="rank-row">

                <div class="rank">
                  #${index + 1}
                </div>


                <div class="rank-player">

                  <img
                    src="${escapeHTML(avatar)}"
                    alt=""
                    onerror="this.src='/logo.png'"
                  >


                  <div>

                    <strong>
                      ${escapeHTML(username)}
                    </strong>

                    <small>
                      Trader
                    </small>

                  </div>

                </div>


                <div class="rank-value">
                  ${formatValue(wagered)}
                </div>

              </div>

            `;

          }
        )
        .join("");
  }


  /* ============================================================
     CHAT
  ============================================================ */

  async function loadChat() {

    try {

      const data =
        await api(
          "/chat/messages"
        );


      const messages =
        Array.isArray(data)
          ? data
          : (
              data?.messages ||
              data?.data ||
              []
            );


      renderChat(
        messages
      );


      try {

        const online =
          await api(
            "/chat/online"
          );


        setOnlineCount(
          online?.online ??
          online?.count ??
          online?.onlineCount ??
          0
        );


      } catch {

        setOnlineCount(
          0
        );
      }


    } catch (error) {

      console.error(
        "ADMFLIP chat:",
        error
      );


      renderChat([]);
    }
  }


  function renderChat(
    messages
  ) {

    const containers = [

      el("chatMessages"),

      el("panelChatMessages")

    ].filter(Boolean);


    containers.forEach(
      container => {

        if (
          !Array.isArray(messages) ||
          messages.length === 0
        ) {

          container.innerHTML =
            `<div class="loading">No messages yet.</div>`;

          return;
        }


        container.innerHTML =
          messages
            .map(
              message => {

                const username =
                  message.username ||
                  message.user?.username ||
                  "User";


                const avatar =
                  message.avatar ||
                  message.user?.avatar ||
                  "/logo.png";


                const text =
                  message.text ||
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
                      onerror="this.src='/logo.png'"
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

              }
            )
            .join("");


        container.scrollTop =
          container.scrollHeight;

      }
    );
  }


  function setOnlineCount(
    count
  ) {

    [

      "onlineCount",

      "panelOnlineCount",

      "coinflipOnline"

    ].forEach(
      id => {

        const node =
          el(id);


        if (node) {

          node.textContent =
            formatNumber(count);

        }

      }
    );
  }


  async function sendChatMessage(
    input
  ) {

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


    input.disabled =
      true;


    try {

      await api(
        "/chat/messages",
        {

          method:
            "POST",

          body:
            JSON.stringify({

              username:
                state.user.username,

              userId:
                state.user.id,

              robloxId:
                state.user.id,

              avatar:
                state.user.avatar ||
                "",

              message:
                text

            })
        }
      );


      input.value =
        "";


      await loadChat();


    } catch (error) {

      console.error(
        "ADMFLIP send chat:",
        error
      );


      toast(
        error.message ||
        "Unable to send message."
      );


    } finally {

      input.disabled =
        false;

      input.focus();

    }
  }


  function createChatPanel() {

    if (el("chatPanel")) {
      return;
    }


    const overlay =
      document.createElement(
        "div"
      );


    overlay.id =
      "chatOverlay";


    overlay.className =
      "chat-overlay";


    document.body.appendChild(
      overlay
    );


    const panel =
      document.createElement(
        "aside"
      );


    panel.id =
      "chatPanel";


    panel.className =
      "chat-panel";


    panel.innerHTML = `

      <div class="chat-header">

        <div>

          <strong>
            ADMFLIP CHAT
          </strong>

          <span>

            <i class="online-dot"></i>

            <b id="panelOnlineCount">
              0
            </b>

            online

          </span>

        </div>


        <div class="chat-actions">

          <button
            id="rulesBtnPanel"
            class="rules-icon"
            type="button"
          >
            ?
          </button>


          <button
            id="chatClose"
            class="chat-close"
            type="button"
          >
            ×
          </button>

        </div>

      </div>


      <div
        id="panelChatMessages"
        class="chat-messages"
      >

        <div class="loading">
          Loading chat...
        </div>

      </div>


      <form
        id="panelChatForm"
        class="chat-form"
      >

        <input
          id="panelChatInput"
          type="text"
          maxlength="250"
          autocomplete="off"
          placeholder="Sign in to chat..."
        >


        <button
          type="submit"
        >
          Send
        </button>

      </form>

    `;


    document.body.appendChild(
      panel
    );


    el("chatClose")
      ?.addEventListener(
        "click",
        closeChat
      );


    el("rulesBtnPanel")
      ?.addEventListener(
        "click",
        openRules
      );


    el("panelChatForm")
      ?.addEventListener(
        "submit",
        event => {

          event.preventDefault();

          sendChatMessage(
            el("panelChatInput")
          );

        }
      );


    overlay.addEventListener(
      "click",
      closeChat
    );
  }


  function openChat() {

    createChatPanel();


    const panel =
      el("chatPanel");


    const overlay =
      el("chatOverlay");


    if (!panel) {
      return;
    }


    panel.classList.add(
      "open"
    );


    overlay?.classList.add(
      "open"
    );


    state.chatOpen =
      true;


    el("topChatButton")
      ?.classList.add(
        "active"
      );


    loadChat();
  }


  function closeChat() {

    el("chatPanel")
      ?.classList.remove(
        "open"
      );


    el("chatOverlay")
      ?.classList.remove(
        "open"
      );


    state.chatOpen =
      false;


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


  function setupChat() {

    el("chatForm")
      ?.addEventListener(
        "submit",
        event => {

          event.preventDefault();

          sendChatMessage(
            el("chatInput")
          );

        }
      );


    el("rulesBtn")
      ?.addEventListener(
        "click",
        openRules
      );


    createChatPanel();
  }


  /* ============================================================
     INVENTORY
  ============================================================ */

  function openInventory() {

    if (!state.user) {

      toast(
        "Verify your Roblox account first."
      );

      openLogin();

      return;
    }


    const modal =
      createModal(
        "inventoryModal",
        `

          <div class="modal-box large">

            <button
              id="closeInventory"
              class="modal-close"
              type="button"
            >
              ×
            </button>


            <div class="eyebrow">
              YOUR ITEMS
            </div>


            <h2>
              Inventory
            </h2>


            <p class="muted">
              Pets available for coinflips.
            </p>


            <div
              id="inventoryGrid"
              class="pet-grid"
            >

              <div class="loading">
                Loading...
              </div>

            </div>

          </div>

        `
      );


    show(modal);


    el("closeInventory")
      ?.addEventListener(
        "click",
        () =>
          closeModal(
            "inventoryModal"
          )
      );


    loadInventory();
  }


  async function loadInventory() {

    const grid =
      el("inventoryGrid");


    if (!grid) {
      return;
    }


    try {

      const userId =
        state.user.id ||
        state.user.userId;


      const data =
        await api(
          "/account/" +
          encodeURIComponent(
            userId
          )
        );


      const account =
        data?.user ||
        data?.account ||
        data?.data;


      const pets =
        account?.inventory ||
        data?.pets ||
        data?.inventory ||
        data?.items ||
        [];


      grid.innerHTML =
        pets.length
          ? pets
              .map(petCard)
              .join("")
          : `<div class="loading">No pets found.</div>`;


    } catch (error) {

      console.error(
        "ADMFLIP inventory:",
        error
      );


      grid.innerHTML =
        `<div class="loading">Inventory unavailable.</div>`;
    }
  }


  /* ============================================================
     RULES
  ============================================================ */

  function openRules() {

    const modal =
      createModal(
        "rulesModal",
        `

          <div class="modal-box">

            <button
              id="closeRules"
              class="modal-close"
              type="button"
            >
              ×
            </button>


            <div class="eyebrow">
              COMMUNITY
            </div>


            <h2>
              Chat Rules
            </h2>


            <p class="muted">
              Keep ADMFLIP welcoming and useful.
            </p>


            <div class="rule">

              <b>
                01 · Respect everyone
              </b>

              <span>
                Harassment, hate speech and targeted abuse are not allowed.
              </span>

            </div>


            <div class="rule">

              <b>
                02 · No spam
              </b>

              <span>
                Avoid repeated messages, flooding and excessive caps.
              </span>

            </div>


            <div class="rule">

              <b>
                03 · No begging
              </b>

              <span>
                Do not repeatedly ask users for pets or benefits.
              </span>

            </div>


            <div class="rule">

              <b>
                04 · No advertising
              </b>

              <span>
                Unrelated websites and communities are not allowed.
              </span>

            </div>


            <div class="rule">

              <b>
                05 · No scams
              </b>

              <span>
                Do not impersonate staff or intentionally mislead users.
              </span>

            </div>


            <div class="rule">

              <b>
                06 · Keep it appropriate
              </b>

              <span>
                Sexual or adult content is not allowed.
              </span>

            </div>

          </div>

        `
      );


    show(modal);


    el("closeRules")
      ?.addEventListener(
        "click",
        () =>
          closeModal(
            "rulesModal"
          )
      );
  }


  /* ============================================================
     PROFILE
  ============================================================ */

  async function renderProfile() {

    const container =
      el("profileContent");


    if (!container) {
      return;
    }


    if (!state.user) {

      container.innerHTML = `

        <div class="profile-card">

          <h2>
            Not signed in
          </h2>

          <p class="muted">
            Verify your Roblox account to view your profile.
          </p>


          <button
            class="primary"
            id="profileLoginButton"
            type="button"
          >
            Sign In
          </button>

        </div>

      `;


      el("profileLoginButton")
        ?.addEventListener(
          "click",
          openLogin
        );


      return;
    }


    /*
      Refresh account statistics before rendering.
    */

    try {

      await loadAccount();

    } catch {

      /*
        Keep locally saved information if
        the account endpoint isn't available.
      */
    }


    container.innerHTML = `

      <div class="profile-grid">


        <div class="profile-card">

          <img
            class="profile-avatar"
            src="${escapeHTML(
              state.user.avatar ||
              "/logo.png"
            )}"
            alt=""
            onerror="this.src='/logo.png'"
          >


          <h2>
            ${escapeHTML(
              state.user.username ||
              "User"
            )}
          </h2>


          <p class="muted">
            ADMFLIP Trader
          </p>

        </div>


        <div class="profile-stat">

          <span>
            WAGERED
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
            COINFLIPS
          </span>

          <strong>
            ${formatValue(
              state.user.coinflips ||
              0
            )}
          </strong>

        </div>


        <div class="profile-stat">

          <span>
            WINS
          </span>

          <strong>
            ${formatValue(
              state.user.wins ||
              0
            )}
          </strong>

        </div>


      </div>

    `;
  }


  /* ============================================================
     MODALS
  ============================================================ */

  function createModal(
    id,
    content
  ) {

    let modal =
      el(id);


    if (modal) {

      modal.innerHTML =
        content;

      return modal;
    }


    modal =
      document.createElement(
        "div"
      );


    modal.id =
      id;


    modal.className =
      "modal hidden";


    modal.innerHTML =
      content;


    document.body.appendChild(
      modal
    );


    return modal;
  }


  function closeModal(
    id
  ) {

    hide(
      el(id)
    );
  }


  /* ============================================================
     MODAL CLICK
  ============================================================ */

  document.addEventListener(
    "click",
    event => {

      const target =
        event.target;


      if (
        target &&
        target.classList &&
        target.classList.contains(
          "modal"
        )
      ) {

        target.classList.add(
          "hidden"
        );

      }

    }
  );


  /* ============================================================
     ESCAPE
  ============================================================ */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
        "Escape"
      ) {
        return;
      }


      $$(".modal")
        .forEach(
          modal =>
            modal.classList.add(
              "hidden"
            )
        );


      closeChat();
    }
  );


  /* ============================================================
     INIT
  ============================================================ */

  async function init() {

    setupNavigation();

    setupChat();

    setupAccount();

    setupCreateCoinflip();

    setupValueSearch();

    loadSavedUser();


    /*
      These run independently.
    */

    await Promise.allSettled([

      loadValues(),

      loadCoinflips(),

      loadChat()

    ]);


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


  /* ============================================================
     START
  ============================================================ */

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
