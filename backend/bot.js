"use strict";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ADMIN_ID = String(
  process.env.TELEGRAM_ADMIN_ID || ""
).trim();

const ADMIN_KEY = process.env.ADMIN_KEY || "";

const API_URL = (
  process.env.BACKEND_URL ||
  "http://127.0.0.1:10000"
).replace(/\/+$/, "");

if (!BOT_TOKEN) {
  console.warn("[TELEGRAM] TELEGRAM_BOT_TOKEN missing.");
  module.exports = {};
  return;
}

if (!TELEGRAM_ADMIN_ID) {
  console.warn("[TELEGRAM] TELEGRAM_ADMIN_ID missing.");
  module.exports = {};
  return;
}

if (!ADMIN_KEY) {
  console.warn("[TELEGRAM] ADMIN_KEY missing.");
  module.exports = {};
  return;
}

const TELEGRAM_API =
  `https://api.telegram.org/bot${BOT_TOKEN}`;

let updateOffset = 0;
let polling = false;

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function commandName(text) {
  return clean(text)
    .split(/\s+/)[0]
    .toLowerCase()
    .split("@")[0];
}

function commandArgs(text) {
  return clean(text)
    .split(/\s+/)
    .slice(1)
    .filter(Boolean);
}

function isAdmin(message) {
  return (
    String(message?.from?.id || "") ===
    TELEGRAM_ADMIN_ID
  );
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString("en-US");
}

async function telegram(method, body = {}) {
  const response = await fetch(
    `${TELEGRAM_API}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      `Telegram error: ${method}`
    );
  }

  return data.result;
}

async function sendMessage(
  chatId,
  text
) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    }
  );
}

async function api(
  endpoint,
  options = {}
) {
  const response = await fetch(
    `${API_URL}${endpoint}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Backend returned HTTP ${response.status}`
    );
  }

  if (
    !response.ok ||
    data?.success === false
  ) {
    throw new Error(
      data?.message ||
      data?.error ||
      `Backend returned HTTP ${response.status}`
    );
  }

  return data;
}

async function adminApi(
  endpoint,
  body
) {
  return api(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${ADMIN_KEY}`
      },
      body: JSON.stringify(body)
    }
  );
}

/* =====================================================
   BASIC
===================================================== */

async function startCommand(
  chatId
) {
  return sendMessage(
    chatId,
    `<b>ADMFLIP ADMIN BOT</b>

Use /commands to view every command.`
  );
}

async function commandsCommand(
  chatId
) {
  return sendMessage(
    chatId,
    `<b>ADMFLIP COMMANDS</b>

<b>USERS</b>

/user &lt;robloxId&gt;
/lookup &lt;username&gt;
/pets &lt;robloxId&gt;

<b>PETS</b>

/addpet &lt;robloxId&gt; &lt;pet name&gt;
/removepet &lt;robloxId&gt; &lt;pet name&gt;
/transferpet &lt;fromId&gt; &lt;toId&gt; &lt;pet name&gt;

<b>BALANCE</b>

/balance &lt;robloxId&gt; &lt;amount&gt;
/setbalance &lt;robloxId&gt; &lt;amount&gt;

<b>COINFLIPS</b>

/coinflips
/cancelcf &lt;flipId&gt;
/joincf &lt;flipId&gt; &lt;robloxId&gt; [pet name]

<b>SYSTEM</b>

/status
/online
/totalcf

All commands are admin-only.`
  );
}

/* =====================================================
   USER
===================================================== */

async function userCommand(
  chatId,
  args
) {
  if (!args[0]) {
    return sendMessage(
      chatId,
      "Usage: /user RobloxId"
    );
  }

  const data = await api(
    `/account/${encodeURIComponent(
      args[0]
    )}`
  );

  const user = data.user;

  if (!user) {
    return sendMessage(
      chatId,
      "User not found."
    );
  }

  return sendMessage(
    chatId,
    `<b>USER</b>

Username: <b>${escapeHtml(
      user.username
    )}</b>

Roblox ID:
<code>${escapeHtml(
      user.id
    )}</code>

Verified:
${user.verified ? "✅ Yes" : "❌ No"}

Balance:
<b>${formatNumber(
      user.balance
    )}</b>

Wagered:
<b>${formatNumber(
      user.wagered
    )}</b>

Profit:
<b>${formatNumber(
      user.profit
    )}</b>

Coinflips:
<b>${user.coinflips || 0}</b>

Wins:
<b>${user.wins || 0}</b>

Pets:
<b>${(
      user.inventory || []
    ).length}</b>`
  );
}

