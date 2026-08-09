"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIG
========================================================= */

const FRONTEND_ORIGIN =
  "https://admflip-beta.vyxlez.workers.dev";

const VALUES_FILE =
  path.join(__dirname, "values.txt");

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization"
    ]
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  const n = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .replace(/[^0-9.-]/g, "")
  );

  return Number.isFinite(n) ? n : 0;
}

function makeId() {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function petImage(name) {
  return (
    "https://amvgg.com/items/" +
    encodeURIComponent(String(name)) +
    ".webp"
  );
}

/* =========================================================
   VALUES
========================================================= */

function loadPets() {
  if (!fs.existsSync(VALUES_FILE)) {
    console.error(
      "values.txt not found:",
      VALUES_FILE
    );

    return [];
  }

  try {
    const text = fs.readFileSync(
      VALUES_FILE,
      "utf8"
    );

    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const result = [];

    for (let i = 0; i < lines.length; i++) {
      const name = lines[i];

      if (/^\[\d+\]$/.test(name)) {
        continue;
      }

      let valueIndex = i + 1;

      while (
        valueIndex < lines.length &&
        /^\[\d+\]$/.test(
          lines[valueIndex]
        )
      ) {
        valueIndex++;
      }

      if (valueIndex >= lines.length) {
        continue;
      }

      const rawValue = lines[valueIndex];

      if (
        !/^-?\d+(?:\.\d+)?$/.test(
          rawValue
        )
      ) {
        continue;
      }

      const value = Number(rawValue);

      if (!Number.isFinite(value)) {
        continue;
      }

      result.push({
        id: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),

        name,

        value,

        image: petImage(name)
      });

      i = valueIndex;
    }

    console.log(
      `Loaded ${result.length} pets from values.txt`
    );

    return result;
  } catch (error) {
    console.error(
      "Could not read values.txt:",
      error
    );

    return [];
  }
}

let pets = loadPets();

function getPets() {
  pets = loadPets();
  return pets;
}

/* =========================================================
   IN-MEMORY DATA
========================================================= */

const users = new Map();

const coinflips = [];

const chatMessages = [];

/* =========================================================
   DEFAULT CHAT
========================================================= */

chatMessages.push({
  id: "welcome",

  username: "ADMFLIP",

  robloxId: null,

  avatar: "/logo.png",

  message: "Welcome to ADMFLIP.",

  type: "announcement",

  pinned: true,

  createdAt: Date.now()
});

/* =========================================================
   USER HELPERS
========================================================= */

function getUser(id) {
  return users.get(String(id));
}

function createOrUpdateUser(data) {
  const id = String(
    data.id ??
      data.robloxId ??
      data.userId ??
      ""
  ).trim();

  if (!id) {
    return null;
  }

  let user = users.get(id);

  if (!user) {
    user = {
      id,

      robloxId: id,

      username:
        clean(data.username) ||
        "User",

      avatar:
        clean(data.avatar),

      verified:
        Boolean(data.verified),

      balance: 0,

      wagered: 0,

      profit: 0,

      coinflips: 0,

      wins: 0,

      inventory: []
    };

    users.set(id, user);
  }

  if (data.username) {
    user.username = clean(
      data.username
    );
  }

  if (data.avatar) {
    user.avatar = clean(
      data.avatar
    );
  }

  if (data.verified !== undefined) {
    user.verified = Boolean(
      data.verified
    );
  }

  return user;
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,

    server: "online",

    pets: getPets().length,

    valuesFile: VALUES_FILE,

    cors: FRONTEND_ORIGIN
  });
});

/* =========================================================
   DEBUG
========================================================= */

app.get(
  "/debug-values",
  (req, res) => {
    const loaded = getPets();

    res.json({
      success: true,

      count: loaded.length,

      valuesFile: VALUES_FILE,

      firstPets: loaded.slice(0, 10)
    });
  }
);

/* =========================================================
   PETS
========================================================= */

app.get("/pets", (req, res) => {
  try {
    const loaded = getPets();

    res.set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      success: true,

      pets: loaded
    });
  } catch (error) {
    console.error(
      "GET /pets:",
      error
    );

    res.status(500).json({
      success: false,

      pets: [],

      error:
        "Unable to load pet values."
    });
  }
});

app.get("/api/pets", (req, res) => {
  const loaded = getPets();

  res.json({
    success: true,

    pets: loaded
  });
});

app.get(
  "/pets/:name",
  (req, res) => {
    const requested =
      decodeURIComponent(
        req.params.name
      )
        .trim()
        .toLowerCase();

    const pet = getPets().find(
      item =>
        item.name
          .trim()
          .toLowerCase() ===
        requested
    );

    if (!pet) {
      return res.status(404).json({
        success: false,

        error: "Pet not found."
      });
    }

    res.json({
      success: true,

      pet
    });
  }
);

