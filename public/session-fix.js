(() => {
  "use strict";

  const TOKEN_KEY = "admflip_token";
  const BACKUP_KEY = "admflip_session_backup";

  function safeGetLocalToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function safeGetBackupToken() {
    try {
      return sessionStorage.getItem(BACKUP_KEY);
    } catch {
      return null;
    }
  }

  function safeSaveBackup(token) {
    if (!token) return;
    try {
      sessionStorage.setItem(BACKUP_KEY, token);
    } catch {}
  }

  function restoreToken() {
    const current = safeGetLocalToken();

    if (current) {
      safeSaveBackup(current);
      return current;
    }

    const backup = safeGetBackupToken();

    if (backup) {
      try {
        localStorage.setItem(TOKEN_KEY, backup);
        console.log("[SESSION FIX] Restored ADMFLIP login session.");
        return backup;
      } catch {}
    }

    return null;
  }

  // Restore immediately before app.js runs (this file should be included before app.js)
  restoreToken();

  // Keep the backup synchronized whenever app.js stores a new login token
  try {
    const originalSetItem = localStorage.setItem.bind(localStorage);

    localStorage.setItem = function (key, value) {
      if (key === TOKEN_KEY && value) {
        safeSaveBackup(String(value));
      }

      return originalSetItem(key, value);
    };
  } catch {}

  // Track whether the user intentionally clicked logout
  let realLogout = false;

  function markRealLogout() {
    realLogout = true;

    // Give app.js time to run its logout logic and then clear the backup
    setTimeout(() => {
      realLogout = false;
      try {
        sessionStorage.removeItem(BACKUP_KEY);
      } catch {}
    }, 2500);
  }

  // Detect clicks on the logout button (or elements inside it)
  document.addEventListener(
    "click",
    (event) => {
      try {
        const target = event.target;
        if (!target) return;

        if (
          target.id === "logoutBtn" ||
          (typeof target.closest === "function" && target.closest("#logoutBtn"))
        ) {
          markRealLogout();
        }
      } catch {}
    },
    true
  );

  // Prevent accidental removal of the token from localStorage
  try {
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);

    localStorage.removeItem = function (key) {
      if (key === TOKEN_KEY) {
        if (realLogout) {
          try {
            sessionStorage.removeItem(BACKUP_KEY);
          } catch {}

          return originalRemoveItem(key);
        }

        const backup = safeGetBackupToken();

        if (backup) {
          console.warn("[SESSION FIX] Prevented accidental ADMFLIP token removal.");

          try {
            // restore token silently
            localStorage.setItem(TOKEN_KEY, backup);
          } catch {}

          return;
        }
      }

      return originalRemoveItem(key);
    };
  } catch {}

  // Safety: if something removed the token during startup, try to restore after load
  window.addEventListener("load", () => {
    setTimeout(() => {
      restoreToken();
    }, 50);
  });

  // pageshow covers bfcache restores
  window.addEventListener("pageshow", () => {
    restoreToken();
  });

  console.log("[SESSION FIX] Loaded.");
})();
