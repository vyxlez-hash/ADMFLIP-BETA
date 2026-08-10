// auth-persist.js
// Keeps the ADMFLIP login session after page refresh.
// Does NOT modify server.js or app.js.

(() => {
  "use strict";

  const TOKEN_KEY = "admflip_token";
  const USER_KEY = "admflip_user";

  // ---------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function getSavedUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(token, user) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }

    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  // ---------------------------------------------------------
  // Make token available globally
  // ---------------------------------------------------------

  window.ADMFLIP_AUTH = {
    getToken,
    getUser: getSavedUser,
    saveSession,
    clearSession,

    getHeaders() {
      const token = getToken();

      return token
        ? {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        : {
            "Content-Type": "application/json"
          };
    }
  };

  // ---------------------------------------------------------
  // Restore saved session
  // ---------------------------------------------------------

  async function restoreSession() {
    const token = getToken();

    if (!token) {
      window.dispatchEvent(
        new CustomEvent("admflip:auth", {
          detail: {
            loggedIn: false,
            user: null
          }
        })
      );
      return;
    }

    try {
      const response = await fetch("/account", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        credentials: "include",
        cache: "no-store"
      });

      if (!response.ok) {
        // Only remove the session if the server explicitly
        // says that the token is invalid/expired.
        if (response.status === 401) {
          clearSession();
        }

        window.dispatchEvent(
          new CustomEvent("admflip:auth", {
            detail: {
              loggedIn: false,
              user: null
            }
          })
        );

        return;
      }

      const data = await response.json();

      if (!data.success || !data.user) {
        window.dispatchEvent(
          new CustomEvent("admflip:auth", {
            detail: {
              loggedIn: false,
              user: null
            }
          })
        );
        return;
      }

      // Refresh saved user information.
      saveSession(token, data.user);

      // Tell the existing frontend that the user is logged in.
      window.dispatchEvent(
        new CustomEvent("admflip:auth", {
          detail: {
            loggedIn: true,
            user: data.user,
            token
          }
        })
      );

      // Also expose it globally for existing frontend code.
      window.currentUser = data.user;
      window.currentUserId = data.user.robloxId || data.user.id;
      window.authToken = token;

      console.log(
        "[ADMFLIP AUTH] Session restored:",
        data.user.username
      );
    } catch (error) {
      console.error("[ADMFLIP AUTH] Restore failed:", error);

      // IMPORTANT:
      // Do NOT delete the token just because the network failed.
      // This prevents a temporary backend/network problem from
      // logging the user out.

      const savedUser = getSavedUser();

      if (savedUser) {
        window.currentUser = savedUser;
        window.currentUserId =
          savedUser.robloxId || savedUser.id;
        window.authToken = token;

        window.dispatchEvent(
          new CustomEvent("admflip:auth", {
            detail: {
              loggedIn: true,
              user: savedUser,
              token,
              offline: true
            }
          })
        );
      }
    }
  }

  // ---------------------------------------------------------
  // Automatically save successful login responses
  // ---------------------------------------------------------

  window.addEventListener("admflip:login", (event) => {
    const detail = event.detail || {};

    if (detail.token && detail.user) {
      saveSession(detail.token, detail.user);

      window.authToken = detail.token;
      window.currentUser = detail.user;
      window.currentUserId =
        detail.user.robloxId || detail.user.id;

      console.log(
        "[ADMFLIP AUTH] Login saved:",
        detail.user.username
      );
    }
  });

  // ---------------------------------------------------------
  // Helper for your existing login code
  // ---------------------------------------------------------

  window.ADMFLIP_AUTH.login = function (data) {
    if (!data || !data.token) {
      console.warn("[ADMFLIP AUTH] No token received.");
      return false;
    }

    saveSession(data.token, data.user || null);

    window.authToken = data.token;

    if (data.user) {
      window.currentUser = data.user;
      window.currentUserId =
        data.user.robloxId || data.user.id;
    }

    window.dispatchEvent(
      new CustomEvent("admflip:auth", {
        detail: {
          loggedIn: true,
          user: data.user || null,
          token: data.token
        }
      })
    );

    return true;
  };

  // ---------------------------------------------------------
  // Proper logout
  // ---------------------------------------------------------

  window.ADMFLIP_AUTH.logout = function () {
    clearSession();

    window.authToken = null;
    window.currentUser = null;
    window.currentUserId = null;

    window.dispatchEvent(
      new CustomEvent("admflip:auth", {
        detail: {
          loggedIn: false,
          user: null
        }
      })
    );

    console.log("[ADMFLIP AUTH] Logged out.");
  };

  // ---------------------------------------------------------
  // Start restoration
  // ---------------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreSession);
  } else {
    restoreSession();
  }
})();
