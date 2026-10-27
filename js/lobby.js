'use strict';

const me = Session.getUsername();
const RX = 41;
const RY = 36;

const state = {
    game: null,
    players: {},
    host: '',
    minPlayers: 3,
    maxPlayers: 7,
    connected: [],
    hand: [],
    role: null,
    log: [],
    picks: [],
    sel: null
};
const ui = { roleShown: false, sheet: null, sideOpen: false, tab: 'log' };

let socket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let leavingPage = false;
let busy = false;
let conn = 'connecting';
let privateKey = '';
let roleTimer = null;

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const isBot = name => name.startsWith('Bot-');

const GLYPHS = {
    bo: '棒', bokken: '木', daikyu: '弓', kanabo: '金', katana: '刀', kiseru: '管', kusarigama: '鎌', nagayari: '長',
    naginata: '薙', nodachi: '太', shuriken: '星', tanegashima: '銃', wakizashi: '脇',
    armure: '鎧', attaque_rapide: '速', code_du_bushido: '武', concentration: '集',
    ceremonie_du_the: '茶', cri_de_guerre: '吼', daimyo: '大', diversion: '誘', geisha: '芸', ju_jitsu: '柔', meditation: '瞑', parade: '防'
};
const CAT_LABEL = { arme: 'Arme', action: 'Action', permanente: 'Permanente' };
const PHASES = [['recover', 'Récupération'], ['draw', 'Pioche'], ['play', 'Jeu'], ['discard', 'Défausse']];
const DOWN_LABEL = { hp: 'À terre : 0 PV', hand: 'À terre : aucune carte en main' };
const ROLE_GOAL = {
    shogun: 'Camp du Shogun. Éliminer les Ninjas et le Ronin.',
    samurai: 'Camp du Shogun. Protéger le Shogun et vaincre les Ninjas et le Ronin.',
    ninja: 'Camp des Ninjas. Vaincre le Shogun avant la fin de la partie.',
    ronin: 'Camp du Ronin. Rester en vie : vous gagnez seul contre tous.'
};

// ---------- Dérivation de l'état ----------

function view() {
    const list = Object.values(state.players).sort((a, b) => a.position - b.position);
    const g = state.game;
    const started = Boolean(g) && g.state !== 'WAITING';
    const isIn = Boolean(state.players[me]);
    return {
        list,
        count: list.length,
        started,
        ended: Boolean(g) && g.state === 'ENDED',
        isIn,
        isHost: isIn && state.host === me,
        full: list.length >= state.maxPlayers,
        notReady: list.filter(p => p.name !== state.host && !p.ready).map(p => p.name),
        myTurn: started && g.state === 'STARTED' && g.active === me
    };
}

const playerAt = pos => Object.values(state.players).find(p => p.position === pos) || null;
const shogunOf = list => list.find(p => p.role && p.role.id === 'shogun');
const myPlayer = () => state.players[me] || null;

function logEvent(kind, text) {
    state.log.unshift({ kind, text });
    state.log.length = Math.min(state.log.length, 60);
}

function applyState(data) {
    state.game = data.game || null;
    state.players = data.players || {};
    state.host = data.host || '';
    state.minPlayers = data.min_players || state.minPlayers;
    state.maxPlayers = data.max_players || state.maxPlayers;
    if (Array.isArray(data.connected_users)) state.connected = data.connected_users;
    state.picks = state.picks.filter(i => i < (myPlayer() ? myPlayer().hand_count : 0));
    render();
    syncPrivate();
}

// La main et le rôle secret sont privés : récupérés à part quand l'état de la partie change.
function syncPrivate() {
    const v = view();
    const key = v.started && v.isIn
        ? `${state.game.id}:${state.game.turn}:${state.game.phase}:${myPlayer().hand_count}:${state.game.discard_count}`
        : '';
    if (key === privateKey) return;
    privateKey = key;

    if (!key) {
        state.hand = [];
        state.role = null;
        state.sel = null;
        state.picks = [];
        render();
        return;
    }
    refreshPrivate();
}

