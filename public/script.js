"use strict";

/* =========================================================
   ADMFLIP FRONTEND — full drop-in for public/script.js
   Matches backend v3 endpoints:
   /pets  /coinflips  /coinflips/:id/accept  /status
   /chat/messages  /chat/online  /account  /history
   /user/:username  /create  /check  /logout
========================================================= */

const API = {
  pets: "/pets",
  coinflips: "/coinflips",
  coinflipAccept: (id) => `/coinflips/${id}/accept`,
  chatMessages: "/chat/messages",
  chatSend: "/chat/messages",
  chatOnline: "/chat/online",
  account: "/account",
  history: "/history",
  logout: "/logout",
  userLookup: (username) => `/user/${encodeURIComponent(username)}`,
  createPhrase: "/create",
  check: "/check",
  status: "/status",
};

const TOKEN_KEY = "admflip_token";

/* =========================================================
   HELPERS
========================================================= */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function el(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Numbers always use "." as decimal separator — never "3,4". */
function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";

  if (Number.isInteger(n)) return n.toLocaleString("en-US");

  const rounded = Math.round(n * 1000) / 1000;
  return rounded.toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
}

function timeAgo(timestamp) {
  if (!timestamp) return "";

  const seconds = Math.floor((Date.now() - Number(timestamp)) / 1000);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (_) {
    return "";
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {
    /* storage unavailable — session still works in memory */
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;

  const config = {
    method: options.method || "GET",
    headers,
  };

  if (options.body !== undefined) {
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, config);

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      (data && (data.message || data.error)) ||
        `Request failed (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

let toastTimer = null;
function toast(message, type = "info") {
  const node = el("toast");
  if (!node) return;

  node.textContent = message;
  node.className = "toast show " + type;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = "toast";
  }, 3500);
}

function hideLoading() {
  const loading = el("loadingScreen");
  if (!loading) return;
  loading.classList.add("hidden");
  loading.style.display = "none";
}

function openModal(modal) {
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.style.display = "none";
  document.body.classList.remove("modal-open");
}

function setTextAny(ids, value) {
  ids.forEach((id) => {
    const node = el(id);
    if (node) node.textContent = String(value);
  });
}

/* =========================================================
   STATE
========================================================= */

const state = {
  pets: [],
  petsByName: {},
  coinflips: [],
  user: null,
  history: [],
  mode: "create", // "create" | "join"
  joinTargetId: null,
  selectedPetName: null,
  selectedSide: null,
  verifyUsername: null,
  verifyPhrase: null,
  loadedOnce: false,
};

/* =========================================================
   NAVIGATION (Coinflip / Values / Profile / Chat)
========================================================= */

function currentPage() {
  const hash = (location.hash || "").replace("#", "");
  return ["coinflip", "values", "profile"].includes(hash) ? hash : "coinflip";
}

function collectPages() {
  const found = new Map();

  $$("[data-page-section]").forEach((section) => {
    const key = String(section.getAttribute("data-page-section") || "").trim();
    if (key) found.set(key, section);
  });

  $$(".page[data-page]").forEach((section) => {
    const key = String(section.getAttribute("data-page") || "").trim();
    if (key) found.set(key, section);
  });

  const candidates = {
    coinflip: ["coinflipSection", "coinflipPage", "page-coinflip", "coinflip", "coinflip-section"],
    values: ["valuesSection", "valuesPage", "page-values", "values", "values-section"],
    profile: ["profileSection", "profilePage", "page-profile", "profile", "profile-section"],
    chat: ["chatSection", "chatPage", "page-chat", "chat-section"],
  };

  Object.entries(candidates).forEach(([key, ids]) => {
    if (found.has(key)) return;
    for (const id of ids) {
      const node = el(id);
      if (node) {
        found.set(key, node);
        break;
      }
    }
  });

  return Array.from(found.entries()).map(([key, section]) => ({ key, section }));
}

function showPage(name) {
  const pages = collectPages();

  if (!pages.length) {
    /* No recognizable section wrappers — never hide content. */
    $$("main section, main > div, main > article").forEach((section) => {
      section.style.display = "";
      section.classList.remove("hidden");
    });
    return;
  }

  const target = pages.find((page) => page.key === name);

  if (!target) {
    /* Target section unknown — keep everything visible. */
    pages.forEach(({ section }) => {
      section.style.display = "";
      section.classList.remove("hidden");
    });
    return;
  }

  pages.forEach(({ key, section }) => {
    const isActive = key === name;

    if (isActive) {
      section.style.display = "";
      section.classList.remove("hidden");
      section.classList.add("active");
    } else {
      section.style.display = "none";
      section.classList.remove("active");
    }
  });
}

/* =========================================================
   LOADERS — PETS
========================================================= */

async function loadPets() {
  try {
    const data = await api(API.pets);
    state.pets = Array.isArray(data.pets) ? data.pets : [];

    state.petsByName = {};
    state.pets.forEach((pet) => {
      if (pet && pet.name) {
        state.petsByName[String(pet.name).trim().toLowerCase()] = pet;
      }
    });

    renderPets();
  } catch (error) {
    console.error("Failed to load pets:", error);
    const list = el("petsList");
    if (list) {
      list.innerHTML = `<div class="error">Could not load values: ${esc(error.message)}</div>`;
    }
  }
}

function petValue(pet) {
  if (!pet) return 0;
  return Number(pet.value) || 0;
}

function sortPets(pets) {
  return pets.slice().sort((a, b) => petValue(b) - petValue(a));
}

function renderPets() {
  const list = el("petsList");
  if (!list) return;

  if (!state.pets.length) {
    list.innerHTML = `<div class="loading">No pets found.</div>`;
    return;
  }

  list.innerHTML = sortPets(state.pets)
    .map(
      (pet) => `
      <div class="pet-card" title="${esc(pet.name)}">
        <img
          class="pet-image"
          src="${esc(pet.image)}"
          alt="${esc(pet.name)}"
          loading="lazy"
          onerror="this.style.visibility='hidden'"
        >
        <div class="pet-info">
          <span class="pet-name">${esc(pet.name)}</span>
          <span class="pet-value">${fmt(pet.value)}</span>
        </div>
      </div>`
    )
    .join("");
}

/* =========================================================
   LOADERS — COINFLIPS
========================================================= */

async function loadCoinflips() {
  try {
    const data = await api(API.coinflips);
    state.coinflips = Array.isArray(data.coinflips) ? data.coinflips : [];

    setTextAny(["statsTotalCoinflips", "totalCoinflips", "coinflipCount", "statsCoinflips"], data.total != null ? data.total : state.coinflips.length);
    setTextAny(["statsTotalValue", "totalValue", "statsValue", "coinflipValue"], data.totalValue != null ? data.totalValue : 0);

    renderCoinflips();
  } catch (error) {
    console.error("Failed to load coinflips:", error);
    const list = el("coinflipList");
    if (list) {
      list.innerHTML = `<div class="error">Could not load coinflips: ${esc(error.message)}</div>`;
    }
  }
}

function renderCoinflips() {
  const list = el("coinflipList");
  if (!list) return;

  if (!state.coinflips.length) {
    list.innerHTML = `<div class="empty">No open coinflips right now.</div>`;
    return;
  }

  list.innerHTML = state.coinflips
    .map((item) => {
      const petName = item.petName || item.name || "Unknown Pet";
      const petValue = Number(item.petValue != null ? item.petValue : item.value) || 0;
      const image = item.image || "";
      const side = String(item.side || "").toLowerCase();
      const creator = item.username || "Player";
      const avatar = item.avatar || "/logo.png";
      const id = item.id || "";

      return `
      <button type="button" class="coinflip-card" data-coinflip-id="${esc(id)}">
        <img
          class="coinflip-pet-image"
          src="${esc(image)}"
          alt="${esc(petName)}"
          loading="lazy"
          onerror="this.style.visibility='hidden'"
        >
        <div class="coinflip-info">
          <span class="coinflip-pet-name">${esc(petName)}</span>
          <span class="coinflip-value">${fmt(petValue)}</span>
          <span class="coinflip-meta">
            <img class="coinflip-avatar" src="${esc(avatar)}" alt="" onerror="this.style.display='none'">
            ${esc(creator)} · ${side === "heads" || side === "tails" ? esc(side) : "Any side"} · ${timeAgo(item.createdAt)}
          </span>
        </div>
      </button>`;
    })
    .join("");
}

/* =========================================================
   LOADERS — STATUS / ONLINE
========================================================= */

async function loadStatus() {
  try {
    const data = await api(API.status);

    if (data && typeof data.online === "boolean") {
      setTextAny(["onlineStatus", "liveStatus"], data.online ? "LIVE" : "OFFLINE");
    }
    if (data && data.announcement) {
      setTextAny(["announcement"], data.announcement);
    }
  } catch (_) {
    /* status is optional */
  }

  try {
    const data = await api(API.chatOnline);
    if (data && data.online != null) {
      setTextAny(["statsOnline", "onlineCount", "onlineUsers"], data.online);
      setTextAny(["panelOnlineCount"], data.online);
    }
  } catch (_) {
    /* no online endpoint available */
  }
}

/* =========================================================
   ACCOUNT / SESSION
========================================================= */

async function loadAccount() {
  try {
    const data = await api(API.account);
    state.user = data.user || data.account || null;
  } catch (error) {
    state.user = null;
    if (error.status && error.status !== 401 && error.status !== 403) {
      console.error("Failed to check account:", error);
    }
  }

  renderAccount();
}

function renderAccount() {
  const loggedIn = Boolean(state.user);
  const user = state.user || {};

  $$("[data-login], #loginBtn, #openLogin, .login-btn").forEach((button) => {
    button.style.display = loggedIn ? "none" : "";
  });

  $$("[data-logout], #logoutBtn, .logout-btn").forEach((button) => {
    button.style.display = loggedIn ? "" : "none";
  });

  const profile = el("profileContent") || document.querySelector(".profile-content");

  if (profile) {
    if (!loggedIn) {
      profile.innerHTML = `
        <div class="panel">
          <h2>Not signed in</h2>
          <p class="muted">Login with Roblox to view your profile.</p>
        </div>`;
    } else {
      profile.innerHTML = `
        <div class="panel">
          <img class="profile-avatar" src="${esc(user.avatar || "/logo.png")}" alt="Avatar" onerror="this.style.display='none'">
          <h2>${esc(user.displayName || user.username || "Player")}</h2>
          <p class="muted">@${esc(user.username || user.id || "roblox")}</p>
          ${user.verified ? '<span class="verified-badge">VERIFIED</span>' : ""}
          <div class="profile-stats">
            <div><b>${fmt(user.balance)}</b><span>Balance</span></div>
            <div><b>${fmt(user.wagered)}</b><span>Wagered</span></div>
            <div><b>${Number(user.wins || 0)}</b><span>Wins</span></div>
          </div>
        </div>`;
    }
  }
}

async function logout() {
  try {
    await api(API.logout, { method: "POST", body: {} });
  } catch (_) {
    /* logout never hard-fails the UI */
  }

  setToken("");
  state.user = null;
  renderAccount();
  toast("Signed out.");
}

/* =========================================================
   HISTORY
========================================================= */

async function loadHistory() {
  const list = el("historyList");
  if (!list) return;

  if (!state.user) {
    list.innerHTML = `<div class="muted">Login to see your history.</div>`;
    return;
  }

  list.innerHTML = `<div class="loading">Loading history...</div>`;

  try {
    const data = await api(API.history);
    state.history = Array.isArray(data.history)
      ? data.history
      : Array.isArray(data.coinflips)
        ? data.coinflips
        : [];

    if (!state.history.length) {
      list.innerHTML = `<div class="empty">No coinflips yet.</div>`;
      return;
    }

    list.innerHTML = state.history
      .map((item) => {
        const pet = item.myPet || {};
        const petName = pet.name || item.petName || item.name || "Unknown Pet";
        const petValue = Number(pet.value != null ? pet.value : item.petValue) || 0;
        const image = pet.image || item.image || "";
        const side = item.mySide || item.side || "";
        const result = String(item.result || item.status || "").toUpperCase();
        const opponent = item.opponent && item.opponent.username ? item.opponent.username : "";

        return `
        <div class="history-item">
          <img class="history-pet-image" src="${esc(image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <div class="history-info">
            <span class="history-pet-name">${esc(petName)}</span>
            <span class="history-value">${fmt(petValue)}</span>
            <span class="history-meta">
              ${side ? esc(side) + " · " : ""}${esc(result)}${opponent ? " vs " + esc(opponent) : ""} · ${timeAgo(item.createdAt)}
            </span>
          </div>
        </div>`;
      })
      .join("");
  } catch (error) {
    list.innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
}

/* =========================================================
   CREATE / JOIN COINFLIP MODAL
========================================================= */

function resetCreateUI() {
  const modal = el("createModal");
  if (!modal) return;

  const title = el("createModalTitle");
  const inventory = el("createInventory");
  const sideArea = el("sideArea");
  const postBtn = el("postCoinflipBtn");

  if (title) {
    title.textContent = state.mode === "join" ? "Join Coinflip" : "Choose Your Pet";
  }

  if (inventory) {
    inventory.innerHTML = `<div class="loading">Loading inventory...</div>`;
  }

  if (sideArea) sideArea.classList.add("hidden");

  if (postBtn) {
    postBtn.textContent = state.mode === "join" ? "Join Coinflip" : "Create Coinflip";
  }

  $$(".inventory-pet").forEach((card) => card.classList.remove("selected"));
  $$(".side-btn").forEach((button) => button.classList.remove("active"));
}

function openCreateModal() {
  if (!state.user) {
    toast("Sign in with Roblox first.", "error");
    openLoginModal();
    return;
  }

  state.mode = "create";
  state.joinTargetId = null;
  state.selectedPetName = null;
  state.selectedSide = null;

  resetCreateUI();
  openModal(el("createModal"));
  renderInventory();
}

function openJoinModal(id) {
  if (!state.user) {
    toast("Sign in with Roblox first.", "error");
    openLoginModal();
    return;
  }

  state.mode = "join";
  state.joinTargetId = id;
  state.selectedPetName = null;
  state.selectedSide = null;

  resetCreateUI();
  openModal(el("createModal"));
  renderInventory();
}

function inventoryPets() {
  const owned = Array.isArray(state.user && state.user.inventory)
    ? state.user.inventory
    : [];

  if (owned.length) return owned;

  return state.pets;
}

async function renderInventory() {
  const inventory = el("createInventory");
  if (!inventory) return;

  const pickable = inventoryPets();

  if (!pickable.length) {
    inventory.innerHTML = `<div class="empty">No pets available.</div>`;
    return;
  }

  inventory.innerHTML = sortPets(pickable)
    .map(
      (pet) => `
      <button
        type="button"
        class="pet-card inventory-pet"
        data-pet-name="${esc(pet.name)}"
        title="${esc(pet.name)}"
      >
        <img class="pet-image" src="${esc(pet.image)}" alt="${esc(pet.name)}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="pet-info">
          <span class="pet-name">${esc(pet.name)}</span>
          <span class="pet-value">${fmt(pet.value)}</span>
        </div>
      </button>`
    )
    .join("");
}

function selectPet(petName) {
  state.selectedPetName = petName;

  $$(".inventory-pet").forEach((card) => {
    card.classList.toggle("selected", card.getAttribute("data-pet-name") === petName);
  });

  const sideArea = el("sideArea");
  if (sideArea) sideArea.classList.remove("hidden");

  const title = el("createModalTitle");
  if (title) title.textContent = `${state.mode === "join" ? "Join" : "Flip"} ${petName}`;
}

function selectSide(side) {
  state.selectedSide = side;

  $$(".side-btn").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-side") === side);
  });
}

async function postCoinflip() {
  const button = el("postCoinflipBtn");
  if (!button) return;

  if (!state.selectedPetName) {
    toast("Pick a pet first.", "error");
    return;
  }

  if (!state.selectedSide) {
    toast("Choose Heads or Tails.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = state.mode === "join" ? "Joining..." : "Creating...";

  try {
    if (state.mode === "join") {
      await api(API.coinflipAccept(state.joinTargetId), {
        method: "POST",
        body: { petName: state.selectedPetName, side: state.selectedSide },
      });
      toast("Joined the coinflip!", "success");
    } else {
      await api(API.coinflips, {
        method: "POST",
        body: { petName: state.selectedPetName, side: state.selectedSide },
      });
      toast("Coinflip created!", "success");
    }

    closeModal(el("createModal"));
    loadCoinflips();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = state.mode === "join" ? "Join Coinflip" : "Create Coinflip";
  }
}

/* =========================================================
   CHAT
========================================================= */

async function loadChat() {
  const list = el("panelChatMessages");
  if (!list) return;

  try {
    const data = await api(API.chatMessages);
    const messages = Array.isArray(data.messages) ? data.messages : [];

    const wasAtBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;

    list.innerHTML = messages
      .map((message) => {
        const isMine =
          state.user &&
          message.robloxId &&
          state.user.id &&
          String(message.robloxId) === String(state.user.id);

        const username = message.username || "Unknown";
        const avatar = message.avatar || "/logo.png";
        const text = message.message || message.text || "";
        const pinned = message.pinned || message.type === "announcement";

        return `
        <div class="chat-message${isMine ? " mine" : ""}${pinned ? " announcement" : ""}">
          <img class="chat-avatar" src="${esc(avatar)}" alt="" onerror="this.style.display='none'">
          <div class="chat-bubble">
            <div class="chat-meta">
              <b>${esc(username)}</b>
              ${pinned ? '<span class="chat-tag">PINNED</span>' : ""}
              <span class="chat-time">${timeAgo(message.createdAt)}</span>
            </div>
            <div class="chat-text">${esc(text)}</div>
          </div>
        </div>`;
      })
      .join("");

    if (wasAtBottom || !state.loadedOnce) {
      list.scrollTop = list.scrollHeight;
    }
    state.loadedOnce = true;
  } catch (error) {
    console.error("Failed to load chat:", error);
    if (!list.children.length) {
      list.innerHTML = `<div class="error">Could not load chat.</div>`;
    }
  }
}

async function sendChat(message) {
  if (!state.user) {
    toast("Sign in with Roblox to chat.", "error");
    return false;
  }

  try {
    await api(API.chatSend, {
      method: "POST",
      body: { message: message.slice(0, 250) },
    });
    loadChat();
    return true;
  } catch (error) {
    toast(error.message, "error");
    return false;
  }
}

function openChat() {
  const panel = el("chatPanel");
  if (!panel) return;
  panel.classList.add("open");
  loadChat();
}

function closeChat() {
  const panel = el("chatPanel");
  if (panel) panel.classList.remove("open");
}

/* =========================================================
   LOGIN FLOW — matches backend:
   GET /user/:username  -> profile
   GET /create          -> phrase
   POST /check          -> { username, phrase } -> token
========================================================= */

function openLoginModal() {
  const modal = el("loginModal");
  if (!modal) return;

  const step1 = el("step1");
  const profile = el("loginProfile");
  const phrase = el("phrase");
  const verify = el("verify");
  const message = el("loginMessage");
  const title = el("loginModalTitle");

  if (step1) step1.classList.remove("hidden");
  if (profile) { profile.classList.add("hidden"); profile.innerHTML = ""; }
  if (phrase) { phrase.classList.add("hidden"); phrase.innerHTML = ""; }
  if (verify) verify.classList.add("hidden");
  if (message) message.textContent = "";
  if (title) title.textContent = "Login with Roblox";

  openModal(modal);
}

async function searchUsername(username) {
  const button = el("continueLogin");
  const message = el("loginMessage");
  const profile = el("loginProfile");
  const phrase = el("phrase");
  const verify = el("verify");
  const title = el("loginModalTitle");

  if (!button) return;

  button.disabled = true;
  button.textContent = "Searching...";
  if (message) message.textContent = "";

  try {
    /* 1. Fetch the Roblox profile */
    const userData = await api(API.userLookup(username));
    const profileUser = (userData && userData.user) || {};

    /* 2. Get a fresh verification phrase */
    const phraseData = await api(API.createPhrase);
    const phraseText = (phraseData && phraseData.phrase) || "";

    state.verifyUsername = username;
    state.verifyPhrase = phraseText;

    if (profile) {
      profile.innerHTML = `
        <div class="login-profile-card">
          <img class="login-profile-avatar" src="${esc(profileUser.avatar || "/logo.png")}" alt="" onerror="this.style.display='none'">
          <div>
            <b>${esc(profileUser.displayName || profileUser.username || username)}</b>
            <div class="muted">@${esc(profileUser.username || username)}</div>
          </div>
        </div>`;
      profile.classList.remove("hidden");
    }

    if (phrase && phraseText) {
      phrase.innerHTML = `
        <div class="phrase-box">
          <p class="muted">Put this phrase in your Roblox About/Bio, then verify:</p>
          <code class="phrase-code">${esc(phraseText)}</code>
        </div>`;
      phrase.classList.remove("hidden");
    }

    if (verify) verify.classList.remove("hidden");
    if (title) title.textContent = "Verify your bio";
  } catch (error) {
    if (message) message.textContent = error.message;
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Search";
  }
}

async function verifyLogin() {
  const button = el("verify");
  const message = el("loginMessage");
  if (!button) return;

  if (!state.verifyUsername || !state.verifyPhrase) {
    toast("Search a username first.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Verifying...";
  if (message) message.textContent = "";

  try {
    const data = await api(API.check, {
      method: "POST",
      body: {
        username: state.verifyUsername,
        phrase: state.verifyPhrase,
      },
    });

    if (data && data.token) setToken(data.token);

    toast("Signed in!", "success");
    closeModal(el("loginModal"));
    await loadAccount();
    loadHistory();
  } catch (error) {
    if (message) message.textContent = error.message;
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Verify Roblox Bio";
  }
}

/* =========================================================
   WIRING / EVENTS
========================================================= */

function wireEvents() {
  /* Navigation (Coinflip / Values / Profile / Chat) */
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest(".nav-item");

    if (navButton) {
      const page = navButton.getAttribute("data-page");

      if (page === "chat") {
        openChat();
        return;
      }

      if (page) {
        showPage(page);
        history.replaceState(null, "", "#" + page);
        if (page === "values") loadPets();
        if (page === "profile") loadAccount();
        return;
      }

      /* Nav buttons without data-page — treat Chat by label */
      if (navButton.textContent.trim().toLowerCase().includes("chat")) {
        openChat();
      }
      return;
    }
  });

  window.addEventListener("hashchange", () => {
    const page = currentPage();
    if (page === "chat") openChat();
    else showPage(page);
  });

  /* Quick actions (right side) */
  const quickCreate = el("quickCreateBtn");
  if (quickCreate) quickCreate.addEventListener("click", openCreateModal);

  const quickHistory = el("quickHistoryBtn");
  if (quickHistory) {
    quickHistory.addEventListener("click", () => {
      openModal(el("historyModal"));
      loadHistory();
    });
  }

  /* Modals — close buttons */
  const closeLogin = el("closeLogin");
  if (closeLogin) closeLogin.addEventListener("click", () => closeModal(el("loginModal")));

  const closeCreate = el("closeCreateModal");
  if (closeCreate) closeCreate.addEventListener("click", () => closeModal(el("createModal")));

  const closeHistory = el("closeHistoryModal");
  if (closeHistory) closeHistory.addEventListener("click", () => closeModal(el("historyModal")));

  /* Modals — click outside closes */
  $$(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $$(".modal").forEach(closeModal);
      closeChat();
    }
  });

  /* Create/Join modal interactions */
  const createModal = el("createModal");
  if (createModal) {
    createModal.addEventListener("click", (event) => {
      const petCard = event.target.closest(".inventory-pet");
      if (petCard) {
        selectPet(petCard.getAttribute("data-pet-name"));
        return;
      }

      const sideButton = event.target.closest(".side-btn");
      if (sideButton) {
        selectSide(sideButton.getAttribute("data-side"));
        return;
      }

      const postButton = event.target.closest("#postCoinflipBtn");
      if (postButton) postCoinflip();
    });
  }

  /* Coinflip list — click a card to join */
  const coinflipList = el("coinflipList");
  if (coinflipList) {
    coinflipList.addEventListener("click", (event) => {
      const card = event.target.closest(".coinflip-card");
      if (card) openJoinModal(card.getAttribute("data-coinflip-id"));
    });
  }

  /* Chat */
  const chatToggle = $("[data-chat], #chatToggle, #chatBtn");
  if (chatToggle) chatToggle.addEventListener("click", openChat);

  const chatClose = el("chatClose");
  if (chatClose) chatClose.addEventListener("click", closeChat);

  const chatForm = el("panelChatForm");
  if (chatForm) {
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = el("panelChatInput");
      if (!input) return;

      const message = input.value.trim();
      if (!message) return;

      input.value = "";
      sendChat(message);
    });
  }

  /* Login */
  const loginBtn = $("[data-login], #loginBtn, #openLogin, .login-btn");
  if (loginBtn) loginBtn.addEventListener("click", openLoginModal);

  const logoutBtn = $("[data-logout], #logoutBtn, .logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  const usernameForm = el("usernameForm");
  if (usernameForm) {
    usernameForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = el("username");
      const username = input ? input.value.trim() : "";
      if (username) searchUsername(username);
    });
  }

  const verifyBtn = el("verify");
  if (verifyBtn) verifyBtn.addEventListener("click", verifyLogin);
}

/* =========================================================
   POLLING
========================================================= */

function startPolling() {
  loadCoinflips();
  setInterval(loadCoinflips, 8000);

  loadChat();
  setInterval(loadChat, 5000);

  loadStatus();
  setInterval(loadStatus, 15000);
}

/* =========================================================
   INIT
========================================================= */

function init() {
  try {
    wireEvents();

    const page = currentPage();
    if (page === "chat") openChat();
    else showPage(page);

    loadPets();
    loadAccount();
    startPolling();
  } catch (error) {
    console.error("Init error:", error);
  } finally {
    /* Never leave the user stuck on the loading screen. */
    hideLoading();
    setTimeout(hideLoading, 2500);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