/* =====================================================
   ROBLOX LOOKUP
===================================================== */

async function lookupCommand(
  chatId,
  args
) {
  if (!args[0]) {
    return sendMessage(
      chatId,
      "Usage: /lookup Username"
    );
  }

  const data =
    await api(
      `/user/${encodeURIComponent(
        args[0]
      )}`
    );

  const user = data.user;

  if (!user) {
    return sendMessage(
      chatId,
      "Roblox user not found."
    );
  }

  return sendMessage(
    chatId,
    `<b>ROBLOX USER</b>

Username:
<b>${escapeHtml(
      user.username
    )}</b>

Display:
<b>${escapeHtml(
      user.displayName ||
      user.username
    )}</b>

Roblox ID:
<code>${escapeHtml(
      user.id
    )}</code>`
  );
}

/* =====================================================
   PETS
===================================================== */

async function petsCommand(
  chatId,
  args
) {
  if (!args[0]) {
    return sendMessage(
      chatId,
      "Usage: /pets RobloxId"
    );
  }

  const data =
    await api(
      `/account/${encodeURIComponent(
        args[0]
      )}`
    );

  const user = data.user;

  if (!user) {
    return sendMessage(
      chatId,
      "User not found."
    );
  }

  const pets =
    Array.isArray(user.inventory)
      ? user.inventory
      : [];

  if (!pets.length) {
    return sendMessage(
      chatId,
      `<b>${escapeHtml(
        user.username
      )}</b> has no pets.`
    );
  }

  const lines =
    pets.map(
      (pet, index) =>
        `${index + 1}. <b>${escapeHtml(
          pet.name
        )}</b> — ${formatNumber(
          pet.value
        )}`
    );

  return sendMessage(
    chatId,
    `<b>${escapeHtml(
      user.username
    )}'S PETS</b>

${lines.join("\n")}`
  );
}

/* =====================================================
   ADD PET
===================================================== */

async function addPetCommand(
  chatId,
  args
) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: /addpet RobloxId Pet Name"
    );
  }

  const robloxId =
    args.shift();

  const petName =
    args.join(" ");

  const result =
    await adminApi(
      "/admin/grant",
      {
        robloxId,
        pets: [
          {
            name: petName
          }
        ]
      }
    );

  if (
    !result.addedPets ||
    result.addedPets < 1
  ) {
    return sendMessage(
      chatId,
      `❌ Pet <b>${escapeHtml(
        petName
      )}</b> was not found in the backend values.`
    );
  }

  return sendMessage(
    chatId,
    `✅ Added <b>${escapeHtml(
      petName
    )}</b> to <code>${escapeHtml(
      robloxId
    )}</code>.`
  );
}

/* =====================================================
   REMOVE PET
===================================================== */

async function removePetCommand(
  chatId,
  args
) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: /removepet RobloxId Pet Name"
    );
  }

  const robloxId =
    args.shift();

  const petName =
    args.join(" ");

  const result =
    await adminApi(
      "/admin/remove-pet",
      {
        robloxId,
        petName
      }
    );

  return sendMessage(
    chatId,
    `✅ Removed <b>${escapeHtml(
      result.removedPet?.name ||
      petName
    )}</b>

User:
<code>${escapeHtml(
      robloxId
    )}</code>`
  );
}

/* =====================================================
   TRANSFER
===================================================== */

async function transferPetCommand(
  chatId,
  args
) {
  if (args.length < 3) {
    return sendMessage(
      chatId,
      "Usage: /transferpet FromId ToId Pet Name"
    );
  }

  const fromRobloxId =
    args.shift();

  const toRobloxId =
    args.shift();

  const petName =
    args.join(" ");

  const result =
    await adminApi(
      "/admin/transfer-pet",
      {
        fromRobloxId,
        toRobloxId,
        petName
      }
    );

  return sendMessage(
    chatId,
    `✅ <b>PET TRANSFERRED</b>

Pet:
<b>${escapeHtml(
      result.pet?.name ||
      petName
    )}</b>

From:
<code>${escapeHtml(
      fromRobloxId
    )}</code>

To:
<code>${escapeHtml(
      toRobloxId
    )}</code>`
  );
}

/* =====================================================
   BALANCE
===================================================== */

async function balanceCommand(
  chatId,
  args
) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: /balance RobloxId Amount"
    );
  }

  const robloxId =
    args[0];

  const amount =
    Number(args[1]);

  if (!Number.isFinite(amount)) {
    return sendMessage(
      chatId,
      "Invalid amount."
    );
  }

  const result =
    await adminApi(
      "/admin/grant",
      {
        robloxId,
        balance: amount
      }
    );

  return sendMessage(
    chatId,
    `✅ Balance changed.

Change:
<b>${formatNumber(
      amount
    )}</b>

New balance:
<b>${formatNumber(
      result.user.balance
    )}</b>`
  );
}