async function refreshPrivate() {
    const { ok, data } = await apiFetch('/game/me');
    if (!ok) {
        privateKey = '';
        return;
    }
    state.hand = data.hand || [];
    state.role = data.role || null;
    state.sel = null;
    state.picks = [];
    render();
}

// ---------- Composants ----------

const hpHTML = p => `<span class="stat hp" title="Points de vie"><i aria-hidden="true">♥</i><b>${p.life}</b><small>/${p.max_life}</small><span class="sr"> points de vie</span></span>`;
const honorHTML = p => `<span class="stat honor" title="Points d'honneur"><i class="seal" aria-hidden="true">誉</i><b>${p.honor}</b><span class="sr"> points d'honneur</span></span>`;
const btn = (a, label, cls = 'btn', extra = '') => `<button type="button" class="${cls}" data-a="${a}" ${extra}>${label}</button>`;

function portrait(name, letter, big) {
    const h = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0);
    return `<span class="portrait${big ? ' big' : ''}" style="--h:${h}" aria-hidden="true">${esc(letter)}</span>`;
}

const charLetter = p => (p.character ? p.character.name[0] : p.name[0].toUpperCase());

function mini(card) {
    return `<span class="mini cat-${card.category}" tabindex="0" role="img" aria-label="${esc(card.name)} (permanente) : ${esc(card.effect || '')}" title="${esc(card.name)} — ${esc(card.effect || '')}"><b>${GLYPHS[card.id] || card.name[0]}</b><em>${esc(card.name)}</em></span>`;
}

function cardHTML(card, i, o = {}) {
    const cls = ['card', `cat-${card.category}`];
    if (o.selected) cls.push('selected');
    if (o.pick) cls.push('pick');
    const stats = card.category === 'arme' ? `<span class="c-stats"><b>Préc. ${card.precision}</b><b>Dég. ${card.damage}</b></span>` : '';
    return `<button type="button" class="${cls.join(' ')}" data-a="card" data-i="${i}" style="--i:${i}" aria-pressed="${Boolean(o.selected || o.pick)}" aria-label="${esc(card.name)}, ${CAT_LABEL[card.category]}">
        <span class="c-cat">${CAT_LABEL[card.category]}</span><span class="c-art" aria-hidden="true">${GLYPHS[card.id] || esc(card.name[0])}</span><span class="c-name">${esc(card.name)}</span>${stats}
    </button>`;
}

function box(kind, kicker, title, body, actions) {
    return `<section class="prompt prompt-${kind}"><p class="kicker">${kicker}</p><h2>${title}</h2>${body || ''}${actions ? `<div class="prompt-actions">${actions}</div>` : ''}</section>`;
}

function position(k, n) {
    const a = ((90 + (360 * k) / n) * Math.PI) / 180;
    return `--x:${(50 + RX * Math.cos(a)).toFixed(1)}%;--y:${(50 + RY * Math.sin(a)).toFixed(1)}%`;
}

const isOnline = name => isBot(name) || state.connected.includes(name);

// ---------- Rendu : lobby ----------

function lobbySeat(pos) {
    const p = playerAt(pos);
    const v = view();
    const style = position(pos - 1, state.maxPlayers);
    if (!p) {
        const canJoin = !v.isIn && !v.full;
        return `<button type="button" class="seat seat-empty" style="${style}" data-a="join" ${canJoin && !busy ? '' : 'disabled'} aria-label="Place ${pos} libre">
            ${portrait('?', '+')}<span class="seat-body"><span class="seat-name">Place ${pos}</span><span class="seat-char">Libre</span></span></button>`;
    }
    const tags = [
        p.name === state.host ? '<span class="tag tag-shogun">Hôte</span>' : '',
        p.name === state.host || p.ready ? '<span class="tag tag-ready">Prêt</span>' : '<span class="tag tag-wait">En attente</span>'
    ].join('');
    return `<div class="seat${p.name === me ? ' is-mine' : ''}${isOnline(p.name) ? '' : ' is-offline'}" style="${style}" data-a="seat" data-name="${esc(p.name)}" data-seat="${esc(p.name)}" role="button" tabindex="0" aria-label="${esc(p.name)}">
        ${portrait(p.name, p.name[0].toUpperCase())}
        <span class="seat-body"><span class="seat-name">${esc(p.name)}${p.name === me ? ' <span class="muted">(vous)</span>' : ''}</span><span class="seat-stats">${tags}</span></span>
        ${isOnline(p.name) ? '' : '<span class="seat-flag off">Déconnecté</span>'}
    </div>`;
}

