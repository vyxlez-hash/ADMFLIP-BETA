"use strict";

const crypto = require("crypto");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "").trim();
const ADMIN_KEY = process.env.ADMIN_KEY || "";

const API_URL = (
  process.env.BACKEND_URL ||
  process.env.API_URL ||
  "http://127.0.0.1:10000"
).replace(/\/+$/, "");

if (!BOT_TOKEN) {
  console.warn("[TELEGRAM] TELEGRAM_BOT_TOKEN is not set. Bot disabled.");
  module.exports = {};
  return;
}

if (!TELEGRAM_ADMIN_ID) {
  console.warn("[TELEGRAM] TELEGRAM_ADMIN_ID is not set. Bot disabled.");
  module.exports = {};
  return;
}

if (!ADMIN_KEY) {
  console.warn("[TELEGRAM] ADMIN_KEY is not set. Bot disabled.");
  module.exports = {};
  return;
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

let offset = 0;
let running = false;

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegram(method, body = {}) {
  const response = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || `Telegram API error: ${method}`);
  }

  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function argsOf(text) {
  return clean(text)
    .split(/\s+/)
    .slice(1)
    .filter(Boolean);
}

function isAdmin(message) {
  return String(message?.from?.id || "") === TELEGRAM_ADMIN_ID;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US");
}

function commandName(text) {
  return clean(text).split(/\s+/)[0].toLowerCase().split("@")[0];
}

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(`Backend returned HTTP ${response.status}`);
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.message ||
      data?.error ||
      `Backend returned HTTP ${response.status}`
    );
  }

  return data;
}

