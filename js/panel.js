'use strict';

// Préférences, aide contextuelle, catalogue, détail de carte, chat et accessibilité du plateau.
// Les fonctions lisent `state`, `ui` et `esc` définis par lobby.js : elles ne sont appelées qu'au rendu.

const PREFS_KEY = 'katana:prefs';
const DEFAULT_PREFS = { reduceMotion: false, announce: true, toastLobby: true, toastGame: true, toastChat: false };

function readPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch (e) {
        return {};
    }
}

const prefs = Object.assign({}, DEFAULT_PREFS, readPrefs());

function applyPrefs() {
    document.body.classList.toggle('reduce-motion', prefs.reduceMotion);
}

function savePref(key, value) {
    prefs[key] = value;
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* stockage indisponible : la préférence ne vaut que pour cette session */ }
    applyPrefs();
}

const reducedMotion = () => prefs.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Notification filtrable par catégorie (lobby, game, chat) ; les erreurs passent toujours par showToast.
function notify(message, type, category) {
    if (category && prefs[`toast${category[0].toUpperCase()}${category.slice(1)}`] === false) return;
    showToast(message, type);
}

// ---------- Annonces pour lecteur d'écran ----------

let lastLogText = null;

function announceLog() {
    const g = state.game;
    const live = document.getElementById('live');
    const log = g && g.log ? g.log : [];
    if (live && prefs.announce && lastLogText !== null) {
        const idx = log.map(l => l.text).lastIndexOf(lastLogText);
        const fresh = (idx >= 0 ? log.slice(idx + 1) : log.slice(-3)).filter(l => l.kind !== 'info');
        if (fresh.length) live.textContent = fresh.map(l => l.text).join(' ');
    }
    lastLogText = log.length ? log[log.length - 1].text : null;
}

// ---------- Catalogue et détail de carte ----------

let catalogRequested = false;

async function loadCatalog() {
    if (state.catalog || catalogRequested) return;
    catalogRequested = true;
    const { ok, data } = await apiFetch('/catalog');
    if (ok) {
        state.catalog = data;
        render();
    } else {
        catalogRequested = false;
    }
}

function findCard(id) {
    const pools = [state.hand, state.game && state.game.discard_top ? [state.game.discard_top] : [], ...Object.values(state.players).map(p => p.permanents || [])];
    for (const pool of pools) {
        const c = pool.find(x => x.id === id);
        if (c) return c;
    }
    return state.catalog ? state.catalog.cards.find(x => x.id === id) || null : null;
}

const CATEGORY_RULE = {
    arme: 'Une arme sert à attaquer un joueur. La difficulté de l\'attaque (distance et modificateurs) ne doit pas dépasser la Précision de l\'arme ; les Dégâts sont les PV perdus par la cible si elle ne pare pas.',
    action: 'Une carte Action se joue pendant votre phase de jeu, produit son effet puis est défaussée.',
    permanente: 'Une carte Permanente se pose devant vous et reste en jeu : son effet s\'applique tant qu\'elle est là.'
};

function cardDetailHTML() {
    const c = ui.cardDetail;
    if (!c) return '';
    const entry = state.catalog ? state.catalog.cards.find(x => x.id === c.id) : null;
    const inHand = state.hand.filter(h => h.id === c.id).length;
    const stats = c.category === 'arme' ? `<p class="statline">Précision <b>${c.precision}</b> · Dégâts <b>${c.damage}</b></p>` : '';
    const facts = [
        entry ? `${entry.quantity} exemplaire${entry.quantity > 1 ? 's' : ''} dans la pioche` : '',
        inHand ? `${inHand} dans votre main` : ''
    ].filter(Boolean).join(' · ');
    return `<div class="sheet-back" data-a="cardClose"><section class="sheet card-sheet" role="dialog" aria-modal="true" aria-label="Carte ${esc(c.name)}" tabindex="-1" data-a="noop">
        <header>${bigCard(c)}<div><h2>${esc(c.name)}</h2><p class="statline">${CAT_LABEL[c.category] || ''}</p>${stats}</div>
            <button class="x" data-a="cardClose" data-autofocus aria-label="Fermer">✕</button></header>
        <p>${esc(c.effect || (c.category === 'arme' ? 'Attaque un joueur à portée.' : ''))}</p>
        <p class="note">${esc(CATEGORY_RULE[c.category] || '')}</p>
        ${facts ? `<p class="note">${facts}</p>` : ''}
    </section></div>`;
}