function lobbyPrompt(v) {
    const ready = v.count >= state.minPlayers;
    let hint;
    if (!v.isIn) hint = v.full ? 'Le lobby est complet.' : 'Prenez une place pour participer.';
    else if (!ready) hint = `Encore ${plural(state.minPlayers - v.count, 'joueur requis', 'joueurs requis')} pour commencer.`;
    else if (v.isHost) hint = v.notReady.length ? `En attente de ${v.notReady.map(esc).join(', ')}.` : 'Tout le monde est prêt : vous pouvez lancer la partie.';
    else hint = myPlayer().ready ? `Vous êtes prêt. En attente de ${esc(state.host)} (hôte).` : 'Indiquez que vous êtes prêt.';

    const actions = [];
    if (!v.isIn) actions.push(btn('join', 'Rejoindre', 'btn btn-primary', v.full || busy ? 'disabled' : ''));
    else {
        if (v.isHost) actions.push(btn('start', 'Lancer la partie', 'btn btn-primary', busy || !ready || v.notReady.length ? 'disabled' : ''));
        else actions.push(btn('ready', myPlayer().ready ? 'Je ne suis plus prêt' : 'Je suis prêt', myPlayer().ready ? 'btn btn-ghost' : 'btn btn-primary', busy ? 'disabled' : ''));
        actions.push(btn('leave', 'Quitter', 'btn btn-ghost', busy ? 'disabled' : ''));
    }

    const debug = CONFIG.DEBUG ? `<div class="debug-row">
        ${btn('debugGame', 'Partie de test', 'btn btn-ghost btn-small', 'data-start="false"')}
        ${btn('debugGame', 'Test lancée', 'btn btn-ghost btn-small', 'data-start="true"')}
        ${btn('debugBot', '+ Bot', 'btn btn-ghost btn-small', !state.game || v.full || busy ? 'disabled' : '')}
        ${btn('debugReset', 'Reset', 'btn btn-ghost btn-small')}</div>` : '';

    return box('turn', 'Salle d\'attente', `${v.count} / ${state.maxPlayers} joueurs`,
        `<div class="progress" aria-hidden="true"><div class="progress-bar${ready ? ' ready' : ''}" style="width:${(v.count / state.maxPlayers) * 100}%"></div><i class="progress-min" style="left:${(state.minPlayers / state.maxPlayers) * 100}%"></i></div>
        <p>${hint}</p><p class="note">${state.minPlayers} à ${state.maxPlayers} joueurs. Une seule partie à la fois : les autres connectés observent.</p>`,
        actions.join('')) + debug;
}

function lobbyHTML(v) {
    const seats = Array.from({ length: state.maxPlayers }, (_, i) => lobbySeat(i + 1)).join('');
    return `<main class="board"><div class="arena">
        <section class="table" aria-label="Table du lobby">${seats}</section>
        <div class="center">${lobbyPrompt(v)}</div></div></main>`;
}

// ---------- Rendu : partie ----------