async function setBalanceCommand(
  chatId,
  args
) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: /setbalance RobloxId Amount"
    );
  }

  const robloxId =
    args[0];

  const balance =
    Number(args[1]);

  if (
    !Number.isFinite(balance) ||
    balance < 0
  ) {
    return sendMessage(
      chatId,
      "Invalid balance."
    );
  }

  const result =
    await adminApi(
      "/admin/set-balance",
      {
        robloxId,
        balance
      }
    );

  return sendMessage(
    chatId,
    `✅ Balance set to:

<b>${formatNumber(
      result.user.balance
    )}</b>`
  );
}

/* =====================================================
   COINFLIPS
===================================================== */

async function coinflipsCommand(
  chatId
) {
  const data =
    await api(
      "/coinflips"
    );

  const flips =
    data.coinflips || [];

  if (!flips.length) {
    return sendMessage(
      chatId,
      "There are currently no active coinflips."
    );
  }

  const output =
    flips
      .slice(0, 30)
      .map(
        (flip, index) =>
          `<b>${index + 1}. ${escapeHtml(
            flip.username ||
            "Unknown"
          )}</b>

ID:
<code>${escapeHtml(
            flip.id
          )}</code>

Pet:
${escapeHtml(
            flip.petName
          )}

Value:
<b>${formatNumber(
            flip.petValue
          )}</b>

Side:
${escapeHtml(
            flip.side
          )}`
      )
      .join("\n\n");

  return sendMessage(
    chatId,
    `<b>ACTIVE COINFLIPS</b>

${output}`
  );
}

/* =====================================================
   CANCEL
===================================================== */

async function cancelCoinflipCommand(
  chatId,
  args
) {
  if (!args[0]) {
    return sendMessage(
      chatId,
      "Usage: /cancelcf FlipId"
    );
  }

  const result =
    await adminApi(
      "/admin/cancel-coinflip",
      {
        flipId: args[0]
      }
    );

  return sendMessage(
    chatId,
    `✅ Coinflip cancelled.

Refunded:
<b>${escapeHtml(
      result.flip?.petName ||
      "Pet"
    )}</b>`
  );
}

/* =====================================================
   JOIN
===================================================== */

async function joinCoinflipCommand(
  chatId,
  args
) {
  if (args.length < 2) {
    return sendMessage(
      chatId,
      "Usage: /joincf FlipId RobloxId [Pet Name]"
    );
  }

  const flipId =
    args.shift();

  const robloxId =
    args.shift();

  const petName =
    args.join(" ");

  const result =
    await adminApi(
      "/admin/join-coinflip",
      {
        flipId,
        robloxId,
        ...(petName
          ? { petName }
          : {})
      }
    );

  return sendMessage(
    chatId,
    `🎲 <b>COINFLIP COMPLETE</b>

Flip:
<code>${escapeHtml(
      flipId
    )}</code>

Player:
<code>${escapeHtml(
      robloxId
    )}</code>

Pet:
<b>${escapeHtml(
      result.petName ||
      petName ||
      "Pet"
    )}</b>

Toss:
<b>${escapeHtml(
      result.toss ||
      "Unknown"
    )}</b>

Winner:
<b>${escapeHtml(
      result.winner?.username ||
      "Unknown"
    )}</b>`
  );
}

/* =====================================================
   STATUS
===================================================== */

async function statusCommand(
  chatId
) {
  const data =
    await api(
      "/status"
    );

  return sendMessage(
    chatId,
    `<b>ADMFLIP STATUS</b>

Server:
🟢 Online

Online users:
<b>${data.onlineUsers ?? 0}</b>

Active coinflips:
<b>${data.activeCoinflips ?? 0}</b>

Total coinflips:
<b>${data.totalCoinflips ?? 0}</b>

Active value:
<b>${formatNumber(
      data.totalCoinflipValue
    )}</b>`
  );
}

async function onlineCommand(
  chatId
) {
  const data =
    await api(
      "/status"
    );

  return sendMessage(
    chatId,
    `👥 <b>ONLINE USERS</b>

<b>${data.onlineUsers ?? 0}</b>`
  );
}

async function totalCoinflipsCommand(
  chatId
) {
  const data =
    await api(
      "/status"
    );

  return sendMessage(
    chatId,
    `🎲 <b>TOTAL COINFLIPS</b>

<b>${data.totalCoinflips ?? 0}</b>`
  );
}