function catalogHTML() {
    if (!state.catalog) return '<p class="muted">Chargement du catalogue…</p>';
    const groups = ['arme', 'action', 'permanente'].map(cat => {
        const items = state.catalog.cards.filter(c => c.category === cat);
        return `<h3>${CAT_LABEL[cat]}s <span class="badge">${items.reduce((n, c) => n + c.quantity, 0)}</span></h3>
            <ul class="catalog">${items.map(c => `<li><button type="button" class="catrow cat-${c.category}" data-a="cardInfo" data-id="${esc(c.id)}">
                <b aria-hidden="true">${GLYPHS[c.id] || esc(c.name[0])}</b><span>${esc(c.name)}${c.category === 'arme' ? ` <small>Préc. ${c.precision} · Dég. ${c.damage}</small>` : ''}</span><small>×${c.quantity}</small></button></li>`).join('')}</ul>`;
    }).join('');
    const chars = `<h3>Personnages <span class="badge">${state.catalog.characters.length}</span></h3>${state.catalog.characters.map(c => `<details class="help"><summary>${esc(c.name)} <small class="muted">${c.life} PV</small></summary><p>${esc(c.ability)}</p></details>`).join('')}`;
    return groups + chars;
}

// ---------- Aide contextuelle calculée à partir de l'état ----------

function contextHelp(v) {
    const g = state.game;
    const out = [];
    if (!v.started) {
        if (!v.isIn) out.push(v.full ? 'Le lobby est complet : vous observez.' : 'Prenez une place libre pour participer.');
        else if (v.count < state.minPlayers) out.push(`Il manque ${state.minPlayers - v.count} joueur(s) pour pouvoir commencer.`);
        else if (v.isHost) out.push(v.notReady.length ? `En attente de ${v.notReady.join(', ')}.` : 'Tout le monde est prêt : lancez la partie.');
        else out.push('Indiquez que vous êtes prêt, l\'hôte lancera la partie.');
        return out;
    }
    const p = myPlayer();
    if (v.ended) return ['La partie est terminée : consultez les résultats, l\'hôte peut ramener tout le monde au lobby.'];
    if (!p) return [`Vous observez la partie. C'est au tour de ${g.active}.`];

    const r = myResponse();
    if (r === 'attack') {
        const pend = g.pending;
        const left = p.life - pend.damage.total;
        out.push(`${pend.attacker} vous attaque avec ${pend.weapon.name} : ${pend.damage.total} dégât(s) possibles.`);
        out.push(state.responseCards.length ? `Vous pouvez parer en défaussant l'une des ${state.responseCards.length} carte(s) surlignée(s).` : 'Vous n\'avez aucune parade utilisable : l\'attaque sera subie.');
        out.push(left > 0 ? `Sans parade, vous passez de ${p.life} à ${left} PV.` : `Sans parade vous seriez vaincu : vous perdriez 1 point d'honneur au profit de ${pend.attacker}.`);
    } else if (r === 'collective') {
        out.push(`${g.collective.issuer} joue ${g.collective.card.name} : défaussez la carte demandée, ou perdez 1 PV.`);
    } else if (r === 'bushido') {
        out.push('Code du Bushido : défaussez une arme pour passer la carte au voisin, sinon vous perdez 1 point d\'honneur.');
    } else if (r === 'draw') {
        out.push('Ieyasu : prenez la carte du dessus de la défausse ou piochez normalement.');
    } else if (v.myTurn && g.phase === 'discard') {
        out.push(`Vous avez ${p.hand_count} cartes : défaussez-en ${p.hand_count - 7} pour terminer votre tour.`);
    } else if (v.myTurn) {
        const playable = state.plays.filter(x => x.ok).length;
        out.push(playable ? `${playable} carte(s) jouable(s) sur ${state.hand.length}.` : 'Aucune carte n\'est jouable maintenant : vous pouvez terminer votre tour.');
        if (state.limit) out.push(`Armes jouées ce tour : ${g.played} / ${state.limit.total}.`);
        const reasons = [...new Set(state.plays.filter(x => !x.ok && x.reason).map(x => x.reason))].slice(0, 3);
        if (reasons.length) out.push(`Cartes bloquées : ${reasons.join(' ; ')}`);
        if (p.hand_count > 7) out.push(`Vous avez ${p.hand_count} cartes : une défausse de ${p.hand_count - 7} sera demandée en fin de tour.`);
        if (state.power && state.power.ok) out.push(`Pouvoir disponible : ${state.power.label}.`);
    } else {
        out.push(`C'est le tour de ${g.active}. Si vous êtes attaqué, vous pourrez parer ici.`);
    }
    if (p.down) out.push(`${DOWN_LABEL[p.down]} : vous n'êtes pas éliminé, vous reviendrez en jeu à votre prochaine récupération.`);
    return out;
}

