"use strict";

/* =========================================================
   API CONFIG — change endpoints here if your server differs
========================================================= */

const API = {
  pets: "/pets",
  coinflips: "/coinflips",
  createCoinflip: "/coinflips",
  joinCoinflip: (id) => `/coinflips/${id}/join`,
  joinCoinflipAlt: (id) => `/coinflips/${id}/accept`,
  chatMessages: "/chat/messages",
  sendChat: "/chat",
  chatOnline: "/chat/online",
  online: "/online",
  account: "/account",
  history: "/history",
  login: "/login",
  verify: "/verify",
  logout: "/logout",
  inventory: "/user/inventory",
  status: "/status",
};

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

/* Numbers always use "." as the decimal separator — never "3,4". */
function fmt(value) {
  const n = Number(value);
  if (!isFinite(n)) return "0";

  if (Number.isInteger(n)) return n.toLocaleString("en-US");

  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded).replace(".", ".");
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

async function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
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
  const toastEl = el("toast");
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.className = "toast show " + type;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
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

/* =========================================================
   STATE
========================================================= */

const state = {
  pets: [],
  petsById: {},
  coinflips: [],
  user: null,
  selectedPetId: null,
  selectedSide: null,
  history: [],
  loadedOnce: false,
};

/* =========================================================
   NAVIGATION (Coinflip / Values / Profile)
========================================================= */

function collectPages() {
  const pages = [];

  $$(".page, [data-page-section], [id^='page-']").forEach((section) => {
    const key =
      section.getAttribute("data-page") ||
      (section.id || "").replace(/^page-/, "");
    if (key) pages.push({ key, section });
  });

  return pages;
}

function showPage(name) {
  const pages = collectPages();

  pages.forEach(({ key, section }) => {
    const isActive = key === name;
    section.style.display = isActive ? "" : "none";
  });

  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-page") === name);
  });
}

function currentPage() {
  const hash = (location.hash || "").replace("#", "");
  return ["coinflip", "values", "profile"].includes(hash) ? hash : "coinflip";
}

/* =========================================================
   LOADERS
========================================================= */

