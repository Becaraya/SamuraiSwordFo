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
    plays: [],
    responseCards: [],
    limit: null,
    targets: null,
    picks: [],
    sel: null
};
const ui = { roleShown: false, sheet: null, sideOpen: false, tab: 'log', target: null, dismissedResults: null };

let socket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let leavingPage = false;
let busy = false;
let conn = 'connecting';
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
const CAMP_LABEL = { shogun_samourai: 'Camp du Shogun', ninja: 'Camp des Ninjas', ronin: 'Camp du Ronin' };
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

function floatText(name, text, cls) {
    const stage = $('#stage').getBoundingClientRect();
    const seat = [...document.querySelectorAll('[data-seat]')].find(n => n.dataset.seat === name);
    if (!seat) return;
    const r = seat.getBoundingClientRect();
    const n = document.createElement('div');
    n.className = `float ${cls}`;
    n.textContent = text;
    n.style.left = `${r.left - stage.left + r.width / 2}px`;
    n.style.top = `${r.top - stage.top + r.height / 2}px`;
    $('#fx').append(n);
    setTimeout(() => n.remove(), 1500);
}

function drawBeam(from, to) {
    const find = name => [...document.querySelectorAll('[data-seat]')].find(n => n.dataset.seat === name);
    const a = find(from);
    const b = find(to);
    if (!a || !b || document.hidden) return;
    const stage = $('#stage').getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const [x1, y1] = [ra.left - stage.left + ra.width / 2, ra.top - stage.top + ra.height / 2];
    const [x2, y2] = [rb.left - stage.left + rb.width / 2, rb.top - stage.top + rb.height / 2];
    const n = document.createElement('i');
    n.className = 'beam';
    n.style.cssText = `left:${x1}px;top:${y1}px;width:${Math.hypot(x2 - x1, y2 - y1)}px;transform:rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)`;
    $('#fx').append(n);
    setTimeout(() => n.remove(), 700);
}

// Indicateurs discrets des variations de PV et d'honneur entre deux états de la même partie.
function fxDiff(before, after, sameGame) {
    if (!sameGame || document.hidden) return;
    for (const [name, p] of Object.entries(after)) {
        const old = before[name];
        if (!old || !old.character || !p.character) continue;
        if (p.life < old.life) floatText(name, `−${old.life - p.life} PV`, 'f-hp');
        if (p.life > old.life) floatText(name, `+${p.life - old.life} PV`, 'f-parry');
        if (p.honor !== old.honor) floatText(name, `${p.honor > old.honor ? '+' : '−'}${Math.abs(p.honor - old.honor)} honneur`, 'f-honor');
    }
}

function applyState(data) {
    const before = state.players;
    const sameGame = Boolean(state.game && data.game && state.game.id === data.game.id && state.game.state !== 'WAITING');
    state.game = data.game || null;
    state.players = data.players || {};
    state.host = data.host || '';
    state.minPlayers = data.min_players || state.minPlayers;
    state.maxPlayers = data.max_players || state.maxPlayers;
    if (Array.isArray(data.connected_users)) state.connected = data.connected_users;
    state.picks = state.picks.filter(i => i < (myPlayer() ? myPlayer().hand_count : 0));
    render();
    fxDiff(before, state.players, sameGame);
    syncPrivate();
}

// La main, le rôle secret et les actions possibles sont privés : récupérés à part après chaque changement d'état.
function syncPrivate() {
    const v = view();
    if (v.started && v.isIn) return refreshPrivate();

    if (state.hand.length || state.role) {
        Object.assign(state, { hand: [], role: null, plays: [], responseCards: [], limit: null, targets: null, sel: null, picks: [] });
        ui.target = null;
        render();
    }
}

async function refreshPrivate() {
    const { ok, data } = await apiFetch('/game/me');
    if (!ok) return;
    const previous = state.sel !== null && state.hand[state.sel] ? state.hand[state.sel].id : null;
    state.hand = data.hand || [];
    state.role = data.role || null;
    state.plays = data.plays || [];
    state.responseCards = data.response_cards || [];
    state.limit = data.weapon_limit || null;
    if (state.sel !== null && (!state.hand[state.sel] || state.hand[state.sel].id !== previous)) clearSelection();
    state.picks = state.picks.filter(i => i < state.hand.length);
    render();
}