function helpHTML(v) {
    const now = contextHelp(v).map(s => `<li>${esc(s)}</li>`).join('');
    return `<div class="help"><section class="now" aria-label="Situation actuelle"><h3>Maintenant</h3><ul>${now}</ul></section>
        <details><summary>Phases d'un tour</summary><p>Récupération et pioche sont automatiques. Pendant la phase de jeu vous jouez vos cartes, puis vous terminez votre tour (défausse obligatoire au-delà de 7 cartes).</p></details>
        <details><summary>Que signifie être « à terre » ?</summary><p>0 PV ou aucune carte en main. Le joueur n'est pas éliminé : il ne peut pas être ciblé par une arme et revient en jeu dès que ses conditions sont réunies.</p></details>
        <details><summary>PV ou honneur ?</summary><p>Les PV (cœurs ♥ rouges) sont votre santé. L'honneur (sceaux dorés 誉) détermine la victoire.</p></details>
        <details><summary>Comment finit la partie ?</summary><p>Dès qu'un joueur n'a plus d'honneur, ou qu'un seul joueur a encore des PV (à 4 joueurs ou plus : victoire au fil de l'épée, sauf si la dernière défaite vient d'un coéquipier). Égalité : Ninjas, puis Shogun et Samouraïs, puis Ronin. Un joueur vaincu par un coéquipier fait perdre 3 points d'honneur à son camp.</p></details>
        <details><summary>Qui est observateur ?</summary><p>Tout joueur connecté qui n'est pas dans la partie. Il ne voit jamais les rôles cachés ni les mains.</p></details></div>`;
}

// ---------- Chat ----------

function chatHTML(v) {
    const chat = (state.game && state.game.chat) || [];
    const items = chat.map(m => `<li class="${m.from === me ? 'mine' : ''}"><b>${esc(m.from)}</b><span>${esc(m.text)}</span></li>`).join('') || '<li class="muted">Aucun message.</li>';
    return `<ol class="chat-log" aria-label="Messages de la table">${items}</ol>
        <form class="chat-form" data-form="chat"><label class="sr" for="chat-input">Votre message</label>
            <input id="chat-input" data-a="chatInput" maxlength="200" autocomplete="off" placeholder="${v.isIn ? 'Écrire à la table…' : 'Seuls les joueurs écrivent'}" value="${esc(ui.chatDraft)}" ${v.isIn ? '' : 'disabled'}>
            <button type="submit" class="btn btn-small btn-primary" ${v.isIn ? '' : 'disabled'}>Envoyer</button></form>
        <p class="note">Parlez librement et bluffez sur votre rôle, mais ne parlez pas de vos cartes en main et ne demandez pas si une carte sera négative pour quelqu'un (règle du jeu).</p>`;
}

