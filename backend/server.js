"use strict";

/*
=========================================================
ADMFLIP BACKEND — v3.0 SUPABASE
=========================================================

- Supabase database instead of db.json
- Roblox verification
- Roblox user/avatar lookup
- Pet values from values.txt
- Coinflips
- Chat
- Leaderboard
- Account persistence
- CORS
- Rate limiting
- Optional frontend serving

REQUIRED RAILWAY ENVIRONMENT VARIABLES:

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SECRET_KEY

FRONTEND_ORIGIN=https://admflip-beta.vyxlez.workers.dev

PORT is automatically provided by Railway.
*/

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* =========================================================
CONFIG
========================================================= */

const PORT = Number(process.env.PORT) || 10000;

const FRONTEND_ORIGIN = (
  process.env.FRONTEND_ORIGIN ||
  "https://admflip-beta.vyxlez.workers.dev"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VALUES_FILE =
  process.env.VALUES_FILE ||
  path.join(__dirname, "values.txt");

const PUBLIC_DIR =
  process.env.PUBLIC_DIR ||
  path.join(__dirname, "public");

const ROBLOX_TIMEOUT_MS =
  Number(process.env.ROBLOX_TIMEOUT_MS) || 10000;

const ROBLOX_CACHE_TTL =
  10 * 60 * 1000;

const AVATAR_CACHE_TTL =
  60 * 60 * 1000;

const ROBLOX_RATE_MAX = 20;
const ROBLOX_RATE_WINDOW = 60 * 1000;

const MAX_CHAT_MESSAGES = 200;
const MAX_COINFLIPS = 100;

/* =========================================================
SUPABASE
========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("ERROR: SUPABASE_URL is missing.");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "ERROR: SUPABASE_SERVICE_ROLE_KEY is missing."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      )
    : null;

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
    ],
    maxAge: 86400
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    console.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
    );
  });

  next();
});

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
PET VALUES
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
      .map((line) => line.trim())
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
        /^\[\d+\]$/.test(lines[valueIndex])
      ) {
        valueIndex++;
      }

      if (valueIndex >= lines.length) {
        continue;
      }

      const rawValue = lines[valueIndex];

      if (!/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
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

let petsCache = {
  mtime: 0,
  pets: []
};

function getPets() {
  try {
    const stat = fs.statSync(VALUES_FILE);

    if (stat.mtimeMs !== petsCache.mtime) {
      petsCache = {
        mtime: stat.mtimeMs,
        pets: loadPets()
      };
    }
  } catch {
    // Keep last good cache.
  }

  return petsCache.pets;
}

/* =========================================================
RATE LIMITER
========================================================= */

const rateBuckets = new Map();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key =
      req.ip ||
      req.socket.remoteAddress ||
      "unknown";

    const now = Date.now();

    let bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.reset) {
      bucket = {
        count: 0,
        reset: now + windowMs
      };

      rateBuckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message:
          "Too many requests. Please wait a minute and try again."
      });
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.reset) {
      rateBuckets.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

/* =========================================================
SUPABASE USER HELPERS
========================================================= */

function normalizeUser(row) {
  if (!row) return null;

  return {
    id: String(row.roblox_id),
    robloxId: String(row.roblox_id),
    username: row.username || "User",
    avatar: row.avatar || "",
    verified: Boolean(row.verified),
    balance: numeric(row.balance),
    wagered: numeric(row.wagered),
    profit: numeric(row.profit),
    coinflips: numeric(row.coinflips),
    wins: numeric(row.wins),
    inventory: Array.isArray(row.inventory)
      ? row.inventory
      : []
  };
}

async function getUser(id) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("roblox_id", String(id))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeUser(data);
}