/* =========================================================
   ROBLOX FETCH
========================================================= */

async function robloxFetch(
  url,
  options = {}
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    10000
  );

  try {
    return await fetch(
      url,
      {
        ...options,

        headers: {
          "User-Agent":
            "ADMFLIP/1.0",

          Accept:
            "application/json",

          ...(options.headers || {})
        },

        signal:
          controller.signal
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   ROBLOX USER SEARCH
========================================================= */

async function findRobloxUser(
  username
) {
  const cleanUsername =
    clean(username);

  if (!cleanUsername) {
    return null;
  }

  const response =
    await robloxFetch(
      "https://users.roblox.com/v1/usernames/users",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          usernames: [
            cleanUsername
          ],

          excludeBannedUsers:
            true
        })
      }
    );

  if (!response.ok) {
    throw new Error(
      `Roblox returned ${response.status}`
    );
  }

  const data =
    await response.json();

  const found =
    Array.isArray(data?.data)
      ? data.data
      : [];

  return (
    found.find(
      user =>
        String(
          user.name
        ).toLowerCase() ===
        cleanUsername.toLowerCase()
    ) ||
    found[0] ||
    null
  );
}

/* =========================================================
   ROBLOX AVATAR
========================================================= */

async function findRobloxAvatar(id) {
  try {
    const response =
      await robloxFetch(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
          encodeURIComponent(id) +
          "&size=150x150&format=Png&isCircular=false"
      );

    if (!response.ok) {
      return "";
    }

    const data =
      await response.json();

    return (
      data?.data?.[0]
        ?.imageUrl ||
      ""
    );
  } catch {
    return "";
  }
}

/* =========================================================
   ROBLOX PROFILE
========================================================= */

async function findRobloxProfile(id) {
  const response =
    await robloxFetch(
      "https://users.roblox.com/v1/users/" +
        encodeURIComponent(id)
    );

  if (!response.ok) {
    throw new Error(
      `Roblox profile returned ${response.status}`
    );
  }

  return response.json();
}

/* =========================================================
   USER LOOKUP
========================================================= */

async function userLookup(
  req,
  res
) {
  try {
    const username =
      clean(req.params.username);

    if (!username) {
      return res.status(400).json({
        success: false,

        message:
          "Username required."
      });
    }

    const robloxUser =
      await findRobloxUser(
        username
      );

    if (!robloxUser) {
      return res.status(404).json({
        success: false,

        message:
          "Roblox username not found."
      });
    }

    const avatar =
      await findRobloxAvatar(
        robloxUser.id
      );

    createOrUpdateUser({
      id: robloxUser.id,

      username:
        robloxUser.name,

      avatar
    });

    res.json({
      success: true,

      user: {
        id: robloxUser.id,

        username:
          robloxUser.name,

        displayName:
          robloxUser.displayName ||
          robloxUser.name,

        avatar
      }
    });
  } catch (error) {
    console.error(
      "Roblox lookup:",
      error
    );

    res.status(502).json({
      success: false,

      message:
        "The server could not reach Roblox right now."
    });
  }
}

app.get(
  "/user/:username",
  userLookup
);

app.get(
  "/api/user/:username",
  userLookup
);

/* =========================================================
   VERIFICATION
========================================================= */

function generatePhrase() {
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
    "ADMFLIP-" +
    first +
    "-" +
    second +
    "-" +
    number
  );
}

app.get(
  "/create",
  (req, res) => {
    res.json({
      success: true,

      phrase:
        generatePhrase()
    });
  }
);

app.get(
  "/api/create",
  (req, res) => {
    res.json({
      success: true,

      phrase:
        generatePhrase()
    });
  }
);

/* =========================================================
   ROBLOX BIO VERIFICATION
========================================================= */