function gameSeat(p, k, n) {
    const g = state.game;
    const cls = ['seat'];
    if (g.state === 'STARTED' && g.active === p.name) cls.push('is-active');
    if (p.role && p.role.id === 'shogun') cls.push('is-shogun');
    if (p.down) cls.push('is-down');
    if (!isOnline(p.name)) cls.push('is-offline');
    const perms = p.permanents && p.permanents.length ? `<span class="seat-perms">${p.permanents.map(mini).join('')}</span>` : '';
    const roleTag = p.role ? `<span class="tag ${p.role.id === 'shogun' ? 'tag-shogun' : 'tag-role'}">${esc(p.role.name)}</span>` : '';
    const turnTag = g.state === 'STARTED' && g.active === p.name ? '<span class="tag tag-turn">Son tour</span>' : '';
    const label = `${p.name}, ${p.character.name}, ${p.life} points de vie, ${p.honor} points d'honneur, ${p.hand_count} cartes en main${p.down ? ', ' + DOWN_LABEL[p.down] : ''}`;
    return `<div class="${cls.join(' ')}" style="${position(k, n)}" data-a="seat" data-name="${esc(p.name)}" data-seat="${esc(p.name)}" role="button" tabindex="0" aria-label="${esc(label)}">
        ${portrait(p.name, charLetter(p))}
        <span class="seat-body">
            <span class="seat-name">${esc(p.name)}${roleTag}${turnTag}</span>
            <span class="seat-char">${esc(p.character.name)}</span>
            <span class="seat-stats">${hpHTML(p)}${honorHTML(p)}<span class="stat hand" title="Cartes en main"><i aria-hidden="true">🂠</i><b>${p.hand_count}</b><span class="sr"> cartes en main</span></span></span>
        </span>
        ${perms}
        ${p.down ? `<span class="seat-flag down">${DOWN_LABEL[p.down]}</span>` : ''}
        ${isOnline(p.name) ? '' : '<span class="seat-flag off">Déconnecté</span>'}
    </div>`;
}

function pilesHTML() {
    const g = state.game;
    const top = g.discard_top;
    return `<div class="piles">
        <div class="pile"><span class="pile-back" aria-hidden="true">刀</span><span class="pile-label">Pioche <b>${g.deck_count}</b></span></div>
        <div class="pile"><span class="pile-top ${top ? 'cat-' + top.category : 'empty'}">${top ? `<i>${GLYPHS[top.id] || ''}</i><em>${esc(top.name)}</em>` : '<em>Vide</em>'}</span><span class="pile-label">Défausse <b>${g.discard_count}</b></span></div>
    </div>`;
}

function inspectorHTML() {
    const c = state.hand[state.sel];
    const stats = c.category === 'arme' ? `<p class="statline">Précision <b>${c.precision}</b> · Dégâts <b>${c.damage}</b></p>` : '';
    const body = `<div class="inspect"><div class="bigcard cat-${c.category}"><span class="c-cat">${CAT_LABEL[c.category]}</span><span class="c-art">${GLYPHS[c.id] || ''}</span><span class="c-name">${esc(c.name)}</span></div>
        <div><p class="statline">${CAT_LABEL[c.category]}</p>${stats}<p>${esc(c.effect || 'Attaque un joueur à portée.')}</p>
        <p class="reason"><b>Pas encore jouable :</b> le jeu des cartes n'est pas encore branché sur le serveur.</p></div></div>`;
    return box('wait', 'Carte sélectionnée', esc(c.name), body, btn('cancel', 'Désélectionner', 'btn btn-ghost'));
}

function gamePrompt(v) {
    const g = state.game;
    const active = state.players[g.active];
    if (v.ended) {
        return box('wait', 'Fin de partie', 'Partie terminée',
            `<p>${esc(g.ended_reason || '')} Les rôles sont maintenant révélés.</p>`, v.isHost ? btn('endGame', 'Retour au lobby', 'btn btn-primary') : '');
    }
    if (v.spectator) {
        return box('wait', 'Spectateur', `Tour de ${esc(g.active)}`, '<p>Vous observez la partie. Vous ne voyez ni les mains ni les rôles cachés, et ne pouvez pas agir.</p>');
    }
    if (v.myTurn && g.phase === 'discard') {
        const need = myPlayer().hand_count - 7;
        return box('turn', 'Phase de défausse', `Défaussez ${plural(need, 'carte', 'cartes')}`,
            `<p>Vous ne pouvez pas terminer votre tour avec plus de 7 cartes en main. Sélectionnez les cartes à défausser.</p><p class="counter" aria-live="polite"><b>${state.picks.length} / ${need}</b> cartes sélectionnées</p>`,
            btn('discard', 'Valider la défausse', 'btn btn-primary', state.picks.length === need && !busy ? '' : 'disabled'));
    }
    if (state.sel !== null && state.hand[state.sel]) return inspectorHTML();
    if (v.myTurn) {
        return box('turn', 'À vous de jouer', 'Phase de jeu',
            '<p>Consultez vos cartes en les sélectionnant, puis terminez votre tour. La récupération et la pioche ont été résolues automatiquement.</p>');
    }
    return box('wait', 'En attente', `Tour de ${esc(g.active)}${active && active.role ? ' (Shogun)' : ''}`,
        '<p>Vous pouvez consulter le plateau et votre main.</p>');
}

