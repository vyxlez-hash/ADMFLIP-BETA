"use strict";

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("========================================");
  console.error("SUPABASE CONFIGURATION ERROR");
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  console.error("========================================");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/* =========================================================
   EXPRESS
========================================================= */

app.set("trust proxy", 1);

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

function makeId(prefix = "") {
  return (
    prefix +
    crypto.randomBytes(18).toString("hex")
  );
}

function petImage(name) {
  return (
    "https://amvgg.com/items/" +
    encodeURIComponent(String(name)) +
    ".webp"
  );
}

function randomPhrase() {
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
    words[Math.floor(Math.random() * words.length)];

  const second =
    words[Math.floor(Math.random() * words.length)];

  const number =
    Math.floor(1000 + Math.random() * 9000);

  return `ADMFLIP-${first}-${second}-${number}`;
}

/* =========================================================
   PET VALUES
========================================================= */

function loadPets() {
  if (!fs.existsSync(VALUES_FILE)) {
    console.error("values.txt not found:", VALUES_FILE);
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
  } catch (error) {
    console.error("Values stat error:", error);
  }

  return petsCache.pets;
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
        "User-Agent": "ADMFLIP/3.0",
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
    "user:" + cleanUsername.toLowerCase(),
    ROBLOX_CACHE_TTL,
    async () => {
      const response = await robloxFetch(
        "https://users.roblox.com/v1/usernames/users",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
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

      const data = await response.json();

      const found = Array.isArray(data?.data)
        ? data.data
        : [];

      return (
        found.find(
          (user) =>
            String(user.name).toLowerCase() ===
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
      const response = await robloxFetch(
        "https://users.roblox.com/v1/users/" +
          encodeURIComponent(String(id))
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
        const response = await robloxFetch(
          "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" +
            encodeURIComponent(String(id)) +
            "&size=150x150&format=Png&isCircular=false"
        );

        if (!response.ok) {
          return "";
        }

        const data = await response.json();

        return (
          data?.data?.[0]?.imageUrl || ""
        );
      }
    );
  } catch {
    return "";
  }
}

/* =========================================================
   RATE LIMIT
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

    if (
      !bucket ||
      now > bucket.reset
    ) {
      bucket = {
        count: 0,
        reset: now + windowMs
      };

      rateBuckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message:
          "Too many requests. Please wait."
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
   SESSION AUTH
========================================================= */

function sessionCookieOptions(maxAge) {
  return [
    `admflip_session=`,
    `Max-Age=${Math.floor(maxAge / 1000)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None"
  ].join("; ");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = part
      .slice(0, index)
      .trim();

    const value = part
      .slice(index + 1)
      .trim();

    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

async function createSession(userId) {
  const sessionId = makeId("sess_");

  const expiresAt = new Date(
    Date.now() +
      30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error } = await supabase
    .from("sessions")
    .insert({
      id: sessionId,
      user_id: userId,
      expires_at: expiresAt
    });

  if (error) {
    throw error;
  }

  return {
    sessionId,
    expiresAt
  };
}

async function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const sessionId =
    cookies.admflip_session;

  if (!sessionId) {
    return null;
  }

  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id,user_id,expires_at,users(*)"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (
    new Date(data.expires_at).getTime() <=
    Date.now()
  ) {
    await supabase
      .from("sessions")
      .delete()
      .eq("id", sessionId);

    return null;
  }

  if (!data.users) {
    return null;
  }

  return data.users;
}

async function requireAuth(req, res, next) {
  try {
    const user =
      await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "You must verify your Roblox account first."
      });
    }

    if (user.banned) {
      return res.status(403).json({
        success: false,
        message:
          user.ban_reason ||
          "Your account is banned."
      });
    }

    req.user = user;

    next();
  } catch (error) {
    console.error(
      "Authentication error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Authentication error."
    });
  }
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", async (req, res) => {
  let database = false;

  try {
    const { error } = await supabase
      .from("users")
      .select("id")
      .limit(1);

    database = !error;
  } catch {
    database = false;
  }

  res.json({
    success: true,
    server: "online",
    version: "3.0.0",
    database: database
      ? "supabase"
      : "unavailable",
    pets: getPets().length
  });
});

/* =========================================================
   PETS
========================================================= */

app.get("/pets", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    pets: getPets()
  });
});

app.get("/api/pets", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    pets: getPets()
  });
});

app.get("/pets/:name", (req, res) => {
  const requested = decodeURIComponent(
    req.params.name
  )
    .trim()
    .toLowerCase();

  const pet = getPets().find(
    (item) =>
      item.name.trim().toLowerCase() ===
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
});

/* =========================================================
   ROBLOX LOOKUP
========================================================= */

app.get(
  "/user/:username",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  async (req, res) => {
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
        await findRobloxUser(username);

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

      res.json({
        success: true,
        user: {
          id: String(robloxUser.id),
          username: robloxUser.name,
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
          "The server could not reach Roblox."
      });
    }
  }
);

/* =========================================================
   VERIFICATION
========================================================= */

app.get("/create", (req, res) => {
  res.json({
    success: true,
    phrase: randomPhrase()
  });
});

app.get("/api/create", (req, res) => {
  res.json({
    success: true,
    phrase: randomPhrase()
  });
});

app.post(
  "/check",
  rateLimit(
    ROBLOX_RATE_MAX,
    ROBLOX_RATE_WINDOW
  ),
  async (req, res) => {
    try {
      const username =
        clean(req.body?.username);

      const phrase =
        clean(req.body?.phrase);

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

      const description =
        clean(profile?.description);

      console.log(
        `Verification ${robloxUser.name}: ` +
        JSON.stringify(
          description.slice(0, 200)
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
            "Verification phrase was not found in your Roblox About/Bio."
        });
      }

      const avatar =
        await findRobloxAvatar(
          robloxUser.id
        );

      const userId =
        String(robloxUser.id);

      const { data: existing } =
        await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

      let user;

      if (existing) {
        const { data, error } =
          await supabase
            .from("users")
            .update({
              username:
                profile.name ||
                robloxUser.name,
              avatar,
              verified: true,
              updated_at:
                new Date().toISOString()
            })
            .eq("id", userId)
            .select("*")
            .single();

        if (error) {
          throw error;
        }

        user = data;
      } else {
        const { data, error } =
          await supabase
            .from("users")
            .insert({
              id: userId,
              roblox_id: userId,
              username:
                profile.name ||
                robloxUser.name,
              avatar,
              verified: true
            })
            .select("*")
            .single();

        if (error) {
          throw error;
        }

        user = data;
      }

      const session =
        await createSession(user.id);

      res.setHeader(
        "Set-Cookie",
        sessionCookieOptions(
          30 *
            24 *
            60 *
            60 *
            1000
        ) +
          encodeURIComponent(
            session.sessionId
          )
      );

      res.json({
        success: true,
        user: {
          id: user.id,
          robloxId: user.roblox_id,
          username: user.username,
          avatar: user.avatar,
          verified: true
        }
      });
    } catch (error) {
      console.error(
        "Verification error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Verification failed."
      });
    }
  }
);

/* =========================================================
   ACCOUNT
========================================================= */

app.get(
  "/account",
  requireAuth,
  async (req, res) => {
    try {
      const user = req.user;

      const { data: inventory, error } =
        await supabase
          .from("inventory")
          .select("*")
          .eq("user_id", user.id)
          .eq("status", "available")
          .order("created_at", {
            ascending: false
          });

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          robloxId: user.roblox_id,
          username: user.username,
          avatar: user.avatar,
          verified: user.verified,
          balance: numeric(
            user.balance
          ),
          wagered: numeric(
            user.wagered
          ),
          profit: numeric(
            user.profit
          ),
          coinflips:
            Number(user.coinflips) || 0,
          wins:
            Number(user.wins) || 0,
          inventory: (
            inventory || []
          ).map((item) => ({
            id: item.id,
            itemId: item.id,
            name: item.pet_name,
            petName: item.pet_name,
            value: numeric(
              item.pet_value
            ),
            image: item.pet_image,
            status: item.status
          }))
        }
      });
    } catch (error) {
      console.error(
        "Account error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Account could not be loaded."
      });
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/logout",
  async (req, res) => {
    try {
      const cookies =
        parseCookies(req);

      const sessionId =
        cookies.admflip_session;

      if (sessionId) {
        await supabase
          .from("sessions")
          .delete()
          .eq("id", sessionId);
      }
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    }

    res.setHeader(
      "Set-Cookie",
      "admflip_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None"
    );

    res.json({
      success: true
    });
  }
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
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("chat_messages")
          .select("*")
          .order("created_at", {
            ascending: true
          })
          .limit(100);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        messages: data || []
      });
    } catch (error) {
      console.error(
        "Chat load:",
        error
      );

      res.status(500).json({
        success: false,
        messages: []
      });
    }
  }
);

app.post(
  "/chat/messages",
  requireAuth,
  async (req, res) => {
    try {
      const message =
        clean(req.body?.message);

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
            "Links are not allowed."
        });
      }

      const chatMessage = {
        id: makeId("msg_"),
        user_id: req.user.id,
        username: req.user.username,
        avatar:
          req.user.avatar || "/logo.png",
        message,
        type: "message",
        pinned: false
      };

      const { data, error } =
        await supabase
          .from("chat_messages")
          .insert(chatMessage)
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      res.status(201).json({
        success: true,
        message: data
      });
    } catch (error) {
      console.error(
        "Chat send:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not send message."
      });
    }
  }
);

/* =========================================================
   CHAT ONLINE
========================================================= */

app.get(
  "/chat/online",
  async (req, res) => {
    try {
      const cutoff =
        new Date(
          Date.now() -
            5 * 60 * 1000
        ).toISOString();

      const { data, error } =
        await supabase
          .from("chat_messages")
          .select("user_id")
          .gte(
            "created_at",
            cutoff
          );

      if (error) {
        throw error;
      }

      const ids = new Set(
        (data || [])
          .map(
            (item) =>
              item.user_id
          )
          .filter(Boolean)
      );

      res.json({
        success: true,
        online: ids.size,
        count: ids.size,
        onlineCount: ids.size
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

app.get(
  "/coinflips",
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("coinflips")
          .select("*")
          .eq("status", "active")
          .order("created_at", {
            ascending: false
          })
          .limit(MAX_COINFLIPS);

      if (error) {
        throw error;
      }

      const flips = data || [];

      res.json({
        success: true,
        coinflips: flips.map(
          (flip) => ({
            id: flip.id,
            username:
              flip.creator_username,
            userId:
              flip.creator_id,
            robloxId:
              flip.creator_id,
            avatar:
              flip.creator_avatar,
            petName:
              flip.pet_name,
            petValue:
              numeric(
                flip.pet_value
              ),
            value:
              numeric(
                flip.pet_value
              ),
            image:
              flip.pet_image,
            side:
              flip.creator_side,
            status:
              flip.status,
            createdAt:
              flip.created_at
          })
        ),
        total: flips.length,
        totalValue:
          flips.reduce(
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
        "Coinflip load:",
        error
      );

      res.status(500).json({
        success: false,
        coinflips: []
      });
    }
  }
);

/* =========================================================
   CREATE COINFLIP
========================================================= */

app.post(
  "/coinflips",
  requireAuth,
  async (req, res) => {
    try {
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
            "Choose Heads or Tails."
        });
      }

      const itemId =
        clean(
          req.body?.itemId ||
          req.body?.inventoryItemId ||
          req.body?.pet?.id
        );

      if (!itemId) {
        return res.status(400).json({
          success: false,
          message:
            "Inventory item required."
        });
      }

      const { data: item, error } =
        await supabase
          .from("inventory")
          .select("*")
          .eq("id", itemId)
          .eq("user_id", req.user.id)
          .eq("status", "available")
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!item) {
        return res.status(400).json({
          success: false,
          message:
            "That pet is not available in your inventory."
        });
      }

      const { data: locked, error: lockError } =
        await supabase
          .from("inventory")
          .update({
            status: "in_coinflip"
          })
          .eq("id", item.id)
          .eq("user_id", req.user.id)
          .eq("status", "available")
          .select("*")
          .maybeSingle();

      if (lockError) {
        throw lockError;
      }

      if (!locked) {
        return res.status(409).json({
          success: false,
          message:
            "That pet is already being used."
        });
      }

      const flip = {
        id: makeId("cf_"),
        creator_id:
          req.user.id,
        creator_username:
          req.user.username,
        creator_avatar:
          req.user.avatar || "",
        inventory_item_id:
          item.id,
        pet_name:
          item.pet_name,
        pet_value:
          numeric(
            item.pet_value
          ),
        pet_image:
          item.pet_image,
        creator_side:
          side,
        status: "active"
      };

      const { data, error } =
        await supabase
          .from("coinflips")
          .insert(flip)
          .select("*")
          .single();

      if (error) {
        await supabase
          .from("inventory")
          .update({
            status: "available"
          })
          .eq("id", item.id);

        throw error;
      }

      await supabase
        .from("users")
        .update({
          wagered:
            numeric(
              req.user.wagered
            ) +
            numeric(
              item.pet_value
            ),
          coinflips:
            (Number(
              req.user.coinflips
            ) || 0) + 1,
          updated_at:
            new Date().toISOString()
        })
        .eq(
          "id",
          req.user.id
        );

      res.status(201).json({
        success: true,
        coinflip: {
          id: data.id,
          username:
            data.creator_username,
          userId:
            data.creator_id,
          avatar:
            data.creator_avatar,
          petName:
            data.pet_name,
          petValue:
            numeric(
              data.pet_value
            ),
          value:
            numeric(
              data.pet_value
            ),
          image:
            data.pet_image,
          side:
            data.creator_side,
          status:
            data.status
        }
      });
    } catch (error) {
      console.error(
        "Create coinflip:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not create coinflip."
      });
    }
  }
);

/* =========================================================
   LEADERBOARD
========================================================= */

app.get(
  "/leaderboard",
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("users")
          .select(
            "username,avatar,wagered,profit"
          )
          .eq("banned", false)
          .order("wagered", {
            ascending: false
          })
          .limit(10);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        users: (
          data || []
        ).map(
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
        )
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
);

/* =========================================================
   STATUS
========================================================= */

app.get(
  "/status",
  async (req, res) => {
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
            (sum, item) =>
              sum +
              numeric(
                item.pet_value
              ),
            0
          )
      });
    } catch {
      res.json({
        success: true,
        online: true,
        announcement: "",
        activeCoinflips: 0,
        totalCoinflipValue: 0
      });
    }
  }
);

/* =========================================================
   API
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "ADMFLIP API",
    version: "3.0.0",
    database: "supabase",
    endpoints: [
      "GET /health",
      "GET /pets",
      "GET /pets/:name",
      "GET /user/:username",
      "GET /create",
      "POST /check",
      "GET /account",
      "POST /logout",
      "GET /chat/messages",
      "POST /chat/messages",
      "GET /chat/online",
      "GET /coinflips",
      "POST /coinflips",
      "GET /leaderboard",
      "GET /status"
    ]
  });
});

/* =========================================================
   STATIC FRONTEND
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: "1h"
    })
  );
}

app.get("/", (req, res) => {
  const index =
    path.join(
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
      "ADMFLIP API — frontend hosted separately."
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
   ERROR
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
      "Database: Supabase"
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
      FRONTEND_ORIGIN.join(", ")
    );

    console.log(
      "========================================"
    );
  }
);