function clearSelection() {
    state.sel = null;
    state.targets = null;
    ui.target = null;
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
    if (o.off) cls.push('unplayable');
    if (o.react) cls.push('react-ok');
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
    const T = state.targets && state.targets[p.name];
    if (T) cls.push(T.ok ? 'targetable' : 'untargetable');
    if (ui.target === p.name || (g.pending && g.pending.target === p.name)) cls.push('is-target');
    if (g.pending && g.pending.attacker === p.name) cls.push('is-attacker');
    const flag = T ? `<span class="seat-flag ${T.ok ? 'ok' : 'no'}">${T.ok ? '◎' : '⊘'} ${esc(T.short)}</span>`
        : p.down ? `<span class="seat-flag down">${DOWN_LABEL[p.down]}</span>` : '';
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
        ${flag}
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

const calcParts = list => `<ul class="calc">${list.map((x, i) => `<li><span>${esc(x.label)}</span><b>${x.value > 0 && i > 0 ? '+' : ''}${x.value}</b></li>`).join('')}</ul>`;

function bigCard(c) {
    return `<div class="bigcard cat-${c.category}"><span class="c-cat">${CAT_LABEL[c.category]}</span><span class="c-art">${GLYPHS[c.id] || ''}</span><span class="c-name">${esc(c.name)}</span></div>`;
}

function inspectorHTML() {
    const c = state.hand[state.sel];
    const pl = state.plays[state.sel] || {};
    const stats = c.category === 'arme' ? `<p class="statline">Précision <b>${c.precision}</b> · Dégâts <b>${c.damage}</b></p>` : '';
    const body = `<div class="inspect">${bigCard(c)}
        <div><p class="statline">${CAT_LABEL[c.category]}</p>${stats}<p>${esc(c.effect || 'Attaque un joueur à portée.')}</p>
        ${pl.reason ? `<p class="reason"><b>Non jouable maintenant :</b> ${esc(pl.reason)}</p>` : ''}</div></div>`;
    const play = pl.ok && !pl.needs_target ? btn('playCard', c.category === 'permanente' ? 'Poser devant moi' : 'Jouer cette carte', 'btn btn-primary', busy ? 'disabled' : '') : '';
    return box(pl.ok ? 'turn' : 'wait', 'Carte sélectionnée', esc(c.name), body, `${play}${btn('cancel', 'Désélectionner', 'btn btn-ghost')}`);
}

// Ce que le serveur attend de moi : parade, réponse à un effet collectif ou décision du Code du Bushido.
function myResponse() {
    const g = state.game;
    if (!g || !state.players[me]) return null;
    if (g.pending && g.pending.target === me) return 'attack';
    if (g.collective && g.collective.rows.some(r => r.name === me && r.status === 'pending')) return 'collective';
    if (g.bushido && g.bushido.player === me) return 'bushido';
    return null;
}

function collectiveHTML(col) {
    const mine = myResponse() === 'collective';
    const icon = { pending: '…', done: '✓', exempt: '—' };
    const rows = col.rows.map(r => `<li class="st-${r.status}${r.name === me ? ' me' : ''}"><span aria-hidden="true">${icon[r.status]}</span><b>${esc(r.name)}${r.name === me ? ' (vous)' : ''}</b><span>${r.status === 'pending' ? 'Réponse attendue' : esc(r.text || '')}</span></li>`).join('');
    const what = col.card.id === 'ju_jitsu' ? 'une arme' : 'une Parade';
    const intro = mine ? `<p><b>À vous de répondre :</b> sélectionnez ${what} à défausser, ou perdez 1 PV.</p>` : '<p>En attente des réponses des joueurs concernés.</p>';
    const actions = mine ? `${state.picks.length ? btn('parry', 'Défausser la carte sélectionnée', 'btn btn-primary', busy ? 'disabled' : '') : ''}${btn('takeHit', 'Perdre 1 PV', 'btn btn-ghost', busy ? 'disabled' : '')}` : '';
    return box(mine ? 'react' : 'wait', 'Réaction collective', `${esc(col.issuer)} joue ${esc(col.card.name)}`,
        `${intro}<ul class="responders">${rows}</ul><p class="note">Les réponses ne révèlent jamais le contenu des mains.</p>`, actions);
}

function bushidoHTML(b) {
    if (b.player !== me) {
        return box('wait', 'Code du Bushido', `${esc(b.player)} doit décider`,
            `<p>La carte révélée est ${esc(b.revealed.name)} (une arme, défaussée). ${esc(b.player)} défausse une arme ou perd 1 point d'honneur.</p>`);
    }
    const p = myPlayer();
    const hasWeapon = state.responseCards.length > 0;
    const body = `<div class="inspect">${bigCard(b.revealed)}
        <div><p>La carte révélée est une <b>arme</b> (défaussée). Vous devez choisir :</p>
        <ol class="choices"><li><b>A.</b> Défausser 1 arme de votre main et passer le Code à ${esc(b.next)}.</li>
        <li><b>B.</b> ${b.free ? 'Défausser le Code (le Shogun ne perd pas d\'honneur à 3 joueurs).' : `Perdre 1 point d'honneur (${p.honor} → ${p.honor - 1}) et défausser le Code.`}</li></ol>
        ${hasWeapon ? '<p class="note">Option A : sélectionnez une arme dans votre main.</p>' : '<p class="reason"><b>Option A indisponible :</b> vous n\'avez aucune arme en main.</p>'}</div></div>`;
    const actions = `${state.picks.length ? btn('parry', `A · Défausser l'arme et passer le Code à ${esc(b.next)}`, 'btn btn-primary', busy ? 'disabled' : '') : ''}${btn('takeHit', b.free ? 'B · Défausser le Code' : 'B · Perdre 1 point d\'honneur', 'btn btn-ghost', busy ? 'disabled' : '')}`;
    return box('turn', 'Récupération · Code du Bushido', 'Une décision est attendue', body, actions);
}

function targetConfirmHTML() {
    const c = state.hand[state.sel];
    const t = state.targets[ui.target];
    if (t.options && t.options.length) {
        return box('turn', esc(c.name), `Quel effet sur ${esc(ui.target)} ?`,
            '<p>Une carte prise dans la main est tirée au hasard : vous ne la choisissez pas.</p>',
            `${t.options.map(o => btn('playOption', esc(o.label), 'btn', `data-o="${esc(o.id)}" ${busy ? 'disabled' : ''}`)).join('')}${btn('changeTarget', 'Changer de cible', 'btn btn-ghost')}`);
    }
    return box('turn', 'Confirmer', `${esc(c.name)} → ${esc(ui.target)}`, `<p>${esc(c.effect || '')}</p>`,
        `${btn('confirmPlay', `Jouer ${esc(c.name)}`, 'btn btn-primary', busy ? 'disabled' : '')}${btn('changeTarget', 'Changer de cible', 'btn btn-ghost')}`);
}

function reactionHTML(pend) {
    const p = myPlayer();
    const canParry = state.responseCards.length > 0;
    const body = `<div class="inspect">${bigCard(pend.weapon)}
        <div><p><b>${esc(pend.attacker)}</b> vous attaque avec ${esc(pend.weapon.name)}.</p>
        <p class="statline">Dégâts potentiels <b>${pend.damage.total}</b> · PV ${p.life} → ${Math.max(0, p.life - pend.damage.total)}</p>${calcParts(pend.damage.parts)}</div></div>
        <p>${canParry ? 'Sélectionnez une carte pour parer (cartes éclairées), puis confirmez.' : 'Vous n\'avez aucune parade utilisable.'}</p>`;
    const actions = `${state.picks.length ? btn('parry', 'Parer avec la carte sélectionnée', 'btn btn-primary', busy ? 'disabled' : '') : ''}${btn('takeHit', `Ne pas parer (−${pend.damage.total} PV)`, 'btn btn-ghost', busy ? 'disabled' : '')}`;
    return box('react', 'Réaction requise · hors tour', 'Vous êtes attaqué·e !', body, actions);
}

function previewHTML() {
    const c = state.hand[state.sel];
    const t = state.targets[ui.target];
    const diff = t.difficulty;
    const target = state.players[ui.target];
    const body = `<div class="preview">
        <div><h3>Difficulté ${diff.ignored ? '—' : diff.total} <small>(précision ${c.precision})</small></h3>${diff.ignored ? '<p>Kojirō ignore la difficulté.</p>' : calcParts(diff.parts)}</div>
        <div><h3>Dégâts potentiels ${t.damage.total}</h3>${calcParts(t.damage.parts)}</div></div>
        <p class="note">Dégâts potentiels : ${esc(ui.target)} peut encore se défendre (${target.life} PV → ${Math.max(0, target.life - t.damage.total)} PV sans parade).</p>`;
    return box('turn', 'Confirmer l\'attaque', `${esc(c.name)} → ${esc(ui.target)}`, body,
        `${btn('confirmAttack', 'Confirmer l\'attaque', 'btn btn-primary', busy ? 'disabled' : '')}${btn('changeTarget', 'Changer de cible', 'btn btn-ghost')}`);
}

function gamePrompt(v) {
    const g = state.game;
    const active = state.players[g.active];
    const pend = g.pending;
    if (v.ended) {
        return box('wait', 'Fin de partie', 'Partie terminée',
            `<p>${esc(g.ended_reason || '')} Les rôles sont maintenant révélés.</p>`, v.isHost ? btn('endGame', 'Retour au lobby', 'btn btn-primary') : '');
    }
    if (pend) {
        if (pend.target === me) return reactionHTML(pend);
        if (pend.attacker === me) {
            return box('wait', 'En attente', `En attente de la réponse de ${esc(pend.target)}…`,
                `<p>${esc(pend.weapon.name)} a été annoncée. ${esc(pend.target)} peut parer ou subir l'attaque.</p>`);
        }
        return box('wait', 'Attaque en cours', `${esc(pend.attacker)} attaque ${esc(pend.target)}`,
            `<p>Arme : ${esc(pend.weapon.name)} · dégâts potentiels ${pend.damage.total}. En attente de la réponse de ${esc(pend.target)}.</p>`);
    }
    if (v.spectator) {
        return box('wait', 'Spectateur', `Tour de ${esc(g.active)}`, '<p>Vous observez la partie. Vous ne voyez ni les mains ni les rôles cachés, et ne pouvez pas agir.</p>');
    }
    if (g.collective) return collectiveHTML(g.collective);
    if (g.bushido) return bushidoHTML(g.bushido);
    if (v.myTurn && g.phase === 'discard') {
        const need = myPlayer().hand_count - 7;
        return box('turn', 'Phase de défausse', `Défaussez ${plural(need, 'carte', 'cartes')}`,
            `<p>Vous ne pouvez pas terminer votre tour avec plus de 7 cartes en main. Sélectionnez les cartes à défausser.</p><p class="counter" aria-live="polite"><b>${state.picks.length} / ${need}</b> cartes sélectionnées</p>`,
            btn('discard', 'Valider la défausse', 'btn btn-primary', state.picks.length === need && !busy ? '' : 'disabled'));
    }
    if (v.myTurn && state.sel !== null && state.targets) {
        if (ui.target) return state.hand[state.sel].category === 'arme' ? previewHTML() : targetConfirmHTML();
        const self = state.targets[me] ? btn('pickTarget', 'Devant moi', 'btn', `data-name="${esc(me)}"`) : '';
        return box('turn', 'Choisissez une cible', `${esc(state.hand[state.sel].name)} — qui visez-vous ?`,
            '<p>Les joueurs marqués ◎ sont des cibles possibles. Touchez un joueur marqué ⊘ pour connaître la raison.</p>', `${self}${btn('cancel', 'Annuler', 'btn btn-ghost')}`);
    }
    if (state.sel !== null && state.hand[state.sel]) return inspectorHTML();
    if (v.myTurn) {
        const lim = state.limit;
        return box('turn', 'À vous de jouer', 'Phase de jeu',
            `<p>Sélectionnez une carte de votre main, ou terminez votre tour. Vous pouvez ne rien jouer.</p>${lim ? `<details class="why"><summary>Armes jouables ce tour : <b>${g.played} / ${lim.total}</b></summary>${calcParts(lim.parts)}</details>` : ''}`);
    }
    return box('wait', 'En attente', `Tour de ${esc(g.active)}${active && active.role ? ' (Shogun)' : ''}`,
        '<p>Vous pouvez consulter le plateau et votre main. Si vous êtes attaqué, une fenêtre de réaction s\'affichera ici.</p>');
}

