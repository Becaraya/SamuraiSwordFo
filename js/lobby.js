const me = Session.getUsername();

const state = {
    game: null,
    players: {},
    host: '',
    minPlayers: 3,
    maxPlayers: 7,
    connected: []
};

let socket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let leavingPage = false;
let busy = false;

const $ = id => document.getElementById(id);
const seats = [];

// ---------- Utilitaires ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function avatarColor(name) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return `hsl(${hash}, 55%, 42%)`;
}

function initials(name) {
    return name.slice(0, 2).toUpperCase();
}

function setAvatar(node, name) {
    node.textContent = initials(name);
    node.style.background = avatarColor(name);
}

// ---------- Dérivation de l'état ----------

function playerAtPosition(position) {
    return Object.values(state.players).find(p => p.position === position) || null;
}

function view() {
    const count = Object.keys(state.players).length;
    const started = Boolean(state.game) && state.game.state !== 'WAITING';
    const isIn = Boolean(state.players[me]);
    return {
        count,
        started,
        isIn,
        isHost: isIn && state.host === me,
        full: count >= state.maxPlayers
    };
}

function applyState(data) {
    state.game = data.game || null;
    state.players = data.players || {};
    state.host = data.host || '';
    state.minPlayers = data.min_players || state.minPlayers;
    state.maxPlayers = data.max_players || state.maxPlayers;
    if (Array.isArray(data.connected_users)) state.connected = data.connected_users;
    render();
}

// ---------- Rendu ----------

function buildSeats() {
    const table = $('table');
    for (let i = 1; i <= state.maxPlayers; i++) {
        const angle = -Math.PI / 2 + ((i - 1) * 2 * Math.PI) / state.maxPlayers;
        const root = el('button', 'seat');
        root.type = 'button';
        root.style.left = `${50 + 42 * Math.cos(angle)}%`;
        root.style.top = `${50 + 41 * Math.sin(angle)}%`;

        const avatar = el('span', 'avatar');
        const name = el('span', 'seat-name');
        const crown = el('span', 'crown', '♛');
        crown.title = 'Hôte du lobby';
        root.append(avatar, name, crown);

        root.addEventListener('click', () => {
            if (!playerAtPosition(i)) joinGame();
        });

        table.appendChild(root);
        seats.push({ root, avatar, name, crown, position: i });
    }
}

function renderSeats(v) {
    const canJoin = !v.isIn && !v.started && !v.full;

    for (const seat of seats) {
        const player = playerAtPosition(seat.position);
        seat.root.classList.toggle('occupied', Boolean(player));
        seat.root.classList.toggle('mine', Boolean(player) && player.name === me);
        seat.root.disabled = Boolean(player) || !canJoin;
        seat.crown.hidden = !player || player.name !== state.host;

        if (player) {
            setAvatar(seat.avatar, player.name);
            seat.name.textContent = player.name === me ? `${player.name} (vous)` : player.name;
            seat.root.setAttribute('aria-label', `Place ${seat.position} : ${player.name}`);
        } else {
            seat.avatar.textContent = '+';
            seat.avatar.style.background = '';
            seat.name.textContent = `Place ${seat.position}`;
            seat.root.setAttribute('aria-label', `Place ${seat.position} libre`);
        }
    }
}

function renderCenter(v) {
    $('phase').textContent = v.started ? 'Partie en cours' : 'Salle d\'attente';
    $('phase').classList.toggle('started', v.started);
    $('count').textContent = v.count;
    $('maxCount').textContent = state.maxPlayers;
    $('progressBar').style.width = `${(v.count / state.maxPlayers) * 100}%`;
    $('progressBar').classList.toggle('ready', v.count >= state.minPlayers);
    $('progressMin').style.left = `${(state.minPlayers / state.maxPlayers) * 100}%`;

    let hint;
    if (v.started) {
        hint = v.isIn ? 'La partie est lancée.' : 'Une partie est en cours, patientez qu\'elle se termine.';
    } else if (!v.isIn) {
        hint = v.full ? 'Le lobby est complet.' : 'Prenez une place pour participer.';
    } else if (v.count < state.minPlayers) {
        const missing = state.minPlayers - v.count;
        hint = `Encore ${missing} joueur${missing > 1 ? 's' : ''} requis pour commencer.`;
    } else if (v.isHost) {
        hint = 'Tout le monde est prêt, vous pouvez lancer la partie.';
    } else {
        hint = `En attente de ${state.host} (hôte) pour lancer la partie.`;
    }
    $('hint').textContent = hint;

    const joinBtn = $('joinBtn');
    joinBtn.textContent = v.isIn ? 'Quitter' : 'Rejoindre';
    joinBtn.classList.toggle('btn-primary', !v.isIn);
    joinBtn.classList.toggle('btn-ghost', v.isIn);
    joinBtn.disabled = busy || (!v.isIn && (v.started || v.full));

    const startBtn = $('startBtn');
    startBtn.hidden = !(v.isHost && !v.started);
    startBtn.disabled = busy || v.count < state.minPlayers;
}