async function verifyRobloxBio(
  req,
  res
) {
  try {
    const username =
      clean(
        req.body?.username
      );

    const phrase =
      clean(
        req.body?.phrase
      );

    if (!username || !phrase) {
      return res.status(400).json({
        success: false,

        message:
          "Username and phrase are required."
      });
    }

    const robloxUser =
      await findRobloxUser(
        username
      );

    if (!robloxUser) {
      return res.status(404).json({
        success: false,

        message:
          "Roblox username not found."
      });
    }

    const profile =
      await findRobloxProfile(
        robloxUser.id
      );

    const description =
      clean(
        profile?.description
      );

    if (
      !description
        .toLowerCase()
        .includes(
          phrase.toLowerCase()
        )
    ) {
      return res.json({
        success: false,

        message:
          "Verification phrase was not found in your Roblox About/Bio. Add it exactly, save your profile, then try again."
      });
    }

    const avatar =
      await findRobloxAvatar(
        robloxUser.id
      );

    const user =
      createOrUpdateUser({
        id: robloxUser.id,

        username:
          profile.name ||
          robloxUser.name,

        avatar,

        verified: true
      });

    res.json({
      success: true,

      id: robloxUser.id,

      userId: robloxUser.id,

      username:
        profile.name ||
        robloxUser.name,

      avatar,

      user
    });
  } catch (error) {
    console.error(
      "Bio verification:",
      error
    );

    res.status(502).json({
      success: false,

      message:
        "The server could not check Roblox right now."
    });
  }
}

app.post(
  "/check",
  verifyRobloxBio
);

app.post(
  "/api/check",
  verifyRobloxBio
);

/* =========================================================
   ACCOUNT
========================================================= */

async function accountHandler(
  req,
  res
) {
  try {
    const id =
      clean(
        req.params.robloxId
      );

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,

        message:
          "Invalid Roblox ID."
      });
    }

    let user = getUser(id);

    if (!user) {
      const profile =
        await findRobloxProfile(id);

      const avatar =
        await findRobloxAvatar(id);

      user =
        createOrUpdateUser({
          id,

          username:
            profile?.name ||
            "User",

          avatar
        });
    }

    res.json({
      success: true,

      user: {
        id: user.id,

        robloxId:
          user.robloxId,

        username:
          user.username,

        avatar:
          user.avatar,

        balance:
          user.balance || 0,

        wagered:
          user.wagered || 0,

        profit:
          user.profit || 0,

        coinflips:
          user.coinflips || 0,

        wins:
          user.wins || 0,

        inventory:
          Array.isArray(
            user.inventory
          )
            ? user.inventory
            : []
      }
    });
  } catch (error) {
    console.error(
      "Account:",
      error
    );

    res.status(404).json({
      success: false,

      message:
        "Account could not be loaded."
    });
  }
}

app.get(
  "/account/:robloxId",
  accountHandler
);

app.get(
  "/api/account/:robloxId",
  accountHandler
);

/* =========================================================
   CHAT
========================================================= */

