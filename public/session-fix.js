(() => {
"use strict";

/*

* ADMFLIP SESSION FIX
*
* Put this BEFORE app.js:
*
* <script src="/session-fix.js"></script>
* <script src="/app.js"></script>
*
* This keeps a backup of admflip_token in sessionStorage.
* If localStorage loses the token during a page refresh,
* it restores it before app.js starts.
*
* It still allows the normal Logout button to actually log out.
  */

const TOKEN_KEY = "admflip_token";
const BACKUP_KEY = "admflip_session_backup";

function getLocalToken() {
try {
return localStorage.getItem(TOKEN_KEY);
} catch {
return null;
}
}

function getBackupToken() {
try {
return sessionStorage.getItem(BACKUP_KEY);
} catch {
return null;
}
}

function saveBackup(token) {
if (!token) return;

```
try {
  sessionStorage.setItem(BACKUP_KEY, token);
} catch {}
```

}

function restoreToken() {
const current = getLocalToken();

```
if (current) {
  saveBackup(current);
  return current;
}

const backup = getBackupToken();

if (backup) {
  try {
    localStorage.setItem(TOKEN_KEY, backup);
    console.log("[SESSION FIX] Restored ADMFLIP login session.");
    return backup;
  } catch {}
}

return null;
```

}

/*

* Restore BEFORE app.js loads.
  */
  restoreToken();

/*

* Keep the backup synchronized whenever app.js stores
* a newly-issued login token.
  */
  try {
  const originalSetItem = localStorage.setItem.bind(localStorage);

```
localStorage.setItem = function (key, value) {
```

```
  if (key === TOKEN_KEY && value) {
    saveBackup(String(value));
  }

  return originalSetItem(key, value);
};
```

} catch {}

/*

* app.js removes admflip_token when logout() is called.
*
* We allow that removal when the actual Logout button was
* clicked, but prevent accidental token loss from other code.
  */

let realLogout = false;

function markRealLogout() {
realLogout = true;

```
/*
 * Give app.js enough time to execute its async logout()
 * and remove the token.
 */
setTimeout(() => {
  realLogout = false;
  try {
    sessionStorage.removeItem(BACKUP_KEY);
  } catch {}
}, 2500);
```

}

document.addEventListener(
"click",
(event) => {
const target = event.target;

```
  if (
    target &&
    (
      target.id === "logoutBtn" ||
      target.closest?.("#logoutBtn")
    )
  ) {
    markRealLogout();
  }
},
true
```

);

/*

* Protect against accidental removal of the token.
  */
  try {
  const originalRemoveItem =
  localStorage.removeItem.bind(localStorage);

```
localStorage.removeItem = function (key) {
```

```
  if (key === TOKEN_KEY) {
    if (realLogout) {
      try {
        sessionStorage.removeItem(BACKUP_KEY);
      } catch {}

      return originalRemoveItem(key);
    }

    const backup = getBackupToken();

    if (backup) {
      console.warn(
        "[SESSION FIX] Prevented accidental ADMFLIP token removal."
      );

      try {
        originalSetItemSafe(TOKEN_KEY, backup);
      } catch {}

      return;
    }
  }

  return originalRemoveItem(key);
};
```

} catch {}

function originalSetItemSafe(key, value) {
try {
localStorage.setItem(key, value);
} catch {}
}

/*

* Safety check after the page has loaded.
* If something removed the token during startup,
* restore it from the session backup.
  */
  window.addEventListener("load", () => {
  setTimeout(() => {
  restoreToken();
  }, 50);
  });

/*

* pageshow fires when returning to a page from browser
* back/forward cache as well.
  */
  window.addEventListener("pageshow", () => {
  restoreToken();
  });

console.log("[SESSION FIX] Loaded.");
})();