async function createOrUpdateUser(data) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const id = String(
    data.id ??
      data.robloxId ??
      data.userId ??
      ""
  ).trim();

  if (!id) {
    return null;
  }

  const existing = await getUser(id);

  if (existing) {
    const updates = {};

    if (data.username) {
      updates.username = clean(data.username);
    }

    if (data.avatar) {
      updates.avatar = clean(data.avatar);
    }

    if (data.verified !== undefined) {
      updates.verified = Boolean(data.verified);
    }

    if (Object.keys(updates).length > 0) {
      const { data: updated, error } =
        await supabase
          .from("users")
          .update(updates)
          .eq("roblox_id", id)
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      return normalizeUser(updated);
    }

    return existing;
  }

  const newUser = {
    roblox_id: id,
    username:
      clean(data.username) || "User",
    avatar: clean(data.avatar),
    verified: Boolean(data.verified),
    balance: 0,
    wagered: 0,
    profit: 0,
    coinflips: 0,
    wins: 0,
    inventory: []
  };

  const { data: created, error } =
    await supabase
      .from("users")
      .insert(newUser)
      .select("*")
      .single();

  if (error) {
    throw error;
  }

  return normalizeUser(created);
}

/* =========================================================
ROBLOX
========================================================= */

const robloxCache = new Map();

async function withCache(
  key,
  ttlMs,
  fetcher,
  fresh = false
) {
  if (!fresh) {
    const hit = robloxCache.get(key);

    if (
      hit &&
      hit.expires > Date.now()
    ) {
      return hit.value;
    }
  }

  const value = await fetcher();

  robloxCache.set(key, {
    value,
    expires: Date.now() + ttlMs
  });

  return value;
}

async function robloxFetch(
  url,
  options = {}
) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    ROBLOX_TIMEOUT_MS
  );

  try {
    return await fetch(url, {
      ...options,
      headers: {
        "User-Agent": "ADMFLIP/1.0",
        Accept: "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function findRobloxUser(
  username,
  fresh = false
) {
  const cleanUsername = clean(username);

  if (!cleanUsername) {
    return null;
  }

  return withCache(
    "user:" +
      cleanUsername.toLowerCase(),
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        "https://users.roblox.com/v1/usernames/users",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            usernames: [cleanUsername],
            excludeBannedUsers: true
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
          (user) =>
            String(user.name)
              .toLowerCase() ===
            cleanUsername.toLowerCase()
        ) ||
        found[0] ||
        null
      );
    },
    fresh
  );
}

async function findRobloxProfile(
  id,
  fresh = false
) {
  return withCache(
    "profile:" + String(id),
    ROBLOX_CACHE_TTL,
    async () => {
      const response =
        await robloxFetch(
          "https://users.roblox.com/v1/users/" +
            encodeURIComponent(
              String(id)
            )
        );

      if (!response.ok) {
        throw new Error(
          `Roblox profile returned ${response.status}`
        );
      }

      return response.json();
    },
    fresh
  );
}

async function findRobloxAvatar(id) {
  try {
    return await withCache(
      "avatar:" + String(id),
      AVATAR_CACHE_TTL,
      async () => {
        const response =
          await robloxFetch(
            "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
              encodeURIComponent(
                String(id)
              ) +
              "&size=150x150&format=Png&isCircular=false"
          );

        if (!response.ok) {
          return "";
        }

        const data =
          await response.json();

        return (
          data?.data?.[0]?.imageUrl ||
          ""
        );
      }
    );
  } catch {
    return "";
  }
}

/* =========================================================
HEALTH
========================================================= */

app.get("/health", async (req, res) => {
  let database = "unknown";

  if (!supabase) {
    database = "not configured";
  } else {
    try {
      const { error } =
        await supabase
          .from("users")
          .select("roblox_id")
          .limit(1);

      database = error
        ? "error"
        : "connected";
    } catch {
      database = "error";
    }
  }

  res.json({
    success: true,
    server: "online",
    version: "3.0.0",
    database,
    pets: getPets().length,
    cors: FRONTEND_ORIGIN
  });
});