function dockHTML(v) {
    if (v.spectator) {
        return '<section class="dock spectator"><p><b>Mode spectateur</b> — vous voyez les informations publiques uniquement. Aucun rôle caché, aucune main, aucune action.</p></section>';
    }
    const p = myPlayer();
    const g = state.game;
    const discarding = v.myTurn && g.phase === 'discard';
    const responding = myResponse() !== null;
    const need = p.hand_count - 7;
    const hand = state.hand.map((c, i) => {
        const o = {};
        if (discarding) o.pick = state.picks.includes(i);
        else if (responding) {
            o.react = state.responseCards.includes(i);
            o.off = !o.react;
            o.pick = state.picks.includes(i);
        } else {
            o.selected = state.sel === i;
            o.off = Boolean(state.plays[i]) && !state.plays[i].ok;
        }
        return cardHTML(c, i, o);
    }).join('');
    const canEnd = v.myTurn && g.phase === 'play' && !g.pending && !g.collective && !g.bushido && !busy;
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
            ${v.ended ? btn('openResults', 'Résultats', 'btn btn-small') : ''}
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
        body = `<ol class="log" aria-label="Journal des événements">${(state.game.log || []).slice().reverse().map(l => `<li class="l-${l.kind}"><span class="lk">${{ info: 'Info', action: 'Action', important: 'Important' }[l.kind]}</span>${esc(l.text)}</li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ol>`;
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

function resultsHTML(v) {
    const g = state.game;
    const r = g && g.results;
    if (!v.ended || !r || ui.dismissedResults === `${g.id}:${g.turn}`) return '';
    const camp = c => CAMP_LABEL[c] || c;
    const rows = r.rows.map(x => `<tr><th scope="row">${esc(x.name)}${x.role.id === 'shogun' ? ' <span class="tag tag-shogun">Shogun</span>' : ''}</th><td>${esc(x.character)}</td><td>${esc(x.role.name)}</td><td>${x.honor}</td><td>×${x.mult}${x.mult_note ? ` <small class="muted">(${esc(x.mult_note)})</small>` : ''}</td><td>${x.daimyo ? `+${x.daimyo} Daimyō` : '—'}</td><td><b>${x.score}</b></td></tr>`).join('');
    return `<div class="overlay results" role="dialog" aria-label="Résultats de la partie"><div class="overlay-box wide">
        <p class="kicker">Fin de partie</p><h2>${r.tie ? 'Égalité entre camps' : `Victoire : ${camp(r.camps[0].camp)}`}</h2>
        <p>${esc(r.reason)} Les rôles sont maintenant révélés.</p>
        <div class="tablewrap"><table><thead><tr><th>Joueur</th><th>Personnage</th><th>Rôle</th><th>Honneur</th><th>Mult. (${v.count} j.)</th><th>Bonus</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table></div>
        <ul class="camps">${r.camps.map((c, i) => `<li class="${i === 0 && !r.tie ? 'win' : ''}"><span>${camp(c.camp)}</span><b>${c.total}</b></li>`).join('')}</ul>
        <p class="note">${r.tie ? 'Pas de départage : la règle n\'est pas définie dans la spécification, à confirmer avec le livret officiel. ' : ''}Score = honneur × multiplicateur du rôle, plus 1 par Daimyō gardé en main (non multiplié, rien pour le Ronin). Non pris en compte : Lame perdue, victoire au fil de l'épée.</p>
        <div class="prompt-actions">${v.isHost ? btn('endGame', 'Retour au lobby', 'btn btn-primary') : '<p class="note">L\'hôte peut relancer une partie.</p>'}${btn('closeResults', 'Revoir le plateau', 'btn btn-ghost')}</div></div></div>`;
}

function render() {
    const v = view();
    const focus = document.activeElement;
    const fkey = focus && focus.dataset && focus.dataset.a
        ? `[data-a="${focus.dataset.a}"]${focus.dataset.i !== undefined ? `[data-i="${focus.dataset.i}"]` : ''}${focus.dataset.t ? `[data-t="${focus.dataset.t}"]` : ''}` : null;
    const hw = $('.handwrap');
    const scroll = hw ? hw.scrollLeft : 0;
    const boardTop = $('.board') ? $('.board').scrollTop : 0;

    $('#app').innerHTML = topbarHTML(v) + (v.started ? gameHTML(v) : lobbyHTML(v)) + sideHTML(v) + sheetHTML() + resultsHTML(v);

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
    INVALID_DISCARD: 'Sélection de défausse invalide.',
    ATTACK_PENDING: 'Une attaque est en cours de résolution.',
    NO_ATTACK: 'Aucune attaque ne vous cible.',
    NOT_TARGET: 'Cette attaque ne vous cible pas.',
    NOT_PLAYABLE: 'Cette carte n\'est pas jouable maintenant.',
    INVALID_TARGET: 'Cible invalide : la situation a changé (joueur à terre ou hors de portée).',
    INVALID_PARRY: 'Cette carte ne peut pas servir de parade.',
    CARD_NOT_FOUND: 'Carte introuvable : votre main a changé.'
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

function pickTarget(name) {
    const t = state.targets && state.targets[name];
    if (!t) return;
    if (!t.ok) return showToast(t.reason, 'warning');
    ui.target = name;
    render();
}

function playSelected(option) {
    const body = { card: state.sel, target: ui.target || '', option };
    clearSelection();
    return post('/game/play', 'Impossible de jouer cette carte.', body);
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
    seat: d => {
        if (state.targets && state.sel !== null) return pickTarget(d.name);
        ui.sheet = d.name;
        render();
    },
    pickTarget: d => pickTarget(d.name),
    sheetClose: () => { ui.sheet = null; render(); },
    noop: () => {},
    tab: d => { ui.tab = d.t; render(); },
    toggleSide: () => { ui.sideOpen = !ui.sideOpen; render(); },
    cancel: () => { clearSelection(); render(); },
    closeResults: () => { ui.dismissedResults = `${state.game.id}:${state.game.turn}`; render(); },
    openResults: () => { ui.dismissedResults = null; render(); },
    changeTarget: () => { ui.target = null; render(); },
    confirmAttack: () => playSelected(''),
    confirmPlay: () => playSelected(''),
    playOption: d => playSelected(d.o),
    playCard: () => {
        const body = { card: state.sel, target: '', option: '' };
        clearSelection();
        return post('/game/play', 'Impossible de jouer cette carte.', body);
    },
    parry: () => {
        const body = { parry: true, card: state.picks[0] };
        state.picks = [];
        return post('/game/respond', 'Réponse impossible.', body);
    },
    takeHit: () => {
        state.picks = [];
        return post('/game/respond', 'Réponse impossible.', { parry: false, card: 0 });
    },
    logout,
    role: () => {
        ui.roleShown = !ui.roleShown;
        clearTimeout(roleTimer);
        if (ui.roleShown) roleTimer = setTimeout(() => { ui.roleShown = false; render(); }, 5000);
        render();
    },
    card: async d => {
        const i = +d.i;
        const g = state.game;
        const v = view();
        if (v.myTurn && g.phase === 'discard') {
            const need = myPlayer().hand_count - 7;
            const k = state.picks.indexOf(i);
            if (k >= 0) state.picks.splice(k, 1);
            else if (state.picks.length < need) state.picks.push(i);
            else showToast(`Vous ne devez défausser que ${plural(need, 'carte', 'cartes')}.`, 'warning');
        } else if (g.pending || g.collective || g.bushido) {
            if (!myResponse()) return;
            if (state.responseCards.includes(i)) state.picks = state.picks[0] === i ? [] : [i];
            else showToast('Cette carte ne peut pas servir pour cette réponse.', 'warning');
        } else if (state.sel === i) {
            clearSelection();
        } else {
            clearSelection();
            state.sel = i;
            const play = state.plays[i];
            if (v.myTurn && play && play.ok && play.needs_target) {
                const { ok, data } = await apiFetch(`/game/targets?card=${i}`);
                if (ok && state.sel === i) state.targets = Object.fromEntries(data.targets.map(t => [t.name, t]));
                else if (!ok) showToast(REASONS[data.code] || data.error || 'Cibles indisponibles.', 'error');
            }
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
        if (state.sel !== null) { clearSelection(); return render(); }
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
    const hadResponse = myResponse();
    const actor = message.from;
    const byOther = actor && actor !== me;

    applyState(data);
    const g = state.game;

    const response = myResponse();
    if (response && !hadResponse && response !== 'attack') {
        showToast(response === 'collective' ? `${g.collective.issuer} joue ${g.collective.card.name} : r\u00e9pondez.` : 'Code du Bushido : une d\u00e9cision est attendue.', 'warning');
    }
    if (g && g.pending && ['attack', 'bot_action'].includes(data.event)) {
        drawBeam(g.pending.attacker, g.pending.target);
        if (g.pending.target === me) showToast(`${g.pending.attacker} vous attaque avec ${g.pending.weapon.name} !`, 'warning');
    }
    if (g && g.state === 'STARTED' && g.active === me && previousActive !== me) showToast('C\'est à vous de jouer.', 'success');

    switch (data.event) {
        case 'player_joined':
            if (byOther && !isBot(actor)) showToast(`${actor} a rejoint le lobby.`, 'info');
            break;
        case 'player_left':
            if (byOther) showToast(`${actor} a quitté le lobby.`, 'warning');
            break;
        case 'game_started':
            showToast('La partie commence !', 'success');
            break;
        case 'game_ended':
            showToast('La partie est terminée.', 'info');
            break;
    }
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