function hasLink(text) {
  return /(?:https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(
    text
  );
}

app.get(
  "/chat/messages",
  (req, res) => {
    res.json({
      success: true,

      messages:
        chatMessages.slice(-100)
    });
  }
);

app.get(
  "/api/chat/messages",
  (req, res) => {
    res.json({
      success: true,

      messages:
        chatMessages.slice(-100)
    });
  }
);

function createChatMessage(
  req,
  res
) {
  const robloxId =
    clean(
      req.body?.robloxId ||
        req.body?.userId
    );

  const username =
    clean(
      req.body?.username
    );

  const avatar =
    clean(
      req.body?.avatar
    );

  const message =
    clean(
      req.body?.message
    );

  if (!robloxId || !username) {
    return res.status(401).json({
      success: false,

      message:
        "Sign in to chat."
    });
  }

  if (!message) {
    return res.status(400).json({
      success: false,

      message:
        "Message is empty."
    });
  }

  if (message.length > 250) {
    return res.status(400).json({
      success: false,

      message:
        "Message is too long."
    });
  }

  if (hasLink(message)) {
    return res.status(400).json({
      success: false,

      message:
        "Links are not allowed in chat."
    });
  }

  const chatMessage = {
    id: makeId(),

    username,

    robloxId,

    avatar:
      avatar || "/logo.png",

    message,

    type: "message",

    pinned: false,

    createdAt: Date.now()
  };

  chatMessages.push(
    chatMessage
  );

  if (chatMessages.length > 200) {
    chatMessages.shift();
  }

  res.json({
    success: true,

    message:
      chatMessage
  });
}

app.post(
  "/chat/messages",
  createChatMessage
);

app.post(
  "/api/chat/messages",
  createChatMessage
);

function getOnlineCount() {
  const cutoff =
    Date.now() -
    5 * 60 * 1000;

  const online =
    new Set(
      chatMessages
        .filter(
          message =>
            Number(
              message.createdAt
            ) >= cutoff
        )
        .map(
          message =>
            message.robloxId ||
            message.username
        )
    );

  return online.size;
}

app.get(
  "/chat/online",
  (req, res) => {
    const online =
      getOnlineCount();

    res.json({
      success: true,

      online,

      count: online,

      onlineCount: online
    });
  }
);

app.get(
  "/api/chat/online",
  (req, res) => {
    const online =
      getOnlineCount();

    res.json({
      success: true,

      online,

      count: online,

      onlineCount: online
    });
  }
);

/* =========================================================
   COINFLIPS
========================================================= */

app.get(
  "/coinflips",
  (req, res) => {
    const active =
      coinflips.filter(
        flip =>
          flip.status ===
          "active"
      );

    const totalValue =
      active.reduce(
        (sum, flip) =>
          sum +
          numeric(
            flip.petValue
          ),
        0
      );

    res.json({
      success: true,

      coinflips: active,

      total: active.length,

      totalValue
    });
  }
);

app.get(
  "/api/coinflips",
  (req, res) => {
    const active =
      coinflips.filter(
        flip =>
          flip.status ===
          "active"
      );

    res.json({
      success: true,

      coinflips: active
    });
  }
);

function createCoinflip(
  req,
  res
) {
  const username =
    clean(
      req.body?.username
    );

  const userId =
    clean(
      req.body?.userId ||
        req.body?.robloxId
    );

  if (!username || !userId) {
    return res.status(401).json({
      success: false,

      message:
        "Verify your Roblox account first."
    });
  }

  const side =
    clean(
      req.body?.side
    ).toLowerCase();

  if (
    side !== "heads" &&
    side !== "tails"
  ) {
    return res.status(400).json({
      success: false,

      message:
        "Choose heads or tails."
    });
  }

  const inputPet =
    req.body?.pet || {};

  const name =
    clean(
      inputPet.name ||
        req.body?.petName
    );

  if (!name) {
    return res.status(400).json({
      success: false,

      message:
        "Select a pet."
    });
  }

  const serverPet =
    getPets().find(
      pet =>
        pet.name
          .toLowerCase() ===
        name.toLowerCase()
    );

  if (!serverPet) {
    return res.status(400).json({
      success: false,

      message:
        "That pet is not in the current value list."
    });
  }

  const user =
    createOrUpdateUser({
      id: userId,

      username,

      avatar:
        clean(
          req.body?.avatar
        ),

      verified: true
    });

  user.wagered +=
    serverPet.value;

  user.coinflips += 1;

  const flip = {
    id: makeId(),

    username:
      user.username,

    userId: user.id,

    robloxId: user.id,

    avatar:
      user.avatar ||
      "/logo.png",

    petName:
      serverPet.name,

    petValue:
      serverPet.value,

    value:
      serverPet.value,

    image:
      serverPet.image,

    side,

    status: "active",

    createdAt:
      Date.now()
  };

  coinflips.unshift(flip);

  if (coinflips.length > 100) {
    coinflips.pop();
  }

  res.status(201).json({
    success: true,

    coinflip: flip
  });
}

app.post(
  "/coinflips",
  createCoinflip
);

app.post(
  "/api/coinflips",
  createCoinflip
);

/* =========================================================
   LEADERBOARD
========================================================= */

function leaderboardHandler(
  req,
  res
) {
  const leaderboard =
    Array.from(
      users.values()
    )
      .sort(
        (a, b) =>
          numeric(b.wagered) -
          numeric(a.wagered)
      )
      .slice(0, 10)
      .map(
        (user, index) => ({
          place:
            index + 1,

          username:
            user.username,

          avatar:
            user.avatar ||
            "/logo.png",

          wagered:
            user.wagered || 0,

          profit:
            user.profit || 0
        })
      );

  res.json({
    success: true,

    users:
      leaderboard
  });
}

app.get(
  "/leaderboard",
  leaderboardHandler
);

app.get(
  "/api/leaderboard",
  leaderboardHandler
);

/* =========================================================
   STATUS
========================================================= */

function statusHandler(
  req,
  res
) {
  const active =
    coinflips.filter(
      flip =>
        flip.status ===
        "active"
    );

  res.json({
    success: true,

    online: true,

    announcement: "",

    activeCoinflips:
      active.length,

    totalCoinflipValue:
      active.reduce(
        (sum, flip) =>
          sum +
          numeric(
            flip.petValue
          ),
        0
      )
  });
}

app.get(
  "/status",
  statusHandler
);

app.get(
  "/api/status",
  statusHandler
);

/* =========================================================
   API 404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,

      error:
        "API route not found.",

      path:
        req.path
    });
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "ADMFLIP SERVER ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,

      message:
        "Internal server error."
    });
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "ADMFLIP backend started"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Values:",
      VALUES_FILE
    );

    console.log(
      "Pets loaded:",
      getPets().length
    );

    console.log(
      "CORS:",
      FRONTEND_ORIGIN
    );

    console.log(
      "========================================"
    );
  }
);