async function sendChat() {
    const text = ui.chatDraft.trim();
    if (!text) return;
    const { ok, data } = await apiFetch('/game/chat', { method: 'POST', body: JSON.stringify({ text }) });
    if (ok) ui.chatDraft = '';
    else showToast(data.error || 'Message non envoyé.', 'warning');
    await refreshState();
}

// ---------- Réglages ----------

function settingsHTML() {
    const opt = (key, label, hint) => `<label class="pref"><input type="checkbox" data-a="pref" data-k="${key}" ${prefs[key] ? 'checked' : ''}><span>${label}<small>${hint}</small></span></label>`;
    return `<div class="prefs"><h3>Animations et lecture</h3>
        ${opt('reduceMotion', 'Réduire les animations', 'Supprime les effets de dégâts, de faisceau et les transitions.')}
        ${opt('announce', 'Annoncer les événements', 'Les actions importantes sont lues par les lecteurs d\'écran.')}
        <h3>Notifications</h3>
        ${opt('toastLobby', 'Lobby', 'Arrivées et départs de joueurs.')}
        ${opt('toastGame', 'Partie', 'Votre tour, attaques, déconnexions.')}
        ${opt('toastChat', 'Chat', 'Un message de la table est arrivé.')}
        <p class="note">Les erreurs et les demandes de réponse restent toujours affichées. Réglages enregistrés sur cet appareil.</p>
        <h3>Clavier</h3><ul class="keys"><li><kbd>Tab</kbd> parcourt la table, la main et le panneau.</li><li><kbd>←</kbd> <kbd>→</kbd> déplacent la sélection dans la main ou autour de la table.</li><li><kbd>Entrée</kbd> ou <kbd>Espace</kbd> active ; <kbd>I</kbd> détaille la carte ; <kbd>Échap</kbd> ferme.</li></ul></div>`;
}

// ---------- Focus et clavier ----------

const focusKey = el => (el && el.dataset && el.dataset.a
    ? `[data-a="${el.dataset.a}"]${el.dataset.i !== undefined ? `[data-i="${el.dataset.i}"]` : ''}${el.dataset.t ? `[data-t="${el.dataset.t}"]` : ''}${el.dataset.name ? `[data-name="${el.dataset.name}"]` : ''}${el.dataset.id ? `[data-id="${el.dataset.id}"]` : ''}`
    : null);

let hadDialog = false;

const topDialog = () => [...document.querySelectorAll('[role="dialog"]')].pop() || null;

// Un dialogue qui s'ouvre prend le focus ; à sa fermeture le focus revient à l'élément qui l'avait ouvert.
function manageDialogFocus() {
    const dlg = topDialog();
    if (dlg) {
        if (!dlg.contains(document.activeElement)) (dlg.querySelector('[data-autofocus]') || dlg).focus({ preventScroll: true });
    } else if (hadDialog && ui.returnKey) {
        const back = document.querySelector(ui.returnKey);
        if (back) back.focus({ preventScroll: true });
        ui.returnKey = null;
    }
    hadDialog = Boolean(dlg);
}

function trapTab(e) {
    const dlg = topDialog();
    if (!dlg || e.key !== 'Tab') return false;
    const items = [...dlg.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex="0"]')];
    if (!items.length) {
        e.preventDefault();
        return true;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (!dlg.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === dlg)) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
    return true;
}

// Flèches : déplacement dans la main (gauche/droite) ou autour de la table.
function arrowNav(e) {
    const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: 'first', End: 'last' };
    if (!(e.key in keys) || e.target.matches('input, textarea, select')) return false;
    const group = e.target.closest('.hand') ? '.hand .card' : e.target.closest('.table') ? '.table .seat:not([disabled])' : null;
    if (!group) return false;
    const items = [...document.querySelectorAll(group)];
    const at = items.indexOf(e.target.closest(group));
    if (at < 0) return false;
    const step = keys[e.key];
    const next = step === 'first' ? 0 : step === 'last' ? items.length - 1 : (at + step + items.length) % items.length;
    e.preventDefault();
    items[next].focus();
    return true;
}