function renderLists(v) {
    const playersList = $('playersList');
    playersList.replaceChildren();
    const players = Object.values(state.players).sort((a, b) => a.position - b.position);
    for (const player of players) {
        const li = el('li');
        const avatar = el('span', 'avatar avatar-small');
        setAvatar(avatar, player.name);
        li.append(avatar, el('span', 'list-name', player.name));
        if (player.name === state.host) li.append(el('span', 'tag tag-host', 'Hôte'));
        if (player.name === me) li.append(el('span', 'tag tag-me', 'Vous'));
        playersList.appendChild(li);
    }
    if (!players.length) playersList.appendChild(el('li', 'empty', 'Personne dans le lobby.'));
    $('playersCount').textContent = players.length;

    const onlineList = $('onlineList');
    onlineList.replaceChildren();
    const online = [...state.connected].sort((a, b) => a.localeCompare(b));
    for (const name of online) {
        const li = el('li');
        li.append(el('span', 'dot'), el('span', 'list-name', name));
        if (name === me) li.append(el('span', 'tag tag-me', 'Vous'));
        else if (state.players[name]) li.append(el('span', 'tag', 'Dans le lobby'));
        onlineList.appendChild(li);
    }
    if (!online.length) onlineList.appendChild(el('li', 'empty', 'Personne en ligne.'));
    $('onlineCount').textContent = online.length;
}

function render() {
    const v = view();
    renderSeats(v);
    renderCenter(v);
    renderLists(v);
}

function setConnection(status) {
    const labels = { online: 'En ligne', connecting: 'Connexion…', offline: 'Hors ligne' };
    $('connStatus').className = `conn conn-${status}`;
    $('connLabel').textContent = labels[status];
}

// ---------- Actions ----------

async function runAction(fn) {
    if (busy) return;
    busy = true;
    render();
    try {
        await fn();
    } finally {
        busy = false;
        render();
    }
}

function joinGame() {
    return runAction(async () => {
        const { ok, data } = await apiFetch('/game/join', { method: 'POST' });
        if (!ok) {
            const message = data.code === 'GAME_IN_PROGRESS'
                ? 'Une partie est déjà en cours.'
                : (data.error || 'Impossible de rejoindre le lobby.');
            showToast(message, 'error');
        }
        await refreshState();
    });
}

function leaveGame() {
    return runAction(async () => {
        const { ok, data } = await apiFetch('/game/leave', { method: 'POST' });
        if (!ok) showToast(data.error || 'Impossible de quitter le lobby.', 'error');
        await refreshState();
    });
}

function startGame() {
    return runAction(async () => {
        const { ok, data } = await apiFetch('/game/start', { method: 'POST' });
        if (!ok) {
            const message = data.code === 'NOT_HOST'
                ? 'Seul l\'hôte peut lancer la partie.'
                : (data.error || 'Impossible de lancer la partie.');
            showToast(message, 'error');
            await refreshState();
        }
    });
}

// Mode debug (backend en APP_ENV=development) : partie fictive avec bots
function debugGame(start) {
    return runAction(async () => {
        const { ok, data } = await apiFetch(`/debug/game?players=3&start=${start}`, { method: 'POST' });
        if (!ok) showToast(data.error || 'Mode debug indisponible.', 'error');
        await refreshState();
    });
}

function debugReset() {
    return runAction(async () => {
        const { ok, data } = await apiFetch('/debug/game', { method: 'DELETE' });
        if (!ok) showToast(data.error || 'Mode debug indisponible.', 'error');
        await refreshState();
    });
}

async function logout() {
    leavingPage = true;
    clearTimeout(reconnectTimer);
    if (socket) socket.close();
    await apiFetch('/logout', { method: 'POST' });
    Session.clear();
    window.location.href = 'login.html';
}

async function refreshState() {
    const { ok, data } = await apiFetch('/game');
    if (ok) applyState(data);
}

// ---------- WebSocket ----------

function handleGameUpdate(message) {
    const data = message.data || {};
    const previousHost = state.host;

    applyState(data);

    const actor = message.from;
    const byOther = actor && actor !== me;

    switch (data.event) {
        case 'player_joined':
            if (byOther) showToast(`${actor} a rejoint le lobby.`, 'info');
            break;
        case 'player_left':
            if (byOther) showToast(`${actor} a quitté le lobby.`, 'warning');
            break;
        case 'game_started':
            showToast('La partie commence !', 'success');
            break;
    }

    if (state.host === me && previousHost && previousHost !== me) {
        showToast('Vous êtes maintenant l\'hôte du lobby.', 'info');
    }
}

function connectWebSocket() {
    if (leavingPage) return;
    setConnection('connecting');

    socket = new WebSocket(CONFIG.WS_URL);

    socket.onopen = () => {
        reconnectAttempts = 0;
        socket.send(JSON.stringify({ type: 'auth', data: { token: Session.getToken() } }));
        setConnection('online');
        refreshState();
    };

    socket.onmessage = event => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            return;
        }
        if (CONFIG.DEBUG) console.debug('[ws]', message);

        if (message.type === 'game_update') {
            handleGameUpdate(message);
        } else if (message.type === 'presence' && message.data) {
            state.connected = message.data.connected_users || [];
            render();
        }
    };

    socket.onclose = () => {
        if (leavingPage) return;
        setConnection('offline');
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 15000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connectWebSocket, delay);
    };
}

// ---------- Initialisation ----------

if (!Session.isValid()) {
    Session.clear();
    window.location.replace('login.html');
} else {
    $('meName').textContent = me;
    buildSeats();
    render();

    $('joinBtn').addEventListener('click', () => (view().isIn ? leaveGame() : joinGame()));
    $('startBtn').addEventListener('click', startGame);
    $('logoutBtn').addEventListener('click', logout);

    if (CONFIG.DEBUG) {
        for (const id of ['debugBtn', 'debugStartBtn', 'debugResetBtn']) $(id).hidden = false;
        $('debugBtn').addEventListener('click', () => debugGame(false));
        $('debugStartBtn').addEventListener('click', () => debugGame(true));
        $('debugResetBtn').addEventListener('click', debugReset);
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshState();
    });

    connectWebSocket();
    refreshState();
    setInterval(refreshState, 30000);
}