app.get("/debug-values", (req, res) => {
  const loaded = getPets();

  res.json({
    success: true,
    count: loaded.length,
    valuesFile: VALUES_FILE,
    firstPets: loaded.slice(0, 10)
  });
});

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
  res.json({
    success: true,
    pets: getPets()
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
      (item) =>
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
ROBLOX USER SEARCH
========================================================= */

async function userLookup(
  req,
  res
) {
  try {
    const username = clean(
      req.params.username
    );

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

    await createOrUpdateUser({
      id: robloxUser.id,
      username: robloxUser.name,
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
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  userLookup
);

app.get(
  "/api/user/:username",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
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
        Math.random() * 9000
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

app.get("/create", (req, res) => {
  res.json({
    success: true,
    phrase: generatePhrase()
  });
});

app.get(
  "/api/create",
  (req, res) => {
    res.json({
      success: true,
      phrase: generatePhrase()
    });
  }
);

async function verifyRobloxBio(
  req,
  res
) {
  try {
    const username = clean(
      req.body?.username
    );

    const phrase = clean(
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
        username,
        true
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
        robloxUser.id,
        true
      );

    const description = clean(
      profile?.description
    );

    console.log(
      `Verification check for ${robloxUser.name}: ` +
        `bio length ${description.length} | ` +
        JSON.stringify(
          description.slice(
            0,
            120
          )
        )
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
      await createOrUpdateUser({
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
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  verifyRobloxBio
);

app.post(
  "/api/check",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
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
    const id = clean(
      req.params.robloxId
    );

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Roblox ID."
      });
    }

    let user =
      await getUser(id);

    if (!user) {
      const profile =
        await findRobloxProfile(id);

      const avatar =
        await findRobloxAvatar(id);

      user =
        await createOrUpdateUser({
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
  rateLimit(60, 60000),
  accountHandler
);

app.get(
  "/api/account/:robloxId",
  rateLimit(60, 60000),
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

async function getChatMessages() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured."
    );
  }

  const { data, error } =
    await supabase
      .from("chat_messages")
      .select("*")
      .order(
        "created_at",
        {
          ascending: true
        }
      )
      .limit(MAX_CHAT_MESSAGES);

  if (error) {
    throw error;
  }

  return (data || []).map(
    (message) => ({
      id: message.id,
      username:
        message.username,
      robloxId:
        message.roblox_id,
      avatar:
        message.avatar ||
        "/logo.png",
      message:
        message.message,
      type:
        message.type ||
        "message",
      pinned:
        Boolean(message.pinned),
      createdAt:
        new Date(
          message.created_at
        ).getTime()
    })
  );
}

app.get(
  "/chat/messages",
  async (req, res) => {
    try {
      const messages =
        await getChatMessages();

      res.json({
        success: true,
        messages
      });
    } catch (error) {
      console.error(
        "GET /chat/messages:",
        error
      );

      res.status(500).json({
        success: false,
        messages: [],
        message:
          "Unable to load chat."
      });
    }
  }
);

app.get(
  "/api/chat/messages",
  async (req, res) => {
    try {
      const messages =
        await getChatMessages();

      res.json({
        success: true,
        messages
      });
    } catch (error) {
      console.error(
        "GET /api/chat/messages:",
        error
      );

      res.status(500).json({
        success: false,
        messages: []
      });
    }
  }
);

async function createChatMessage(
  req,
  res
) {
  try {
    const robloxId = clean(
      req.body?.robloxId ||
        req.body?.userId
    );

    const username = clean(
      req.body?.username
    );

    const avatar = clean(
      req.body?.avatar
    );

    const message = clean(
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

    const { data, error } =
      await supabase
        .from("chat_messages")
        .insert({
          username,
          roblox_id: robloxId,
          avatar:
            avatar || "/logo.png",
          message,
          type: "message",
          pinned: false
        })
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: {
        id: data.id,
        username:
          data.username,
        robloxId:
          data.roblox_id,
        avatar:
          data.avatar ||
          "/logo.png",
        message:
          data.message,
        type:
          data.type ||
          "message",
        pinned:
          Boolean(data.pinned),
        createdAt:
          new Date(
            data.created_at
          ).getTime()
      }
    });
  } catch (error) {
    console.error(
      "POST /chat/messages:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Could not send message."
    });
  }
}

app.post(
  "/chat/messages",
  createChatMessage
);

app.post(
  "/api/chat/messages",
  createChatMessage
);

async function getOnlineCount() {
  const cutoff =
    new Date(
      Date.now() -
        5 * 60 * 1000
    ).toISOString();

  const { data, error } =
    await supabase
      .from("chat_messages")
      .select("roblox_id, username")
      .gte(
        "created_at",
        cutoff
      );

  if (error) {
    throw error;
  }

  const online = new Set(
    (data || []).map(
      (message) =>
        message.roblox_id ||
        message.username
    )
  );

  return online.size;
}

app.get(
  "/chat/online",
  async (req, res) => {
    try {
      const online =
        await getOnlineCount();

      res.json({
        success: true,
        online,
        count: online,
        onlineCount: online
      });
    } catch (error) {
      console.error(
        "Chat online:",
        error
      );

      res.json({
        success: true,
        online: 0,
        count: 0,
        onlineCount: 0
      });
    }
  }
);

app.get(
  "/api/chat/online",
  async (req, res) => {
    try {
      const online =
        await getOnlineCount();

      res.json({
        success: true,
        online,
        count: online,
        onlineCount: online
      });
    } catch {
      res.json({
        success: true,
        online: 0,
        count: 0,
        onlineCount: 0
      });
    }
  }
);

/* =========================================================
COINFLIPS
========================================================= */

function normalizeCoinflip(row) {
  return {
    id: row.id,
    username:
      row.username || "User",
    userId:
      String(row.roblox_id),
    robloxId:
      String(row.roblox_id),
    avatar:
      row.avatar ||
      "/logo.png",
    petName:
      row.pet_name,
    petValue:
      numeric(row.pet_value),
    value:
      numeric(row.pet_value),
    image:
      row.image ||
      petImage(row.pet_name),
    side:
      row.side,
    status:
      row.status,
    createdAt:
      new Date(
        row.created_at
      ).getTime()
  };
}

app.get(
  "/coinflips",
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("coinflips")
          .select("*")
          .eq(
            "status",
            "active"
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(MAX_COINFLIPS);

      if (error) {
        throw error;
      }

      const coinflips =
        (data || []).map(
          normalizeCoinflip
        );

      const totalValue =
        coinflips.reduce(
          (sum, flip) =>
            sum +
            numeric(
              flip.petValue
            ),
          0
        );

      res.json({
        success: true,
        coinflips,
        total:
          coinflips.length,
        totalValue
      });
    } catch (error) {
      console.error(
        "GET /coinflips:",
        error
      );

      res.status(500).json({
        success: false,
        coinflips: [],
        message:
          "Unable to load coinflips."
      });
    }
  }
);

app.get(
  "/api/coinflips",
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("coinflips")
          .select("*")
          .eq(
            "status",
            "active"
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(MAX_COINFLIPS);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        coinflips:
          (data || []).map(
            normalizeCoinflip
          )
      });
    } catch (error) {
      console.error(
        "GET /api/coinflips:",
        error
      );

      res.status(500).json({
        success: false,
        coinflips: []
      });
    }
  }
);

async function createCoinflip(
  req,
  res
) {
  try {
    const username = clean(
      req.body?.username
    );

    const userId = clean(
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

    const side = clean(
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

    const name = clean(
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
        (pet) =>
          pet.name.toLowerCase() ===
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
      await createOrUpdateUser({
        id: userId,
        username,
        avatar: clean(
          req.body?.avatar
        ),
        verified: true
      });

    const newWagered =
      numeric(user.wagered) +
      serverPet.value;

    const newCoinflips =
      numeric(user.coinflips) +
      1;

    await supabase
      .from("users")
      .update({
        wagered:
          newWagered,
        coinflips:
          newCoinflips
      })
      .eq(
        "roblox_id",
        userId
      );

    const { data, error } =
      await supabase
        .from("coinflips")
        .insert({
          username:
            user.username,
          roblox_id:
            user.id,
          avatar:
            user.avatar ||
            "/logo.png",
          pet_name:
            serverPet.name,
          pet_value:
            serverPet.value,
          image:
            serverPet.image,
          side,
          status:
            "active"
        })
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      success: true,
      coinflip:
        normalizeCoinflip(data)
    });
  } catch (error) {
    console.error(
      "POST /coinflips:",
      error
    );

    res.status(500).json({
      success: false,
      message:
        "Could not create coinflip."
    });
  }
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

async function leaderboardHandler(
  req,
  res
) {
  try {
    const { data, error } =
      await supabase
        .from("users")
        .select(
          "username, avatar, wagered, profit"
        )
        .order(
          "wagered",
          {
            ascending: false
          }
        )
        .limit(10);

    if (error) {
      throw error;
    }

    const leaderboard =
      (data || []).map(
        (user, index) => ({
          place: index + 1,
          username:
            user.username,
          avatar:
            user.avatar ||
            "/logo.png",
          wagered:
            numeric(
              user.wagered
            ),
          profit:
            numeric(
              user.profit
            )
        })
      );

    res.json({
      success: true,
      users:
        leaderboard
    });
  } catch (error) {
    console.error(
      "Leaderboard:",
      error
    );

    res.status(500).json({
      success: false,
      users: []
    });
  }
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

async function statusHandler(
  req,
  res
) {
  try {
    const { data, error } =
      await supabase
        .from("coinflips")
        .select("pet_value")
        .eq(
          "status",
          "active"
        );

    if (error) {
      throw error;
    }

    const active =
      data || [];

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
              flip.pet_value
            ),
          0
        )
    });
  } catch (error) {
    console.error(
      "Status:",
      error
    );

    res.status(500).json({
      success: false,
      online: false,
      announcement: "",
      activeCoinflips: 0,
      totalCoinflipValue: 0
    });
  }
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
API INDEX
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "ADMFLIP API",
    version: "3.0.0",
    cors: FRONTEND_ORIGIN,
    endpoints: [
      "GET  /health",
      "GET  /pets",
      "GET  /pets/:name",
      "GET  /user/:username",
      "GET  /create",
      "POST /check",
      "GET  /account/:robloxId",
      "GET  /coinflips",
      "POST /coinflips",
      "GET  /chat/messages",
      "POST /chat/messages",
      "GET  /chat/online",
      "GET  /leaderboard",
      "GET  /status"
    ]
  });
});

/* =========================================================
OPTIONAL STATIC FRONTEND
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(
      PUBLIC_DIR,
      {
        index: false,
        maxAge: "1h"
      }
    )
  );
}

app.get("/", (req, res) => {
  const index = path.join(
    PUBLIC_DIR,
    "index.html"
  );

  if (fs.existsSync(index)) {
    return res.sendFile(index);
  }

  res.json({
    success: true,
    server: "online",
    message:
      "ADMFLIP API — frontend is hosted separately."
  });
});

/* =========================================================
404
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error:
      "API route not found.",
    path: req.path
  });
});

/* =========================================================
ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
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
      "ADMFLIP backend v3.0 started"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Supabase URL:",
      SUPABASE_URL
        ? "configured"
        : "MISSING"
    );

    console.log(
      "Supabase secret:",
      SUPABASE_SERVICE_ROLE_KEY
        ? "configured"
        : "MISSING"
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
      "CORS origins:",
      FRONTEND_ORIGIN.join(", ")
    );

    console.log(
      "Public dir:",
      PUBLIC_DIR,
      fs.existsSync(PUBLIC_DIR)
        ? "(served)"
        : "(not present)"
    );

    console.log(
      "========================================"
    );
  }
);