function dockHTML(v) {
    if (v.spectator) {
        return '<section class="dock spectator"><p><b>Mode spectateur</b> — vous voyez les informations publiques uniquement. Aucun rôle caché, aucune main, aucune action.</p></section>';
    }
    const p = myPlayer();
    const g = state.game;
    const discarding = v.myTurn && g.phase === 'discard';
    const need = p.hand_count - 7;
    const hand = state.hand.map((c, i) => cardHTML(c, i, { selected: !discarding && state.sel === i, pick: discarding && state.picks.includes(i) })).join('');
    const canEnd = v.myTurn && g.phase === 'play' && !busy;
    const roleName = state.role ? state.role.name : 'inconnu';
    return `<section class="dock${p.down ? ' is-down' : ''}${v.myTurn ? ' is-mine' : ''}" data-seat="${esc(me)}" aria-label="Votre zone de jeu">
        <div class="me">
            ${portrait(p.name, charLetter(p), true)}
            <div class="me-id">
                <p class="me-name">${esc(p.name)} <span class="muted">(vous)</span>${p.role ? '<span class="tag tag-shogun">Shogun</span>' : ''}</p>
                <p class="me-char"><b>${esc(p.character.name)}</b> — <span class="ability">${esc(p.character.ability)}</span></p>
                <div class="me-stats">${hpHTML(p)}${honorHTML(p)}</div>
                ${p.down ? `<p class="seat-flag down">${DOWN_LABEL[p.down]}</p>` : ''}
            </div>
            <div class="me-role">
                <button type="button" class="rolechip" data-a="role" aria-pressed="${ui.roleShown}" title="Visible par vous seul : se masque automatiquement">
                    <span class="eye" aria-hidden="true">${ui.roleShown ? '◉' : '◎'}</span>
                    ${ui.roleShown ? `Rôle secret : <b>${esc(roleName)}</b>` : 'Rôle secret masqué — afficher'}
                </button>
                ${ui.roleShown && state.role ? `<small>${esc(ROLE_GOAL[state.role.id] || '')}</small>` : '<small>Privé : jamais visible des autres joueurs.</small>'}
            </div>
        </div>
        <div class="me-perms" aria-label="Vos permanentes"><span class="zone-title">Permanentes</span>${p.permanents.length ? p.permanents.map(mini).join('') : '<em class="muted">Aucune</em>'}</div>
        <div class="handwrap"><div class="hand n-${Math.min(state.hand.length, 12)}" role="group" aria-label="Votre main, ${plural(state.hand.length, 'carte', 'cartes')}" style="--n:${state.hand.length}">${hand || '<em class="muted">Main vide</em>'}</div></div>
        <div class="me-actions">
            ${btn('endTurn', need > 0 ? `Terminer mon tour (défausse : ${need})` : 'Terminer mon tour', 'btn btn-primary btn-big', canEnd ? '' : 'disabled')}
            ${v.myTurn && g.phase === 'discard' ? '<small>Validez la défausse pour passer le tour.</small>' : ''}
        </div>
    </section>`;
}

function gameHTML(v) {
    const g = state.game;
    const n = v.list.length;
    const myIndex = v.list.findIndex(p => p.name === me);
    const order = v.spectator ? v.list : v.list.slice(myIndex + 1).concat(v.list.slice(0, myIndex));
    const seats = order.map((p, idx) => gameSeat(p, v.spectator ? idx : idx + 1, n)).join('');
    return `<main class="board"><div class="arena">
        <section class="table" aria-label="Table de jeu">${seats}</section>
        <div class="center">${pilesHTML()}${gamePrompt(v)}</div></div>${dockHTML(v)}</main>`;
}

// ---------- Structure commune ----------