/* =====================================================
   ROUTER
===================================================== */

async function handleMessage(
  message
) {
  if (!message?.text) {
    return;
  }

  const chatId =
    message.chat.id;

  if (!isAdmin(message)) {
    return sendMessage(
      chatId,
      "❌ You are not authorized to use this bot."
    );
  }

  const command =
    commandName(
      message.text
    );

  const args =
    commandArgs(
      message.text
    );

  try {
    switch (command) {
      case "/start":
        return startCommand(
          chatId
        );

      case "/commands":
      case "/help":
        return commandsCommand(
          chatId
        );

      case "/user":
        return userCommand(
          chatId,
          args
        );

      case "/lookup":
        return lookupCommand(
          chatId,
          args
        );

      case "/pets":
        return petsCommand(
          chatId,
          args
        );

      case "/addpet":
        return addPetCommand(
          chatId,
          args
        );

      case "/removepet":
      case "/remove_pet":
        return removePetCommand(
          chatId,
          args
        );

      case "/transferpet":
      case "/transfer_pet":
        return transferPetCommand(
          chatId,
          args
        );

      case "/balance":
        return balanceCommand(
          chatId,
          args
        );

      case "/setbalance":
        return setBalanceCommand(
          chatId,
          args
        );

      case "/coinflips":
      case "/coinflip":
        return coinflipsCommand(
          chatId
        );

      case "/cancelcf":
      case "/cancel_coinflip":
        return cancelCoinflipCommand(
          chatId,
          args
        );

      case "/joincf":
      case "/join_coinflip":
        return joinCoinflipCommand(
          chatId,
          args
        );

      case "/status":
        return statusCommand(
          chatId
        );

      case "/online":
        return onlineCommand(
          chatId
        );

      case "/totalcf":
      case "/totalcoinflips":
        return totalCoinflipsCommand(
          chatId
        );

      default:
        return sendMessage(
          chatId,
          "❌ Unknown command.\n\nUse /commands."
        );
    }
  } catch (error) {
    console.error(
      "[TELEGRAM]",
      error
    );

    return sendMessage(
      chatId,
      `❌ <b>Command failed</b>

${escapeHtml(
        error.message ||
        "Unknown error."
      )}`
    );
  }
}

/* =====================================================
   POLLING
===================================================== */

async function poll() {
  if (polling) {
    return;
  }

  polling = true;

  try {
    const updates =
      await telegram(
        "getUpdates",
        {
          offset:
            updateOffset,
          timeout: 25,
          allowed_updates: [
            "message"
          ]
        }
      );

    for (
      const update of updates
    ) {
      updateOffset =
        update.update_id + 1;

      try {
        await handleMessage(
          update.message
        );
      } catch (error) {
        console.error(
          "[TELEGRAM UPDATE]",
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "[TELEGRAM POLL]",
      error.message
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );
  } finally {
    polling = false;
  }

  setImmediate(poll);
}

/* =====================================================
   START
===================================================== */

async function startBot() {
  try {
    const me =
      await telegram(
        "getMe"
      );

    console.log(
      `[TELEGRAM] Connected as @${me.username}`
    );

    await telegram(
      "deleteWebhook",
      {
        drop_pending_updates:
          false
      }
    );

    await telegram(
      "setMyCommands",
      {
        commands: [
          {
            command: "commands",
            description: "Show commands"
          },
          {
            command: "user",
            description: "View user"
          },
          {
            command: "lookup",
            description: "Find Roblox user"
          },
          {
            command: "pets",
            description: "View pets"
          },
          {
            command: "addpet",
            description: "Add pet"
          },
          {
            command: "removepet",
            description: "Remove pet"
          },
          {
            command: "transferpet",
            description: "Transfer pet"
          },
          {
            command: "balance",
            description: "Change balance"
          },
          {
            command: "setbalance",
            description: "Set balance"
          },
          {
            command: "coinflips",
            description: "View coinflips"
          },
          {
            command: "cancelcf",
            description: "Cancel coinflip"
          },
          {
            command: "joincf",
            description: "Join coinflip"
          },
          {
            command: "status",
            description: "Server status"
          },
          {
            command: "online",
            description: "Online users"
          },
          {
            command: "totalcf",
            description: "Total coinflips"
          }
        ]
      }
    );

    poll();
  } catch (error) {
    console.error(
      "[TELEGRAM START]",
      error
    );
  }
}

startBot();

module.exports = {
  startBot
};