async function loadPets() {
  try {
    const data = await api(API.pets);
    state.pets = Array.isArray(data.pets) ? data.pets : [];

    state.petsById = {};
    state.pets.forEach((pet) => {
      if (pet && pet.id) state.petsById[pet.id] = pet;
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
      <div class="pet-card" data-pet-id="${esc(pet.id)}" title="${esc(pet.name)}">
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

async function loadCoinflips() {
  try {
    const data = await api(API.coinflips);
    state.coinflips = Array.isArray(data.coinflips) ? data.coinflips : [];

    const total = Number(data.total) || state.coinflips.length;
    const totalValue = Number(data.totalValue) || 0;

    setText("statsTotalCoinflips", fmt(total));
    setText("statsTotalValue", fmt(totalValue));

    renderCoinflips();
  } catch (error) {
    console.error("Failed to load coinflips:", error);
    const list = el("coinflipList");
    if (list) {
      list.innerHTML = `<div class="error">Could not load coinflips: ${esc(error.message)}</div>`;
    }
  }
}

function coinflipPet(item) {
  const petId = item.petId || item.pet || item.itemId || item.item;
  const direct = item.pet && typeof item.pet === "object" ? item.pet : null;

  if (direct) return direct;
  if (petId && state.petsById[petId]) return state.petsById[petId];
  return null;
}

function coinflipCreator(item) {
  const owner = item.owner || item.creator || item.user || {};
  if (typeof owner === "object") {
    return {
      name: owner.username || owner.displayName || owner.name || "Unknown",
      avatar: owner.avatar || owner.image || "",
    };
  }
  return { name: String(owner || "Unknown"), avatar: item.avatar || item.creatorAvatar || "" };
}

function coinflipSide(item) {
  const side = String(item.side || "").toLowerCase();
  if (side === "heads" || side === "tails") return side;

  if (item.heads && !item.tails) return "heads";
  if (item.tails && !item.heads) return "tails";
  return "";
}

function coinflipId(item) {
  return item.id || item._id || "";
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
      const pet = coinflipPet(item);
      const creator = coinflipCreator(item);
      const side = coinflipSide(item);
      const id = coinflipId(item);

      return `
      <button type="button" class="coinflip-card" data-coinflip-id="${esc(id)}">
        <img
          class="coinflip-pet-image"
          src="${esc(pet ? pet.image : item.image || "")}"
          alt="${esc(pet ? pet.name : "Pet")}"
          loading="lazy"
          onerror="this.style.visibility='hidden'"
        >
        <div class="coinflip-info">
          <span class="coinflip-pet-name">${esc(pet ? pet.name : item.name || "Unknown Pet")}</span>
          <span class="coinflip-value">${fmt(pet ? pet.value : item.value)}</span>
          <span class="coinflip-meta">
            <img
              class="coinflip-avatar"
              src="${esc(creator.avatar)}"
              alt=""
              onerror="this.style.display='none'"
            >
            ${esc(creator.name)} · ${side ? esc(side) : "Any side"} · ${timeAgo(item.createdAt)}
          </span>
        </div>
      </button>`;
    })
    .join("");
}

async function loadStatus() {
  try {
    const data = await api(API.status);

    if (data && typeof data.online === "boolean") {
      setText("onlineStatus", data.online ? "Live" : "Offline");
    }
    if (data && data.announcement) {
      setText("announcement", data.announcement);
    }
  } catch (_) {
    /* status is optional */
  }

  /* try to fetch an online user count, silently ignore failures */
  try {
    const data = await api(API.chatOnline);
    if (data && data.online != null) setText("panelOnlineCount", fmt(data.online));
  } catch (_) {
    try {
      const data = await api(API.online);
      if (data && data.online != null) setText("statsOnline", fmt(data.online));
    } catch (_) {
      /* no online endpoint available */
    }
  }
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = String(value);
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

  const profile = el("profileContent") || $(".profile-content");
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
          <img class="profile-avatar" src="${esc(user.avatar || "/logo.png")}" alt="Avatar">
          <h2>${esc(user.displayName || user.username || "Player")}</h2>
          <p class="muted">@${esc(user.username || user.id || "roblox")}</p>
        </div>`;
    }
  }
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
        : Array.isArray(data.items)
          ? data.items
          : [];

    if (!state.history.length) {
      list.innerHTML = `<div class="empty">No coinflips yet.</div>`;
      return;
    }

    list.innerHTML = state.history
      .map((item) => {
        const pet = coinflipPet(item);
        const side = coinflipSide(item);
        const result = item.result || item.status || (item.won ? "Won" : item.lost ? "Lost" : "");
        const opponent = item.opponent || "";

        return `
        <div class="history-item">
          <img class="history-pet-image" src="${esc(pet ? pet.image : item.image || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <div class="history-info">
            <span class="history-pet-name">${esc(pet ? pet.name : item.name || "Unknown Pet")}</span>
            <span class="history-value">${fmt(pet ? pet.value : item.value)}</span>
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
   CREATE COINFLIP MODAL
========================================================= */

async function openCreateModal() {
  const modal = el("createModal");
  if (!modal) return;

  if (!state.user) {
    toast("Sign in with Roblox first.", "error");
    openLoginModal();
    return;
  }

  state.selectedPetId = null;
  state.selectedSide = null;

  const inventory = el("createInventory");
  const sideArea = el("sideArea");

  if (inventory) {
    inventory.innerHTML = `<div class="loading">Loading inventory...</div>`;
  }
  if (sideArea) sideArea.classList.add("hidden");

  openModal(modal);
  await renderInventory();
}

async function renderInventory() {
  const inventory = el("createInventory");
  if (!inventory) return;

  let pickable = [];

  try {
    const data = await api(API.inventory);
    const pets = data.pets || data.items || data.inventory || [];

    if (Array.isArray(pets) && pets.length) {
      pickable = pets.map((pet) => {
        if (typeof pet === "string") return state.petsById[pet] || { id: pet, name: pet, value: 0, image: "" };
        return pet;
      });
    }
  } catch (_) {
    /* fall back to the full values list below */
  }

  if (!pickable.length) pickable = state.pets;

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
        data-pet-id="${esc(pet.id)}"
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

function selectPet(petId) {
  state.selectedPetId = petId;

  $$(".inventory-pet").forEach((card) => {
    card.classList.toggle("selected", card.getAttribute("data-pet-id") === petId);
  });

  const sideArea = el("sideArea");
  if (sideArea) sideArea.classList.remove("hidden");

  const pet = state.petsById[petId];
  const title = el("createModalTitle");
  if (title && pet) title.textContent = `Flip ${pet.name}`;
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

  if (!state.selectedPetId) {
    toast("Pick a pet first.", "error");
    return;
  }
  if (!state.selectedSide) {
    toast("Choose Heads or Tails.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Creating...";

  try {
    await api(API.createCoinflip, {
      method: "POST",
      body: { petId: state.selectedPetId, side: state.selectedSide },
    });

    toast("Coinflip created!", "success");
    closeModal(el("createModal"));
    loadCoinflips();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Create Coinflip";
  }
}

/* =========================================================
   JOIN COINFLIP
========================================================= */

async function joinCoinflip(id) {
  if (!state.user) {
    toast("Sign in with Roblox first.", "error");
    openLoginModal();
    return;
  }

  try {
    await api(API.joinCoinflip(id), { method: "POST", body: {} });
    toast("Joined the coinflip!", "success");
    loadCoinflips();
  } catch (error) {
    if (error.status === 404) {
      try {
        await api(API.joinCoinflipAlt(id), { method: "POST", body: {} });
        toast("Joined the coinflip!", "success");
        loadCoinflips();
        return;
      } catch (_) {
        /* fall through */
      }
    }
    toast(error.message, "error");
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

        const username = message.username || message.user || "Unknown";
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
    await api(API.sendChat, { method: "POST", body: { message } });
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
   LOGIN FLOW
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
    const data = await api(API.login, { method: "POST", body: { username } });

    if (profile) {
      profile.innerHTML = `
        <div class="login-profile-card">
          <img class="login-profile-avatar" src="${esc((data.profile && data.profile.avatar) || data.avatar || "/logo.png")}" alt="" onerror="this.style.display='none'">
          <div>
            <b>${esc((data.profile && (data.profile.displayName || data.profile.username)) || data.displayName || username)}</b>
            <div class="muted">@${esc((data.profile && data.profile.username) || username)}</div>
          </div>
        </div>`;
      profile.classList.remove("hidden");
    }

    const phraseText =
      data.phrase || (data.profile && data.profile.phrase) || data.verificationCode || "";

    if (phrase && phraseText) {
      phrase.innerHTML = `
        <div class="phrase-box">
          <p class="muted">Add this phrase to your Roblox About/Bio, then verify:</p>
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

async function verifyLogin(username) {
  const button = el("verify");
  const message = el("loginMessage");
  if (!button) return;

  button.disabled = true;
  button.textContent = "Verifying...";
  if (message) message.textContent = "";

  try {
    await api(API.verify, { method: "POST", body: { username } });

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

async function logout() {
  try {
    await api(API.logout, { method: "POST", body: {} });
  } catch (_) {
    /* logout should never hard-fail the UI */
  }

  state.user = null;
  renderAccount();
  toast("Signed out.");
}

/* =========================================================
   WIRING / EVENTS
========================================================= */

function wireEvents() {
  /* Navigation */
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest(".nav-item[data-page]");
    if (navButton) {
      const page = navButton.getAttribute("data-page");
      showPage(page);
      if (page === "values") loadPets();
      if (page === "profile") loadAccount();
      return;
    }
  });

  /* Quick actions (right side) */
  const quickCreate = el("quickCreateBtn");
  if (quickCreate) quickCreate.addEventListener("click", openCreateModal);

  const quickHistory = el("quickHistoryBtn");
  if (quickHistory) quickHistory.addEventListener("click", () => {
    openModal(el("historyModal"));
    loadHistory();
  });

  /* Modals: close buttons */
  const closeLogin = el("closeLogin");
  if (closeLogin) closeLogin.addEventListener("click", () => closeModal(el("loginModal")));

  const closeCreate = el("closeCreateModal");
  if (closeCreate) closeCreate.addEventListener("click", () => closeModal(el("createModal")));

  const closeHistory = el("closeHistoryModal");
  if (closeHistory) closeHistory.addEventListener("click", () => closeModal(el("historyModal")));

  /* Modals: click outside closes */
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

  /* Create modal: pick pet / side / post */
  const createModal = el("createModal");
  if (createModal) {
    createModal.addEventListener("click", (event) => {
      const petCard = event.target.closest(".inventory-pet");
      if (petCard) {
        selectPet(petCard.getAttribute("data-pet-id"));
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

  /* Coinflip list: join on card click */
  const coinflipList = el("coinflipList");
  if (coinflipList) {
    coinflipList.addEventListener("click", (event) => {
      const card = event.target.closest(".coinflip-card");
      if (card) joinCoinflip(card.getAttribute("data-coinflip-id"));
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

  /* Login modal */
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
  if (verifyBtn) {
    verifyBtn.addEventListener("click", () => {
      const input = el("username");
      verifyLogin(input ? input.value.trim() : "");
    });
  }
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

    showPage(currentPage());

    loadPets();
    loadAccount();
    startPolling();

    if (location.hash === "#values") loadPets();
    if (location.hash === "#profile") loadAccount();
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
