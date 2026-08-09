const $ = s => document.querySelector(s);

const state = { me: null, pollTimer: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------- session / UI ---------- */

async function refreshMe() {
  state.me = await api('/api/me');
  const authed = state.me.authed;
  $('#loginBtn').classList.toggle('hidden', authed);
  $('#userInfo').classList.toggle('hidden', !authed);
  $('#faucetBtn').classList.toggle('hidden', !authed || (state.me.balance || 0) > 0);
  if (authed) {
    $('#username').textContent = state.me.username;
    $('#balance').textContent = `${state.me.balance} coins`;
  }
}

/* ---------- login modal ---------- */

function openLogin() {
  $('#loginModal').classList.remove('hidden');
  $('#step1').classList.remove('hidden');
  $('#step2').classList.add('hidden');
  $('#codeError').textContent = '';
}

$('#loginBtn').addEventListener('click', openLogin);
$('#closeModal').addEventListener('click', () => $('#loginModal').classList.add('hidden'));

$('#codeForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#codeError').textContent = '';
  try {
    const data = await api('/api/auth/request', {
      method: 'POST',
      body: JSON.stringify({ username: $('#robloxUser').value.trim() })
    });
    $('#displayCode').textContent = data.code;
    $('#step1').classList.add('hidden');
    $('#step2').classList.remove('hidden');
    $('#verifyMsg').textContent = 'Waiting for you to set your bio…';
  } catch (err) {
    $('#codeError').textContent = err.message;
  }
});

$('#verifyBtn').addEventListener('click', async () => {
  $('#verifyBtn').disabled = true;
  $('#verifyError').textContent = '';
  try {
    const data = await api('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ code: $('#displayCode').textContent })
    });
    if (data.success) {
      $('#loginModal').classList.add('hidden');
      await refreshMe();
      loadHistory();
    } else {
      $('#verifyMsg').textContent = data.message;
    }
  } catch (err) {
    $('#verifyError').textContent = err.message;
  } finally {
    $('#verifyBtn').disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.me = null;
  refreshMe();
});

/* ---------- faucet ---------- */

$('#faucetBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/faucet', { method: 'POST' });
    state.me.balance = data.balance;
    $('#balance').textContent = `${data.balance} coins`;
    $('#faucetBtn').classList.add('hidden');
  } catch (err) { alert(err.message); }
});

/* ---------- coinflip ---------- */

$('#createForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#createError').textContent = '';
  try {
    await api('/api/coinflip', {
      method: 'POST',
      body: JSON.stringify({ amount: $('#amount').value, side: $('#side').value })
    });
    $('#amount').value = '';
    await refreshMe();
    loadRounds();
  } catch (err) { $('#createError').textContent = err.message; }
});

async function loadRounds() {
  try {
    const { rounds } = await api('/api/coinflips');
    const el = $('#rounds');
    if (!rounds.length) {
      el.innerHTML = '<p class="muted">No open duels. Create one!</p>';
      return;
    }
    el.innerHTML = rounds.map(r => `
      <div class="round-card">
        <div class="info">
          <span class="amt">${r.amount} coins</span>
          <span class="meta">@${r.creator.username} · picks ${r.creator.side}</span>
        </div>
        <button class="btn gold" onclick="joinRound('${r.id}')">Join (${r.creator.side === 'HEADS' ? 'TAILS' : 'HEADS'})</button>
      </div>`).join('');
  } catch (err) { /* server unreachable */ }
}

async function joinRound(id) {
  try {
    const { round } = await api(`/api/coinflip/${id}/join`, { method: 'POST' });
    const w = round.winner;
    const youWin = w.username === state.me.username;
    alert(youWin
      ? `You won ${w.prize} coins! (fee: ${w.fee})`
      : `${w.username} won ${w.prize} coins. Better luck next time!`);
    await refreshMe();
    loadRounds();
    loadHistory();
  } catch (err) { alert(err.message); }
}

/* ---------- history ---------- */

async function loadHistory() {
  if (!state.me || !state.me.authed) return;
  try {
    const { history } = await api('/api/history');
    const el = $('#history');
    if (!history.length) { el.innerHTML = '<p class="muted">No duels yet.</p>'; return; }
    el.innerHTML = history.map(h => {
      const me = h.creator.username === state.me.username ? h.creator : h.joiner;
      const won = h.winner.username === state.me.username;
      const side = me.side;
      return `<div class="round-card">
        <div class="info">
          <span class="amt">${won ? '+' : '−'}${won ? h.winner.prize : h.amount} coins</span>
          <span class="meta">${side} vs @${(me === h.creator ? h.joiner : h.creator).username} · ${won ? 'WON' : 'LOST'}</span>
        </div>
        <span class="chip" style="color:${won ? 'var(--green)' : 'var(--red)'}">${won ? 'WIN' : 'LOSS'}</span>
      </div>`;
    }).join('');
  } catch (err) { /* ignore */ }
}

/* ---------- polling ---------- */

setInterval(() => { loadRounds(); if (state.me?.authed) loadHistory(); }, 3000);

refreshMe().then(() => { loadRounds(); loadHistory(); });