function topbarHTML(v) {
    const g = state.game;
    const labels = { online: 'En ligne', connecting: 'Connexion…', offline: 'Hors ligne' };
    const cls = { online: 'online', connecting: 'reconnecting', offline: 'rejected' }[conn];
    let turn = '';
    if (v.started && !v.ended) {
        const cur = PHASES.findIndex(p => p[0] === g.phase);
        turn = `<div class="turn"><span class="turn-who">${v.myTurn ? '<b>À vous</b> de jouer' : `Tour de <b>${esc(g.active)}</b>`}</span>
            <ol class="phases" aria-label="Phases du tour">${PHASES.map((p, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}" ${i === cur ? 'aria-current="step"' : ''}><span>${i + 1}</span>${p[1]}</li>`).join('')}</ol></div>`;
    } else if (v.ended) turn = '<div class="turn"><span class="turn-who"><b>Partie terminée</b></span></div>';
    else turn = '<div class="turn"><span class="turn-who">Salle d\'attente</span></div>';

    return `<header class="topbar">
        <div class="brand">KATANA<small>${v.started ? `tour ${g.turn}` : 'lobby'}</small></div>${turn}
        <div class="top-right"><span class="net net-${cls}" role="status"><i aria-hidden="true"></i>${labels[conn]}</span>
            <span class="me-top">${esc(me)}</span>
            ${v.isHost && v.started ? btn('endGame', v.ended ? 'Retour au lobby' : 'Terminer la partie', 'btn btn-small') : ''}
            ${btn('toggleSide', '☰ Journal', 'btn btn-small btn-ghost')}
            ${btn('logout', 'Se déconnecter', 'btn btn-small btn-ghost')}</div>
    </header>`;
}

function sideHTML(v) {
    const tabs = [['log', v.started ? 'Journal' : 'Joueurs'], ['help', 'Aide']];
    let body;
    if (ui.tab === 'help') {
        body = `<div class="help">
            <details open><summary>Phases d'un tour</summary><p>Récupération et pioche sont automatiques. Pendant la phase de jeu vous jouez vos cartes, puis vous terminez votre tour (défausse obligatoire au-delà de 7 cartes).</p></details>
            <details><summary>Que signifie être « à terre » ?</summary><p>0 PV ou aucune carte en main. Le joueur n'est pas éliminé : il ne peut pas être ciblé par une arme et revient en jeu dès que ses conditions sont réunies.</p></details>
            <details><summary>PV ou honneur ?</summary><p>Les PV (cœurs ♥ rouges) sont votre santé. L'honneur (sceaux dorés 誉) détermine la victoire.</p></details>
            <details><summary>Qui est observateur ?</summary><p>Tout joueur connecté qui n'est pas dans la partie. Il ne voit jamais les rôles cachés ni les mains.</p></details></div>`;
    } else if (v.started) {
        body = `<ol class="log" aria-label="Journal des événements">${state.log.map(l => `<li class="l-${l.kind}"><span class="lk">${{ info: 'Info', action: 'Action', important: 'Important' }[l.kind]}</span>${esc(l.text)}</li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ol>`;
    } else {
        const spectators = state.connected.filter(n => !state.players[n]).sort((a, b) => a.localeCompare(b));
        body = `<h3>Joueurs <span class="badge">${v.count}</span></h3><ul class="plist">${v.list.map(p => `<li><span class="dot${isOnline(p.name) ? '' : ' off'}"></span><span class="pname">${esc(p.name)}</span>
            ${p.name === state.host ? '<span class="tag tag-shogun">Hôte</span>' : ''}${p.name === me ? '<span class="tag tag-turn">Vous</span>' : ''}
            ${p.name === state.host || p.ready ? '<span class="tag tag-ready">Prêt</span>' : '<span class="tag tag-wait">En attente</span>'}</li>`).join('') || '<li class="empty">Personne dans le lobby.</li>'}</ul>
            <h3>Observateurs <span class="badge">${spectators.length}</span></h3><ul class="plist">${spectators.map(n => `<li><span class="dot"></span><span class="pname">${esc(n)}</span>${n === me ? '<span class="tag tag-turn">Vous</span>' : ''}</li>`).join('') || '<li class="empty">Personne.</li>'}</ul>`;
    }
    return `<aside class="side${ui.sideOpen ? ' open' : ''}" aria-label="Panneau latéral">
        <div class="tabs" role="tablist">${tabs.map(t => `<button role="tab" aria-selected="${ui.tab === t[0]}" data-a="tab" data-t="${t[0]}">${t[1]}</button>`).join('')}<button class="close-side" data-a="toggleSide" aria-label="Fermer le panneau">✕</button></div>
        <div class="tabbody">${body}</div></aside>`;
}

function sheetHTML() {
    if (!ui.sheet || !state.players[ui.sheet]) return '';
    const p = state.players[ui.sheet];
    if (!p.character) return '';
    return `<div class="sheet-back" data-a="sheetClose"><section class="sheet" role="dialog" aria-label="Détail de ${esc(p.name)}" data-a="noop">
        <header>${portrait(p.name, charLetter(p), true)}<div><h2>${esc(p.name)}${p.role ? ` <span class="tag tag-shogun">${esc(p.role.name)}</span>` : ''}</h2><p>${esc(p.character.name)}</p></div><button class="x" data-a="sheetClose" aria-label="Fermer">✕</button></header>
        <p class="ability">${esc(p.character.ability)}</p>
        <div class="me-stats">${hpHTML(p)}${honorHTML(p)}<span class="stat hand"><b>${p.hand_count}</b> cartes en main</span></div>
        ${p.down ? `<p class="seat-flag down">${DOWN_LABEL[p.down]} — pas éliminé·e : peut revenir en jeu.</p>` : ''}
        <h3>Permanentes</h3>${p.permanents.length ? p.permanents.map(c => `<p class="perm-line">${mini(c)} ${esc(c.effect || '')}</p>`).join('') : '<p class="muted">Aucune permanente en jeu.</p>'}
    </section></div>`;
}

function render() {
    const v = view();
    const focus = document.activeElement;
    const fkey = focus && focus.dataset && focus.dataset.a
        ? `[data-a="${focus.dataset.a}"]${focus.dataset.i !== undefined ? `[data-i="${focus.dataset.i}"]` : ''}${focus.dataset.t ? `[data-t="${focus.dataset.t}"]` : ''}` : null;
    const hw = $('.handwrap');
    const scroll = hw ? hw.scrollLeft : 0;
    const boardTop = $('.board') ? $('.board').scrollTop : 0;

    $('#app').innerHTML = topbarHTML(v) + (v.started ? gameHTML(v) : lobbyHTML(v)) + sideHTML(v) + sheetHTML();

    if (fkey) {
        const f = $(fkey);
        if (f) f.focus({ preventScroll: true });
    }
    if ($('.handwrap')) $('.handwrap').scrollLeft = scroll;
    if ($('.board')) $('.board').scrollTop = boardTop;
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

const REASONS = {
    GAME_IN_PROGRESS: 'Une partie est déjà en cours.',
    NOT_HOST: 'Seul l\'hôte peut faire cela.',
    NOT_READY: 'Tous les joueurs doivent être prêts.',
    NOT_YOUR_TURN: 'Ce n\'est pas votre tour.',
    WRONG_PHASE: 'Action impossible dans cette phase.',
    INVALID_DISCARD: 'Sélection de défausse invalide.'
};

async function call(path, options, failure) {
    const { ok, data } = await apiFetch(path, options);
    if (!ok) showToast(REASONS[data.code] || data.error || failure, 'error');
    await refreshState();
    return ok;
}

const post = (path, failure, body) => runAction(() => call(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, failure));

function logout() {
    leavingPage = true;
    clearTimeout(reconnectTimer);
    if (socket) socket.close();
    apiFetch('/logout', { method: 'POST' }).finally(() => {
        Session.clear();
        window.location.href = 'login.html';
    });
}

async function refreshState() {
    const { ok, data } = await apiFetch('/game');
    if (ok) applyState(data);
}

const ACTIONS = {
    join: () => post('/game/join', 'Impossible de rejoindre le lobby.'),
    leave: () => post('/game/leave', 'Impossible de quitter le lobby.'),
    ready: () => post('/game/ready', 'Impossible de changer votre statut.', { ready: !myPlayer().ready }),
    start: () => post('/game/start', 'Impossible de lancer la partie.'),
    endGame: () => {
        if (view().ended || window.confirm('Terminer la partie et revenir au lobby ?')) return post('/game/end', 'Impossible de terminer la partie.');
    },
    endTurn: () => post('/game/turn/end', 'Impossible de terminer le tour.'),
    discard: () => post('/game/turn/discard', 'Défausse impossible.', { cards: state.picks }),
    debugGame: d => runAction(() => call(`/debug/game?players=3&start=${d.start}`, { method: 'POST' }, 'Mode debug indisponible.')),
    debugBot: () => post('/debug/bot', 'Impossible d\'ajouter un bot.'),
    debugReset: () => runAction(() => call('/debug/game', { method: 'DELETE' }, 'Mode debug indisponible.')),
    seat: d => { ui.sheet = d.name; render(); },
    sheetClose: () => { ui.sheet = null; render(); },
    noop: () => {},
    tab: d => { ui.tab = d.t; render(); },
    toggleSide: () => { ui.sideOpen = !ui.sideOpen; render(); },
    cancel: () => { state.sel = null; render(); },
    logout,
    role: () => {
        ui.roleShown = !ui.roleShown;
        clearTimeout(roleTimer);
        if (ui.roleShown) roleTimer = setTimeout(() => { ui.roleShown = false; render(); }, 5000);
        render();
    },
    card: d => {
        const i = +d.i;
        const v = view();
        if (v.myTurn && state.game.phase === 'discard') {
            const need = myPlayer().hand_count - 7;
            const k = state.picks.indexOf(i);
            if (k >= 0) state.picks.splice(k, 1);
            else if (state.picks.length < need) state.picks.push(i);
            else showToast(`Vous ne devez défausser que ${plural(need, 'carte', 'cartes')}.`, 'warning');
        } else {
            state.sel = state.sel === i ? null : i;
        }
        render();
    }
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.a];
    if (fn) fn(el.dataset);
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (ui.sheet) { ui.sheet = null; return render(); }
        if (state.sel !== null) { state.sel = null; return render(); }
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-a]')) {
        e.preventDefault();
        e.target.click();
    }
});

// ---------- WebSocket ----------

function handleGameUpdate(message) {
    const data = message.data || {};
    const previousHost = state.host;
    const previousActive = state.game ? state.game.active : '';
    const actor = message.from;
    const byOther = actor && actor !== me;

    applyState(data);
    const g = state.game;

    switch (data.event) {
        case 'player_joined':
            if (byOther && !isBot(actor)) showToast(`${actor} a rejoint le lobby.`, 'info');
            break;
        case 'player_left':
            if (byOther) showToast(`${actor} a quitté le lobby.`, 'warning');
            break;
        case 'game_started':
            state.log = [];
            logEvent('important', `La partie commence. ${g ? g.active : ''} (Shogun) joue en premier.`);
            showToast('La partie commence !', 'success');
            break;
        case 'turn_changed':
            if (g && g.state === 'STARTED') {
                if (g.active !== previousActive) logEvent('info', `${actor} termine son tour. Tour de ${g.active}.`);
                else logEvent('info', `${actor} doit défausser avant de terminer son tour.`);
                if (g.active === me && previousActive !== me) showToast('C\'est à vous de jouer.', 'success');
            }
            break;
        case 'game_ended':
            showToast('La partie est terminée.', 'info');
            break;
    }
    if (g && g.state === 'ENDED') logEvent('important', `Partie terminée : ${g.ended_reason}`);

    if (state.host === me && previousHost && previousHost !== me) {
        showToast('Vous êtes maintenant l\'hôte du lobby.', 'info');
    }
    render();
}

function connectWebSocket() {
    if (leavingPage) return;
    conn = 'connecting';
    render();

    socket = new WebSocket(CONFIG.WS_URL);

    socket.onopen = () => {
        reconnectAttempts = 0;
        socket.send(JSON.stringify({ type: 'auth', data: { token: Session.getToken() } }));
        conn = 'online';
        render();
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
        conn = 'offline';
        render();
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
    render();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshState();
    });
    connectWebSocket();
    refreshState();
    setInterval(refreshState, 30000);
}