async function adminApi(path, body) {
  return api(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ADMIN_KEY}`
    },
    body: JSON.stringify(body)
  });
}

/* =========================================================
   USER LOOKUP
========================================================= */

async function getUser(robloxId) {
  return api(`/account/${encodeURIComponent(robloxId)}`);
}

async function lookupRoblox(username) {
  return api(`/user/${encodeURIComponent(username)}`);
}

function findPet(user, petName) {
  const wanted = clean(petName).toLowerCase();

  return (user.inventory || []).find(
    pet =>
      String(pet?.name || "").toLowerCase() === wanted
  );
}

/* =========================================================
   COMMANDS
========================================================= */

async function cmdStart(chatId) {
  await sendMessage(
    chatId,
    `<b>ADMFLIP Admin Bot</b>

Use /commands to see every available command.`
  );
}

async function cmdCommands(chatId) {
  await sendMessage(
    chatId,
    `<b>ADMFLIP COMMANDS</b>

<b>Users</b>
/user &lt;robloxId&gt;
/lookup &lt;username&gt;

<b>Pets</b>
/pets &lt;robloxId&gt;
/addpet &lt;robloxId&gt; &lt;pet name&gt;
/removepet &lt;robloxId&gt; &lt;pet name&gt;
/transferpet &lt;fromId&gt; &lt;toId&gt; &lt;pet name&gt;

<b>Balance</b>
/balance &lt;robloxId&gt; &lt;amount&gt;
/setbalance &lt;robloxId&gt; &lt;amount&gt;

<b>Coinflips</b>
/coinflips
/cancelcf &lt;flipId&gt;
/joincf &lt;flipId&gt; &lt;robloxId&gt;

<b>System</b>
/status
/commands

All commands are admin-only.`
  );
}

async function cmdUser(chatId, args) {
  if (!args[0]) {
    return sendMessage(chatId, "Usage: <code>/user RobloxId</code>");
  }

  const data = await getUser(args[0]);
  const user = data.user;

  if (!user) {
    return sendMessage(chatId, "User not found.");
  }

  await sendMessage(
    chatId,
    `<b>USER</b>

<b>Username:</b> ${escapeHtml(user.username)}
<b>Roblox ID:</b> <code>${escapeHtml(user.robloxId)}</code>
<b>Verified:</b> ${user.verified ? "Yes" : "No"}
<b>Balance:</b> ${money(user.balance)}
<b>Wagered:</b> ${money(user.wagered)}
<b>Profit:</b> ${money(user.profit)}
<b>Coinflips:</b> ${user.coinflips || 0}
<b>Wins:</b> ${user.wins || 0}
<b>Pets:</b> ${(user.inventory || []).length}`
  );
}

async function cmdLookup(chatId, args) {
  if (!args[0]) {
    return sendMessage(chatId, "Usage: <code>/lookup Username</code>");
  }

  const data = await lookupRoblox(args[0]);
  const user = data.user;

  await sendMessage(
    chatId,
    `<b>ROBLOX USER</b>

<b>Username:</b> ${escapeHtml(user.username)}
<b>Display:</b> ${escapeHtml(user.displayName || user.username)}
<b>Roblox ID:</b> <code>${escapeHtml(user.id)}</code>`
  );
}

async function cmdPets(chatId, args) {
  if (!args[0]) {
    return sendMessage(chatId, "Usage: <code>/pets RobloxId</code>");
  }

  const data = await getUser(args[0]);
  const user = data.user;

  const inventory = user.inventory || [];

  if (!inventory.length) {
    return sendMessage(
      chatId,
      `<b>${escapeHtml(user.username)}</b> has no pets.`
    );
  }

  const lines = inventory.map((pet, index) => {
    return `${index + 1}. <b>${escapeHtml(pet.name)}</b> — ${money(pet.value)}`;
  });

  await sendMessage(
    chatId,
    `<b>${escapeHtml(user.username)}'s PETS</b>

${lines.join("\n")}`
  );
}

async function cmdAddPet(chatId, args) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: <code>/addpet RobloxId Pet Name</code>"
    );
  }

  const robloxId = args.shift();
  const petName = args.join(" ");

  const result = await adminApi("/admin/grant", {
    robloxId,
    pets: [{ name: petName }]
  });

  if (!result.addedPets) {
    return sendMessage(
      chatId,
      `❌ Pet <b>${escapeHtml(petName)}</b> was not found in values.txt.`
    );
  }

  await sendMessage(
    chatId,
    `✅ Added <b>${escapeHtml(petName)}</b> to <code>${escapeHtml(robloxId)}</code>.`
  );
}

async function cmdRemovePet(chatId, args) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: <code>/removepet RobloxId Pet Name</code>"
    );
  }

  const robloxId = args.shift();
  const petName = args.join(" ");

  const result = await adminApi("/admin/remove-pet", {
    robloxId,
    petName
  });

  await sendMessage(
    chatId,
    `✅ Removed <b>${escapeHtml(result.removedPet.name)}</b> from <code>${escapeHtml(robloxId)}</code>.`
  );
}

async function cmdTransferPet(chatId, args) {
  if (args.length < 3) {
    return sendMessage(
      chatId,
      "Usage: <code>/transferpet FromId ToId Pet Name</code>"
    );
  }

  const fromId = args.shift();
  const toId = args.shift();
  const petName = args.join(" ");

  const result = await adminApi("/admin/transfer-pet", {
    fromRobloxId: fromId,
    toRobloxId: toId,
    petName
  });

  await sendMessage(
    chatId,
    `✅ Transferred <b>${escapeHtml(result.pet.name)}</b>

From: <code>${escapeHtml(fromId)}</code>
To: <code>${escapeHtml(toId)}</code>`
  );
}

async function cmdBalance(chatId, args) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: <code>/balance RobloxId Amount</code>\n\nUse a positive number to add or negative number to remove."
    );
  }

  const robloxId = args[0];
  const amount = Number(args[1]);

  if (!Number.isFinite(amount)) {
    return sendMessage(chatId, "Invalid amount.");
  }

  const result = await adminApi("/admin/grant", {
    robloxId,
    balance: amount
  });

  await sendMessage(
    chatId,
    `✅ Balance changed by <b>${money(amount)}</b>.

New balance: <b>${money(result.user.balance)}</b>`
  );
}

async function cmdSetBalance(chatId, args) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: <code>/setbalance RobloxId Amount</code>"
    );
  }

  const robloxId = args[0];
  const amount = Number(args[1]);

  if (!Number.isFinite(amount) || amount < 0) {
    return sendMessage(chatId, "Invalid balance.");
  }

  const result = await adminApi("/admin/set-balance", {
    robloxId,
    balance: amount
  });

  await sendMessage(
    chatId,
    `✅ Balance set to <b>${money(result.user.balance)}</b>.`
  );
}

async function cmdCoinflips(chatId) {
  const data = await api("/coinflips");
  const flips = data.coinflips || [];

  if (!flips.length) {
    return sendMessage(chatId, "There are no active coinflips.");
  }

  const lines = flips.slice(0, 30).map((flip, index) => {
    return `<b>${index + 1}. ${escapeHtml(flip.username)}</b>
ID: <code>${escapeHtml(flip.id)}</code>
Pet: ${escapeHtml(flip.petName)}
Value: ${money(flip.petValue)}
Side: ${escapeHtml(flip.side)}`;
  });

  await sendMessage(
    chatId,
    `<b>ACTIVE COINFLIPS</b>

${lines.join("\n\n")}`
  );
}

async function cmdCancelCoinflip(chatId, args) {
  if (!args[0]) {
    return sendMessage(
      chatId,
      "Usage: <code>/cancelcf FlipId</code>"
    );
  }

  const result = await adminApi("/admin/cancel-coinflip", {
    flipId: args[0]
  });

  await sendMessage(
    chatId,
    `✅ Coinflip cancelled.

Pet refunded: <b>${escapeHtml(result.flip.petName)}</b>`
  );
}

async function cmdJoinCoinflip(chatId, args) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: <code>/joincf FlipId RobloxId</code>\n\nThe bot uses the same pet as the coinflip creator."
    );
  }

  const flipId = args[0];
  const robloxId = args[1];

  const result = await adminApi("/admin/join-coinflip", {
    flipId,
    robloxId
  });

  await sendMessage(
    chatId,
    `🎲 <b>COINFLIP JOINED</b>

Flip: <code>${escapeHtml(flipId)}</code>
Player: <code>${escapeHtml(robloxId)}</code>
Pet used: <b>${escapeHtml(result.petName)}</b>
Toss: <b>${escapeHtml(result.toss)}</b>
Winner: <b>${escapeHtml(result.winner.username)}</b>`
  );
}

async function cmdStatus(chatId) {
  const data = await api("/status");

  await sendMessage(
    chatId,
    `<b>ADMFLIP STATUS</b>

Online: ${data.online ? "🟢 Yes" : "🔴 No"}
Active coinflips: ${data.activeCoinflips}
Total coinflip value: ${money(data.totalCoinflipValue)}`
  );
}

/* =========================================================
   COMMAND ROUTER
========================================================= */

async function handleMessage(message) {
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = clean(message.text);

  if (!isAdmin(message)) {
    await sendMessage(chatId, "❌ You are not authorized to use this bot.");
    return;
  }

  const command = commandName(text);
  const args = argsOf(text);

  try {
    switch (command) {
      case "/start":
        return cmdStart(chatId);

      case "/commands":
      case "/help":
        return cmdCommands(chatId);

      case "/user":
        return cmdUser(chatId, args);

      case "/lookup":
        return cmdLookup(chatId, args);

      case "/pets":
        return cmdPets(chatId, args);

      case "/addpet":
        return cmdAddPet(chatId, args);

      case "/removepet":
      case "/remove_pet":
        return cmdRemovePet(chatId, args);

      case "/transferpet":
      case "/transfer_pet":
        return cmdTransferPet(chatId, args);

      case "/balance":
        return cmdBalance(chatId, args);

      case "/setbalance":
        return cmdSetBalance(chatId, args);

      case "/coinflips":
      case "/coinflip":
        return cmdCoinflips(chatId);

      case "/cancelcf":
      case "/cancel_coinflip":
        return cmdCancelCoinflip(chatId, args);

      case "/joincf":
      case "/join_coinflip":
        return cmdJoinCoinflip(chatId, args);

      case "/status":
        return cmdStatus(chatId);

      default:
        return sendMessage(
          chatId,
          `Unknown command.

Use /commands to see the available commands.`
        );
    }
  } catch (error) {
    console.error("[TELEGRAM COMMAND ERROR]", error);

    await sendMessage(
      chatId,
      `❌ <b>Error</b>\n\n${escapeHtml(error.message || "Something went wrong.")}`
    );
  }
}

/* =========================================================
   POLLING
========================================================= */

async function poll() {
  if (running) return;

  running = true;

  try {
    const updates = await telegram("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"]
    });

    for (const update of updates) {
      offset = update.update_id + 1;

      try {
        await handleMessage(update.message);
      } catch (error) {
        console.error("[TELEGRAM UPDATE ERROR]", error);
      }
    }
  } catch (error) {
    console.error("[TELEGRAM POLLING ERROR]", error.message);
    await new Promise(resolve => setTimeout(resolve, 3000));
  } finally {
    running = false;
  }

  setImmediate(poll);
}

/* =========================================================
   START
========================================================= */

async function startBot() {
  try {
    const me = await telegram("getMe");

    console.log(
      `[TELEGRAM] Logged in as @${me.username}`
    );

    await telegram("deleteWebhook", {
      drop_pending_updates: false
    });

    await telegram("setMyCommands", {
      commands: [
        { command: "commands", description: "Show all commands" },
        { command: "user", description: "View a user" },
        { command: "lookup", description: "Find Roblox user" },
        { command: "pets", description: "View user's pets" },
        { command: "addpet", description: "Add a pet" },
        { command: "removepet", description: "Remove a pet" },
        { command: "transferpet", description: "Transfer a pet" },
        { command: "balance", description: "Change balance" },
        { command: "setbalance", description: "Set balance" },
        { command: "coinflips", description: "View active coinflips" },
        { command: "joincf", description: "Join a coinflip" },
        { command: "cancelcf", description: "Cancel a coinflip" },
        { command: "status", description: "Show server status" }
      ]
    });

    console.log("[TELEGRAM] Bot started.");

    poll();
  } catch (error) {
    console.error("[TELEGRAM] Failed to start:", error);
  }
}

startBot();

module.exports = {
  startBot
};
