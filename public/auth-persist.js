// auth-persist.js
// Standalone login persistence for ADMFLIP.
// Rewritten to use a single robust fetch wrapper that supports Request/Headers.

(() => {
  "use strict";

  const TOKEN_KEY = "admflip_token";
  const USER_KEY = "admflip_user";

  // Save / load
  function save(token, user) {
    if (!token) return;
    try {
      localStorage.setItem(TOKEN_KEY, token);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
      // localStorage might be unavailable in some environments
    }

    window.authToken = token;

    if (user) {
      window.currentUser = user;
      window.currentUserId = user.robloxId || user.id;
    }
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch {}
  }

  // Restore immediately into global helpers
  const existingToken = getToken();
  const existingUser = getUser();

  if (existingToken) {
    window.authToken = existingToken;
  }

  if (existingUser) {
    window.currentUser = existingUser;
    window.currentUserId = existingUser.robloxId || existingUser.id;
  }

  // Keep a reference to native fetch
  const nativeFetch = window.fetch.bind(window);

  // Single robust fetch wrapper:
  // - Injects Authorization for string URL + init, or for Request instances.
  // - Inspects JSON responses and saves tokens/users when returned.
  window.fetch = async function (input, init = {}) {
    let url = "";
    try {
      // Determine URL for later checks (input can be string or Request)
      if (typeof input === "string") {
        url = input;
      } else if (input && input.url) {
        url = input.url;
      }

      // Ensure we can add Authorization in all cases
      const token = getToken();

      if (input instanceof Request) {
        // Clone Request and inject header into its Headers
        const clonedHeaders = new Headers(input.headers || {});
        if (token) clonedHeaders.set("Authorization", `Bearer ${token}`);
        input = new Request(input, { headers: clonedHeaders });
      } else {
        // input is URL string; ensure init.headers is a Headers instance
        init = init || {};
        const headers = new Headers(init.headers || {});
        if (token) headers.set("Authorization", `Bearer ${token}`);
        // leave other init props untouched
        init = { ...init, headers };
      }

      const response = await nativeFetch(input, init);

      // If JSON, inspect body for tokens/user (do it async so we don't block)
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        response
          .clone()
          .json()
          .then((data) => {
            if (!data || typeof data !== "object") return;

            // Login / verification response -> save token + user
            if (data.success && data.token) {
              save(
                data.token,
                data.user ||
                  {
                    id: data.userId || data.id,
                    robloxId: data.userId || data.id,
                    username: data.username,
                    avatar: data.avatar
                  }
              );
              console.log("[AUTH-PERSIST] Login token saved.");
            }

            // Account response (server sends user object) -> combine with stored token
            if (
              data.success &&
              data.user &&
              (url.includes("/account") || url.includes("/api/account"))
            ) {
              const t = getToken();
              if (t) {
                save(t, data.user);
              }
            }
          })
          .catch(() => {});
      }

      return response;
    } catch (err) {
      // Fallback: if wrapper fails for any reason, call native fetch directly
      try {
        return await nativeFetch(input, init);
      } catch (e) {
        throw e;
      }
    }
  };

  // XHR interception for older code paths (preserve simple behaviour)
  const OriginalXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OriginalXHR();
    let requestUrl = "";

    const originalOpen = xhr.open;
    xhr.open = function (method, url, ...rest) {
      requestUrl = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };

    xhr.addEventListener("load", function () {
      try {
        const contentType = this.getResponseHeader("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) return;
        const data = JSON.parse(this.responseText);
        if (data && data.success && data.token) {
          save(
            data.token,
            data.user ||
              {
                id: data.userId || data.id,
                robloxId: data.userId || data.id,
                username: data.username,
                avatar: data.avatar
              }
          );
          console.log("[AUTH-PERSIST] XHR login token saved.");
        }

        if (
          data &&
          data.success &&
          data.user &&
          (requestUrl.includes("/account") || requestUrl.includes("/api/account"))
        ) {
          const t = getToken();
          if (t) save(t, data.user);
        }
      } catch {
        // ignore non-json etc
      }
    });

    return xhr;
  }
  window.XMLHttpRequest = PatchedXHR;

  // Persist token/user on beforeunload as a last-resort write
  window.addEventListener("beforeunload", () => {
    const token = getToken();
    if (token) {
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {}
    }

    const user = window.currentUser;
    if (user) {
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } catch {}
    }
  });

  // Public helper API (same surface as before)
  window.ADMFLIP_AUTH = {
    getToken,
    getUser,
    save,
    logout() {
      clear();
      window.authToken = null;
      window.currentUser = null;
      window.currentUserId = null;
      location.reload();
    }
  };

  console.log(existingToken ? "[AUTH-PERSIST] Saved session found." : "[AUTH-PERSIST] No saved session.");
})();
