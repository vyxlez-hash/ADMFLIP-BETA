// auth-persist.js
// Standalone login persistence for ADMFLIP.
// DO NOT modify server.js or app.js.

(() => {
  "use strict";

  const TOKEN_KEY = "admflip_token";
  const USER_KEY = "admflip_user";

  // ---------------------------------------------------------
  // Save / load
  // ---------------------------------------------------------

  function save(token, user) {
    if (!token) return;

    localStorage.setItem(TOKEN_KEY, token);

    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    window.authToken = token;

    if (user) {
      window.currentUser = user;
      window.currentUserId = user.robloxId || user.id;
    }
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  // ---------------------------------------------------------
  // Restore immediately
  // ---------------------------------------------------------

  const existingToken = getToken();
  const existingUser = getUser();

  if (existingToken) {
    window.authToken = existingToken;
  }

  if (existingUser) {
    window.currentUser = existingUser;
    window.currentUserId =
      existingUser.robloxId || existingUser.id;
  }

  // ---------------------------------------------------------
  // Intercept FETCH
  //
  // Whenever app.js logs in and receives:
  // { success: true, token: "...", user: {...} }
  //
  // this automatically saves it.
  // ---------------------------------------------------------

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const request = args[0];

      let url = "";

      if (typeof request === "string") {
        url = request;
      } else if (request && request.url) {
        url = request.url;
      }

      const cloned = response.clone();

      const contentType =
        cloned.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        cloned.json().then((data) => {
          if (!data || typeof data !== "object") return;

          // Login / verification response
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

            console.log(
              "[AUTH-PERSIST] Login token saved."
            );
          }

          // Account response
          if (
            data.success &&
            data.user &&
            (url.includes("/account") ||
              url.includes("/api/account"))
          ) {
            const token = getToken();

            if (token) {
              save(token, data.user);
            }
          }
        }).catch(() => {});
      }
    } catch (error) {
      console.warn(
        "[AUTH-PERSIST] Fetch interception error:",
        error
      );
    }

    return response;
  };

  // ---------------------------------------------------------
  // Intercept XMLHttpRequest too
  // Some older app code uses XHR instead of fetch.
  // ---------------------------------------------------------

  const OriginalXHR = window.XMLHttpRequest;

  function PatchedXHR() {
    const xhr = new OriginalXHR();

    let requestUrl = "";

    const originalOpen = xhr.open;

    xhr.open = function (method, url, ...rest) {
      requestUrl = String(url || "");
      return originalOpen.call(
        this,
        method,
        url,
        ...rest
      );
    };

    xhr.addEventListener("load", function () {
      try {
        const contentType =
          this.getResponseHeader("content-type") || "";

        if (!contentType.includes("application/json")) {
          return;
        }

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

          console.log(
            "[AUTH-PERSIST] XHR login token saved."
          );
        }

        if (
          data &&
          data.success &&
          data.user &&
          (requestUrl.includes("/account") ||
            requestUrl.includes("/api/account"))
        ) {
          const token = getToken();

          if (token) {
            save(token, data.user);
          }
        }
      } catch {
        // Ignore non-JSON responses.
      }
    });

    return xhr;
  }

  window.XMLHttpRequest = PatchedXHR;

  // ---------------------------------------------------------
  // Automatically add Authorization to fetch requests
  // ---------------------------------------------------------

  window.fetch = ((original) => {
    return async function (input, init = {}) {
      const token = getToken();

      if (token) {
        init = {
          ...init,
          headers: {
            ...(init.headers || {}),
            Authorization: `Bearer ${token}`
          }
        };
      }

      return original.call(this, input, init);
    };
  })(window.fetch);

  // ---------------------------------------------------------
  // Prevent accidental logout caused by page refresh
  // ---------------------------------------------------------

  window.addEventListener("beforeunload", () => {
    const token = getToken();

    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }

    const user = window.currentUser;

    if (user) {
      localStorage.setItem(
        USER_KEY,
        JSON.stringify(user)
      );
    }
  });

  // ---------------------------------------------------------
  // Public helper
  // ---------------------------------------------------------

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

  console.log(
    existingToken
      ? "[AUTH-PERSIST] Saved session found."
      : "[AUTH-PERSIST] No saved session."
  );
})();
