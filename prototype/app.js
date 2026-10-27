'use strict';
/* Prototype UX Katana : état simulé côté client. En production, S est un instantané envoyé par le serveur
   (autoritaire) ; l'UI n'écrit jamais dans S sans confirmation, voir commit(). */

const UI = { side: 'log', sideOpen: false, roleShown: false, reduce: false, sheet: null, draft: '' };
const SIM = { defender: 'parry', reject: false };
const RX = 41;
const RY = 36;

let S = null;
let timers = [];
let roleTimer = null;

const $ = s => document.querySelector(s);
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ---------- Situations simulées ----------

function newState(id) {
    const three = id === 'three';
    const s = {
        id, three, spectator: id === 'spectator',
        players: three ? players3() : players7(),
        me: id === 'spectator' ? -1 : 0, active: 0, phase: 'play',
        hand: ['katana', 'bokken', 'kusarigama', 'parade', 'geisha', 'cri_de_guerre', 'daimyo'],
        played: 0, deckN: 41, discard: ['bokken', 'parade'],
        mode: 'idle', sel: null, target: null, picks: [], geisha: null, pending: null,
        reaction: null, collective: null, banner: null, overlay: null, ended: null, net: 'online',
        log: [{ k: 'info', t: 'Tour 5 · Kenji a terminé son tour.' }, { k: 'important', t: 'Takeshi a vaincu Mizuki : Mizuki perd 1 point d\'honneur, Takeshi en gagne 1.' }, { k: 'info', t: 'C\'est à vous de jouer.' }]
    };
    if (three) s.discard = ['parade'];

    switch (id) {
        case 'defend':
        case 'reconnect':
            s.active = 5;
            s.mode = 'reaction';
            s.reaction = { att: 5, weapon: 'kusarigama', pick: null };
            s.log.unshift({ k: 'action', t: 'Takeshi attaque Aiko avec Kusarigama.' });
            if (id === 'reconnect') s.overlay = 'reconnect';
            break;
        case 'collective':
            s.active = 1;
            s.mode = 'collective';
            s.players[2].hand = 3;
            s.collective = {
                card: 'cri_de_guerre', issuer: 1,
                rows: s.players.map((p, i) => {
                    if (i === 1) return null;
                    if (i === 0) return { idx: i, status: 'pending' };
                    if (Engine.downReason(p)) return { idx: i, status: 'exempt', text: Engine.downReason(p).replace('À terre : ', 'À terre — ') + ' : non affecté' };
                    if (p.char === 'chiyome') return { idx: i, status: 'exempt', text: 'Chiyome : seules les armes la blessent' };
                    if (i === 2) return { idx: i, status: 'done', text: 'a défaussé une Parade' };
                    return { idx: i, status: 'pending' };
                }).filter(Boolean)
            };
            s.log.unshift({ k: 'action', t: 'Kenji joue Cri de guerre.' });
            break;
        case 'discard':
            s.hand = [...s.hand, 'meditation', 'diversion'];
            s.phase = 'discard';
            s.mode = 'discard';
            s.log.unshift({ k: 'info', t: 'Vous avez joué vos cartes. Votre main dépasse 7 cartes.' });
            break;
        case 'deck':
            s.players[5].honor = 1;
            s.players[0].honor = 5;
            s.players[3].honor = 4;
            s.players[6].honor = 3;
            s.deckN = 0;
            break;
        case 'end':
            [4, 3, 4, 4, 3, 0, 3].forEach((h, i) => (s.players[i].honor = h));
            s.players[1].honor = 3;
            s.players[0].honor = 6;
            s.ended = buildResults(s, 'Takeshi a atteint 0 point d\'honneur.');
            s.overlay = 'results';
            break;
        case 'spectator':
            s.active = 1;
            s.mode = 'idle';
            s.log.unshift({ k: 'info', t: 'Vous observez la partie en tant que spectateur.' });
            break;
        case 'three':
            s.hand = ['katana', 'bokken', 'parade', 'parade', 'geisha', 'daimyo', 'nodachi'];
            break;
        case 'bushido_weapon':
        case 'bushido_none':
            s.phase = 'recover';
            s.players[0].perm.push('code_du_bushido');
            s.log.unshift({ k: 'info', t: 'Début de votre tour : phase de récupération. Le Code du Bushido est devant vous.' });
            break;
    }
    return s;
}

function start(id) {
    timers.forEach(clearTimeout);
    timers = [];
    S = newState(id);
    render();
    if (id === 'reconnect') {
        S.net = 'reconnecting';
        render();
        later(() => {
            S.overlay = null;
            S.net = 'online';
            S.banner = { kind: 'info', text: 'Connexion rétablie : votre contexte a été restauré. Une attaque attend toujours votre réponse.' };
            render();
        }, 2600);
    }
    if (id === 'deck') later(deckExhausted, 900);
    if (id === 'bushido_weapon') later(() => revealBushido('nodachi'), 900);
    if (id === 'bushido_none') later(() => revealBushido('geisha'), 900);
}

// ---------- Utilitaires d'état ----------

const meP = () => (S.me >= 0 ? S.players[S.me] : null);
const myTurn = () => S.me >= 0 && S.active === S.me;
const weaponLimit = () => Engine.weaponLimit(S.players, S.me, S.three);
const ctx = () => ({ players: S.players, me: S.me, myTurn: myTurn(), phase: S.phase, played: S.played, limit: weaponLimit().total, hand: S.hand });
const isParry = id => id === 'parade' || (meP() && meP().char === 'hanzo' && CARDS[id].cat === 'arme' && S.hand.length > 1);

function sync() {
    if (S.me >= 0) S.players[S.me].hand = S.hand.length;
}

function log(k, t) {
    S.log.unshift({ k, t });
}

function toast(kind, text) {
    const labels = { info: 'Info', action: 'Action requise', warn: 'Attention', important: 'Important' };
    const node = document.createElement('div');
    node.className = `toast toast-${kind}`;
    const label = document.createElement('b');
    label.textContent = labels[kind];
    const msg = document.createElement('span');
    msg.textContent = text;
    node.append(label, msg);
    $('#toasts').append(node);
    setTimeout(() => node.remove(), kind === 'warn' ? 4200 : 3400);
}

function center(sel) {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const s = $('#stage').getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
}

function floatText(seat, text, cls) {
    const c = center(`[data-seat="${seat}"]`);
    if (!c) return;
    const n = document.createElement('div');
    n.className = `float ${cls}`;
    n.textContent = text;
    n.style.left = `${c.x}px`;
    n.style.top = `${c.y}px`;
    $('#fx').append(n);
    setTimeout(() => n.remove(), 1500);
}

function beam(from, to) {
    const a = center(`[data-seat="${from}"]`);
    const b = center(`[data-seat="${to}"]`);
    if (!a || !b || UI.reduce) return;
    const n = document.createElement('i');
    n.className = 'beam';
    n.style.cssText = `left:${a.x}px;top:${a.y}px;width:${Math.hypot(b.x - a.x, b.y - a.y)}px;transform:rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
    $('#fx').append(n);
    setTimeout(() => n.remove(), 700);
}

// Action envoyée au serveur : rien n'est appliqué tant que la confirmation n'est pas reçue.
function commit(fn, fallbackMode) {
    S.mode = 'sending';
    S.net = 'pending';
    render();
    later(() => {
        if (SIM.reject) {
            SIM.reject = false;
            $('#simReject').checked = false;
            S.net = 'rejected';
            S.mode = fallbackMode || 'idle';
            toast('warn', 'Action refusée par le serveur : l\'état de la partie a changé. Rien n\'a été joué, vos cartes sont intactes.');
            render();
            later(() => { S.net = 'online'; render(); }, 1800);
            return;
        }
        S.net = 'confirmed';
        fn();
        render();
        later(() => { S.net = 'online'; render(); }, 1000);
    }, 650);
}

function clearSel() {
    S.sel = null;
    S.target = null;
    S.geisha = null;
    if (['targeting', 'preview', 'geisha'].includes(S.mode)) S.mode = 'idle';
}

function removeCard(i) {
    const id = S.hand.splice(i, 1)[0];
    S.discard.push(id);
    return id;
}

function draw(n) {
    const pool = ['bokken', 'kusarigama', 'parade', 'katana', 'geisha', 'daimyo', 'nodachi', 'parade'];
    for (let i = 0; i < n; i++) S.hand.push(pool[Math.floor(Math.random() * pool.length)]);
    S.deckN = Math.max(0, S.deckN - n);
}

// ---------- Cibles ----------

function currentTargets() {
    const map = {};
    if (S.sel === null || !['targeting', 'preview', 'geisha'].includes(S.mode)) return map;
    const id = S.hand[S.sel];
    if (CARDS[id].cat === 'arme') {
        Engine.weaponTargets(S.players, S.me, id).forEach(t => {
            const down = Engine.downReason(S.players[t.idx]);
            const short = t.ok ? (t.diff.ignored ? 'Sans difficulté' : `Difficulté ${t.diff.total} ≤ ${CARDS[id].prec}`)
                : (down ? 'À terre' : `Difficulté ${t.diff.total} > ${CARDS[id].prec}`);
            map[t.idx] = Object.assign({ short }, t);
        });
    } else if (id === 'geisha') {
        S.players.forEach((p, idx) => {
            if (idx === S.me) return;
            const ok = p.perm.length > 0 || p.hand > 0;
            map[idx] = { idx, ok, short: ok ? 'Cible possible' : 'Rien à défausser', reason: `${p.name} n'a ni permanente ni carte en main : Geisha n'a aucun effet.` };
        });
    }
    return map;
}

// ---------- Actions de jeu ----------

function selectCard(i) {
    const id = S.hand[i];
    if (id === undefined) return;
    if (S.mode === 'discard') {
        const need = S.hand.length - 7;
        const k = S.picks.indexOf(i);
        if (k >= 0) S.picks.splice(k, 1);
        else if (S.picks.length < need) S.picks.push(i);
        else toast('warn', `Vous ne devez défausser que ${plural(need, 'carte', 'cartes')}. Désélectionnez-en une d'abord.`);
        return render();
    }
    if (S.mode === 'bushido') {
        if (CARDS[id].cat !== 'arme') return toast('warn', 'Seule une arme peut être défaussée pour le Code du Bushido.');
        S.bushido.pick = S.bushido.pick === i ? null : i;
        return render();
    }
    if (S.mode === 'reaction' || S.mode === 'collective') {
        if (S.mode === 'collective' && !collectiveMine()) return;
        if (!isParry(id)) return toast('warn', 'Cette carte ne peut pas servir de parade.');
        const holder = S.mode === 'reaction' ? S.reaction : S.collective;
        holder.pick = holder.pick === i ? null : i;
        return render();
    }
    if (['sending', 'waiting'].includes(S.mode)) return;
    if (S.sel === i) {
        clearSel();
        return render();
    }
    S.sel = i;
    S.target = null;
    S.geisha = null;
    const pl = Engine.playability(ctx(), id);
    S.mode = pl.ok && (CARDS[id].cat === 'arme' || id === 'geisha') ? 'targeting' : 'idle';
    render();
}

function clickSeat(i) {
    if (['targeting', 'preview'].includes(S.mode)) {
        const t = currentTargets()[i];
        if (!t) return;
        if (!t.ok) return toast('warn', t.reason);
        S.target = i;
        S.mode = S.hand[S.sel] === 'geisha' ? 'geisha' : 'preview';
        return render();
    }
    UI.sheet = i;
    render();
}

function confirmAttack() {
    const target = S.target;
    const sel = S.sel;
    commit(() => {
        const weapon = removeCard(sel);
        S.played++;
        S.pending = { target, weapon };
        S.mode = 'waiting';
        S.sel = null;
        S.target = null;
        sync();
        log('action', `Vous attaquez ${S.players[target].name} avec ${CARDS[weapon].n}.`);
        later(() => beam(S.me, target), 30);
        later(resolveAttack, 1700);
    }, 'preview');
}

function resolveAttack() {
    const { target, weapon } = S.pending;
    const t = S.players[target];
    const dm = Engine.damage(S.players, S.me, target, weapon);
    if (SIM.defender === 'parry') {
        t.hand = Math.max(0, t.hand - 1);
        S.discard.push('parade');
        log('action', `${t.name} pare l'attaque avec une Parade : aucun dégât.`);
        floatText(target, 'Paré', 'f-parry');
        toast('info', `${t.name} a paré votre attaque.`);
    } else {
        t.hp = Math.max(0, t.hp - dm.total);
        floatText(target, `−${dm.total} PV`, 'f-hp');
        log('action', `${t.name} ne pare pas et perd ${dm.total} PV (${t.hp}/${Engine.maxHp(t)}).`);
        if (t.hp === 0) {
            t.honor -= 1;
            meP().honor += 1;
            floatText(target, '−1 honneur', 'f-honor');
            floatText(S.me, '+1 honneur', 'f-honor');
            log('important', `${t.name} est vaincu·e : perd 1 point d'honneur, ${meP().name} en gagne 1.`);
            toast('important', `${t.name} est à terre (0 PV). ${t.name} perd 1 point d'honneur. Les cibles et difficultés sont recalculées.`);
        }
    }
    S.pending = null;
    S.mode = 'idle';
    sync();
    if (S.hand.length === 0) toast('important', 'Vous n\'avez plus de carte en main : vous êtes à terre. Vous revenez dès que vous recevez une carte.');
    checkEnd('Un joueur a atteint 0 point d\'honneur.');
    render();
}

function playGeneric() {
    const i = S.sel;
    const id = S.hand[i];
    const c = CARDS[id];
    commit(() => {
        if (id === 'daimyo') {
            removeCard(i);
            draw(2);
            log('action', 'Vous jouez Daimyō et piochez 2 cartes.');
            toast('info', 'Vous piochez 2 cartes (Daimyō).');
        } else if (id === 'cri_de_guerre') {
            removeCard(i);
            log('action', 'Vous jouez Cri de guerre.');
            startCollective();
        } else if (c.cat === 'permanente') {
            S.hand.splice(i, 1);
            meP().perm.push(id);
            log('action', `Vous posez ${c.n} devant vous.`);
        } else {
            removeCard(i);
            log('action', `Vous jouez ${c.n}.`);
            toast('info', `${c.n} : l'effet n'est pas simulé dans ce prototype.`);
        }
        if (S.mode === 'sending') S.mode = 'idle';
        S.sel = null;
        sync();
    }, 'idle');
}

function startCollective() {
    const rows = [];
    S.players.forEach((p, i) => {
        if (i === S.me) return;
        const down = Engine.downReason(p);
        if (down) rows.push({ idx: i, status: 'exempt', text: down.replace('À terre : ', 'À terre — ') + ' : non affecté' });
        else if (p.char === 'chiyome') rows.push({ idx: i, status: 'exempt', text: 'Chiyome : seules les armes la blessent' });
        else rows.push({ idx: i, status: 'pending' });
    });
    S.collective = { card: 'cri_de_guerre', issuer: S.me, rows, pick: null };
    S.mode = 'collective';
    rows.filter(r => r.status === 'pending').forEach((r, k) => later(() => {
        const p = S.players[r.idx];
        r.status = 'done';
        if (p.hand > 2) {
            p.hand--;
            r.text = 'a défaussé une Parade';
        } else {
            p.hp = Math.max(0, p.hp - 1);
            r.text = 'perd 1 PV';
            floatText(r.idx, '−1 PV', 'f-hp');
        }
        render();
    }, 800 * (k + 1)));
    later(() => {
        S.collective = null;
        S.mode = 'idle';
        log('action', 'Cri de guerre résolu : tous les joueurs concernés ont répondu.');
        render();
    }, 800 * (rows.filter(r => r.status === 'pending').length + 1) + 600);
}

const collectiveMine = () => S.collective && S.collective.rows.some(r => r.idx === S.me && r.status === 'pending');

function collectiveRespond(lose) {
    const col = S.collective;
    const row = col.rows.find(r => r.idx === S.me);
    const pick = col.pick;
    commit(() => {
        S.mode = 'collective';
        row.status = 'done';
        if (lose) {
            meP().hp = Math.max(0, meP().hp - 1);
            row.text = 'perd 1 PV';
            floatText(S.me, '−1 PV', 'f-hp');
            log('action', 'Vous perdez 1 PV (Cri de guerre).');
        } else {
            removeCard(pick);
            row.text = 'a défaussé une Parade';
            log('action', 'Vous défaussez une Parade (Cri de guerre).');
        }
        col.pick = null;
        sync();
        const other = col.rows.find(r => r.status === 'pending');
        if (other) {
            later(() => {
                other.status = 'done';
                other.text = 'perd 1 PV';
                S.players[other.idx].hp = Math.max(0, S.players[other.idx].hp - 1);
                floatText(other.idx, '−1 PV', 'f-hp');
                render();
            }, 900);
        }
        later(() => {
            S.collective = null;
            S.mode = 'idle';
            log('important', 'Cri de guerre résolu : tous les joueurs concernés ont répondu.');
            render();
        }, 2300);
    }, 'collective');
}

function reactionRespond(parry) {
    const r = S.reaction;
    const dm = Engine.damage(S.players, r.att, S.me, r.weapon);
    const pick = r.pick;
    commit(() => {
        if (parry) {
            removeCard(pick);
            floatText(S.me, 'Paré', 'f-parry');
            log('action', 'Vous parez l\'attaque de Takeshi avec une Parade : aucun dégât.');
            toast('info', 'Attaque parée. Le tour de Takeshi reprend.');
        } else {
            meP().hp = Math.max(0, meP().hp - dm.total);
            floatText(S.me, `−${dm.total} PV`, 'f-hp');
            log('action', `Vous ne parez pas et perdez ${dm.total} PV (${meP().hp}/${Engine.maxHp(meP())}).`);
        }
        S.reaction = null;
        S.mode = 'idle';
        sync();
    }, 'reaction');
}

function endTurn() {
    if (S.hand.length > 7) {
        S.mode = 'discard';
        S.phase = 'discard';
        S.picks = [];
        clearSel();
        S.mode = 'discard';
        return render();
    }
    passTurn();
}

function confirmDiscard() {
    const picks = [...S.picks].sort((a, b) => b - a);
    commit(() => {
        picks.forEach(removeCard);
        log('action', `Vous défaussez ${plural(picks.length, 'carte', 'cartes')}.`);
        S.picks = [];
        sync();
        passTurn();
    }, 'discard');
}

function passTurn() {
    S.mode = 'idle';
    clearSel();
    log('info', 'Vous terminez votre tour.');
    S.active = (S.me + 1) % S.players.length;
    S.phase = 'play';
    render();
    later(() => {
        log('info', `${S.players[S.active].name} a terminé son tour.`);
        startMyTurn();
    }, 2600);
}

function startMyTurn() {
    S.active = S.me;
    S.played = 0;
    S.phase = 'recover';
    const p = meP();
    S.banner = { kind: 'info', text: p.hp > 0 ? 'Récupération : vous avez encore des PV, rien à récupérer.' : 'Récupération : vous récupérez tous vos PV.' };
    if (p.hp <= 0) p.hp = Engine.maxHp(p);
    render();
    later(() => {
        if (p.perm.includes('code_du_bushido')) {
            S.banner = null;
            revealBushido(S.hand.length % 2 ? 'nodachi' : 'geisha');
        } else drawPhase();
    }, 1300);
}

function drawPhase() {
    const d = Engine.drawCount(S.players, S.me, S.three);
    S.mode = 'idle';
    S.phase = 'draw';
    draw(d.total);
    S.banner = { kind: 'info', text: `Pioche : ${plural(d.total, 'carte', 'cartes')} (${d.parts.map(x => `${x.label} ${x.v > 0 && x !== d.parts[0] ? '+' : ''}${x.v}`).join(', ')}).` };
    log('info', `Vous piochez ${plural(d.total, 'carte', 'cartes')}.`);
    render();
    later(() => {
        S.phase = 'play';
        S.banner = null;
        log('info', 'C\'est à vous de jouer.');
        render();
    }, 1500);
}

// Code du Bushido : fin de la phase de récupération du joueur qui l'a devant lui.
const leftNeighbour = () => (S.me + 1) % S.players.length;
const bushidoFree = () => S.three && meP().shogun;

function revealBushido(flipped) {
    S.discard.push(flipped);
    S.deckN = Math.max(0, S.deckN - 1);
    S.pending = null;
    log('action', `Code du Bushido : la carte révélée est ${CARDS[flipped].n}, elle est défaussée.`);
    if (CARDS[flipped].cat === 'arme') {
        S.mode = 'bushido';
        S.bushido = { flipped, pick: null };
    } else {
        S.mode = 'bushidoAuto';
        S.bushido = { flipped };
        later(() => {
            passCode();
            drawPhase();
        }, 3000);
    }
    render();
}

function passCode() {
    const to = leftNeighbour();
    const i = meP().perm.indexOf('code_du_bushido');
    if (i >= 0) meP().perm.splice(i, 1);
    S.players[to].perm.push('code_du_bushido');
    S.bushido = null;
    floatText(to, 'Code du Bushido', 'f-parry');
    log('action', `Le Code du Bushido passe à ${S.players[to].name}.`);
    toast('info', `Le Code du Bushido passe à ${S.players[to].name}.`);
}

function bushidoPass() {
    const pick = S.bushido.pick;
    commit(() => {
        removeCard(pick);
        log('action', 'Vous défaussez une arme pour le Code du Bushido.');
        sync();
        passCode();
        drawPhase();
    }, 'bushido');
}

function bushidoPay() {
    commit(() => {
        const i = meP().perm.indexOf('code_du_bushido');
        if (i >= 0) meP().perm.splice(i, 1);
        S.discard.push('code_du_bushido');
        S.bushido = null;
        if (bushidoFree()) {
            log('important', 'Vous défaussez le Code du Bushido (le Shogun ne perd pas d\'honneur à 3 joueurs).');
        } else {
            meP().honor -= 1;
            floatText(S.me, '−1 honneur', 'f-honor');
            log('important', 'Vous perdez 1 point d\'honneur et défaussez le Code du Bushido.');
            toast('important', 'Vous perdez 1 point d\'honneur : le Code du Bushido est défaussé.');
        }
        checkEnd('Un joueur a atteint 0 point d\'honneur.');
        if (S.ended) S.mode = 'idle';
        else drawPhase();
    }, 'bushido');
}

function deckExhausted() {
    S.deckN = S.discard.length + 18;
    S.discard = [];
    S.players.forEach((p, i) => {
        p.honor = Math.max(0, p.honor - 1);
        later(() => floatText(i, '−1 honneur', 'f-honor'), 80 * i);
    });
    log('important', 'La pioche est épuisée : la défausse est remélangée et chaque joueur perd 1 point d\'honneur.');
    S.banner = { kind: 'important', text: 'Pioche épuisée : la défausse est remélangée pour reconstituer la pioche. Chaque joueur perd 1 point d\'honneur.' };
    checkEnd('Takeshi a atteint 0 point d\'honneur à cause du renouvellement de la pioche.', true);
    if (S.ended) S.banner.btn = { a: 'results', label: 'Voir les résultats' };
    render();
}

function checkEnd(reason, manual) {
    if (S.ended) return;
    if (S.players.some(p => p.honor <= 0)) {
        S.ended = buildResults(S, reason);
        if (!manual) later(() => { S.overlay = 'results'; render(); }, 1600);
    }
}

function buildResults(s, reason) {
    const n = s.players.length;
    const hasDaimyo = s.hand.includes('daimyo');
    const rows = s.players.map((p, i) => {
        const m = MULT[p.role][n];
        const mult = typeof m === 'number' ? m : 1;
        const bonus = i === s.me && hasDaimyo && p.role !== 'ronin' ? 1 : 0;
        return { p, mult, bonus, score: p.honor * mult + bonus };
    });
    const camps = {};
    rows.forEach(r => {
        const camp = ROLES[r.p.role].camp;
        camps[camp] = camps[camp] || { camp, total: 0 };
        camps[camp].total += r.score;
    });
    const list = Object.values(camps).sort((a, b) => b.total - a.total);
    return { reason, rows, camps: list, tie: list.length > 1 && list[0].total === list[1].total };
}

// ---------- Rendu ----------

const hpHTML = p => `<span class="stat hp" title="Points de vie"><i aria-hidden="true">♥</i><b>${p.hp}</b><small>/${Engine.maxHp(p)}</small><span class="sr"> points de vie</span></span>`;
const honorHTML = p => `<span class="stat honor" title="Points d'honneur"><i class="seal" aria-hidden="true">誉</i><b>${p.honor}</b><span class="sr"> points d'honneur</span></span>`;

function portrait(p, big) {
    const h = [...p.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0);
    return `<span class="portrait${big ? ' big' : ''}" style="--h:${h}" aria-hidden="true">${esc(CHARACTERS[p.char].name[0])}</span>`;
}

function mini(id) {
    const c = CARDS[id];
    return `<span class="mini cat-${c.cat}" tabindex="0" role="img" aria-label="${esc(c.n)} (permanente) : ${esc(c.fx)}" title="${esc(c.n)} — ${esc(c.fx)}"><b>${c.k}</b><em>${esc(c.n)}</em></span>`;
}

function cardHTML(id, i, opt = {}) {
    const c = CARDS[id];
    const cls = ['card', `cat-${c.cat}`];
    if (opt.selected) cls.push('selected');
    if (opt.off) cls.push('unplayable');
    if (opt.pick) cls.push('pick');
    if (opt.react) cls.push('react-ok');
    const stats = c.cat === 'arme' ? `<span class="c-stats"><b>Préc. ${c.prec}</b><b>Dég. ${c.dmg}</b></span>` : '';
    const st = opt.selected ? 'sélectionnée' : opt.off ? 'non jouable' : opt.react ? 'utilisable comme parade' : 'jouable';
    return `<button type="button" class="${cls.join(' ')}" data-a="card" data-i="${i}" style="--i:${i}" aria-pressed="${Boolean(opt.selected || opt.pick)}" aria-label="${esc(c.n)}, ${CAT_LABEL[c.cat]}, ${st}">
        <span class="c-cat">${CAT_LABEL[c.cat]}</span><span class="c-art" aria-hidden="true">${c.k}</span><span class="c-name">${esc(c.n)}</span>${stats}
    </button>`;
}

function seatHTML(i, k, n) {
    const p = S.players[i];
    const down = Engine.downReason(p);
    const a = ((90 + (360 * k) / n) * Math.PI) / 180;
    const x = 50 + RX * Math.cos(a);
    const y = 50 + RY * Math.sin(a);
    const T = currentTargets()[i];
    const cls = ['seat'];
    if (i === S.active) cls.push('is-active');
    if (p.shogun) cls.push('is-shogun');
    if (down) cls.push('is-down');
    if (!p.connected) cls.push('is-offline');
    if (T) cls.push(T.ok ? 'targetable' : 'untargetable');
    if (S.target === i) cls.push('is-target');
    if (S.mode === 'reaction' && S.reaction.att === i) cls.push('is-attacker');
    if (S.pending && S.pending.target === i) cls.push('is-target');
    const flag = T ? `<span class="seat-flag ${T.ok ? 'ok' : 'no'}">${T.ok ? '◎' : '⊘'} ${esc(T.short)}</span>`
        : down ? `<span class="seat-flag down">${esc(down)}</span>` : '';
    const perms = p.perm.length ? `<span class="seat-perms">${p.perm.map(mini).join('')}</span>` : '';
    const shogun = p.shogun ? '<span class="tag tag-shogun">Shogun</span>' : '';
    const active = i === S.active ? '<span class="tag tag-turn">Son tour</span>' : '';
    const label = `${p.name}, ${CHARACTERS[p.char].name}${p.shogun ? ', Shogun' : ''}, ${p.hp} points de vie, ${p.honor} points d'honneur, ${p.hand} cartes en main${down ? ', ' + down : ''}`;
    return `<div class="${cls.join(' ')}" style="--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%" data-a="seat" data-i="${i}" data-seat="${i}" role="button" tabindex="0" aria-label="${esc(label)}">
        ${portrait(p)}
        <span class="seat-body">
            <span class="seat-name">${esc(p.name)}${shogun}${active}</span>
            <span class="seat-char">${esc(CHARACTERS[p.char].name)}</span>
            <span class="seat-stats">${hpHTML(p)}${honorHTML(p)}<span class="stat hand" title="Cartes en main"><i aria-hidden="true">🂠</i><b>${p.hand}</b><span class="sr"> cartes en main</span></span></span>
        </span>
        ${perms}${flag}
        ${!p.connected ? '<span class="seat-flag off">Déconnecté</span>' : ''}
    </div>`;
}

function pilesHTML() {
    const top = S.discard.length ? CARDS[S.discard[S.discard.length - 1]] : null;
    return `<div class="piles">
        <div class="pile"><span class="pile-back" aria-hidden="true">刀</span><span class="pile-label">Pioche <b>${S.deckN}</b></span></div>
        <div class="pile"><span class="pile-top ${top ? 'cat-' + top.cat : 'empty'}">${top ? `<i>${top.k}</i><em>${esc(top.n)}</em>` : '<em>Vide</em>'}</span><span class="pile-label">Défausse <b>${S.discard.length}</b></span></div>
    </div>`;
}

function box(kind, kicker, title, body, actions) {
    return `<section class="prompt prompt-${kind}"><p class="kicker">${kicker}</p><h2>${title}</h2>${body || ''}${actions ? `<div class="prompt-actions">${actions}</div>` : ''}</section>`;
}

const btn = (a, label, cls = 'btn', extra = '') => `<button type="button" class="${cls}" data-a="${a}" ${extra}>${label}</button>`;
const parts = list => `<ul class="calc">${list.map(x => `<li><span>${esc(x.label)}</span><b>${x.v > 0 && x !== list[0] ? '+' : ''}${x.v}</b></li>`).join('')}</ul>`;

function promptHTML() {
    const A = S.players[S.active];
    switch (S.mode) {
        case 'sending':
            return box('wait', 'Envoi en cours', 'Transmission au serveur…', '<p>Votre action n\'est pas encore validée. Elle ne sera appliquée qu\'après confirmation.</p>');
        case 'waiting':
            return box('wait', 'En attente', `En attente de la réponse de ${esc(S.players[S.pending.target].name)}…`, `<p>${esc(CARDS[S.discard[S.discard.length - 1]].n)} a été annoncée. ${esc(S.players[S.pending.target].name)} peut parer ou subir l'attaque.</p>`);
        case 'reaction': return reactionHTML();
        case 'bushido': return bushidoHTML();
        case 'bushidoAuto': {
            const f = CARDS[S.bushido.flipped];
            return box('wait', 'Récupération · Code du Bushido', `Carte révélée : ${esc(f.n)}`,
                `<div class="inspect"><div class="bigcard cat-${f.cat}"><span class="c-cat">${CAT_LABEL[f.cat]}</span><span class="c-art">${f.k}</span><span class="c-name">${esc(f.n)}</span></div>
                <div><p>Ce n'est pas une arme : le Code passe automatiquement à <b>${esc(S.players[leftNeighbour()].name)}</b>, votre voisin de gauche.</p><p class="note">Aucune décision à prendre. La carte révélée est défaussée.</p></div></div>`);
        }
        case 'collective': return collectiveHTML();
        case 'discard': {
            const need = S.hand.length - 7;
            const ok = S.picks.length === need;
            return box('turn', 'Phase de défausse', `Défaussez ${plural(need, 'carte', 'cartes')}`,
                `<p>Vous ne pouvez pas terminer votre tour avec plus de 7 cartes en main. Sélectionnez les cartes à défausser.</p><p class="counter" aria-live="polite"><b>${S.picks.length} / ${need}</b> cartes sélectionnées</p>`,
                btn('confirmDiscard', 'Valider la défausse', 'btn btn-primary', ok ? '' : 'disabled'));
        }
        case 'geisha': {
            const t = S.players[S.target];
            const opts = t.perm.map((id, k) => btn('geishaOpt', `Défausser ${esc(CARDS[id].n)} (permanente)`, 'btn', `data-o="p${k}"`));
            if (t.hand > 0) opts.push(btn('geishaOpt', `Une carte au hasard dans sa main (${plural(t.hand, 'carte', 'cartes')})`, 'btn', 'data-o="h"'));
            return box('turn', 'Geisha', `Quel effet sur ${esc(t.name)} ?`, '<p>Vous ne choisissez pas la carte prise dans la main : elle est tirée au hasard.</p>', `${opts.join('')}${btn('cancel', 'Annuler', 'btn btn-ghost')}`);
        }
        case 'preview': return previewHTML();
        case 'targeting': {
            const id = S.hand[S.sel];
            return box('turn', 'Choisissez une cible', `${esc(CARDS[id].n)} — qui visez-vous ?`,
                '<p>Les joueurs marqués ◎ sont à portée. Touchez un joueur marqué ⊘ pour connaître la raison.</p>', btn('cancel', 'Annuler', 'btn btn-ghost'));
        }
    }
    if (S.sel !== null) return inspectorHTML();
    if (S.spectator) return box('wait', 'Spectateur', `Tour de ${esc(A.name)}`, '<p>Vous observez la partie. Vous ne voyez ni les mains ni les rôles cachés, et ne pouvez pas agir.</p>');
    if (myTurn() && S.phase === 'play') {
        const lim = weaponLimit();
        return box('turn', 'À vous de jouer', 'Phase de jeu',
            `<p>Sélectionnez une carte de votre main, ou terminez votre tour. Vous pouvez ne rien jouer.</p>
            <details class="why"><summary>Armes jouables ce tour : <b>${S.played} / ${lim.total}</b></summary>${parts(lim.parts)}</details>`);
    }
    if (myTurn()) return box('wait', 'Votre tour', 'Phase automatique…', '<p>Cette étape se résout sans action de votre part.</p>');
    return box('wait', 'En attente', `Tour de ${esc(A.name)}${A.shogun ? ' (Shogun)' : ''}`,
        '<p>Vous pouvez consulter le plateau et votre main. Si vous êtes attaqué, une fenêtre de réaction s\'affichera ici.</p>');
}

function inspectorHTML() {
    const id = S.hand[S.sel];
    const c = CARDS[id];
    const pl = Engine.playability(ctx(), id);
    const stats = c.cat === 'arme' ? `<p class="statline">Précision <b>${c.prec}</b> · Dégâts <b>${c.dmg}</b></p>` : '';
    const body = `<div class="inspect"><div class="bigcard cat-${c.cat}"><span class="c-cat">${CAT_LABEL[c.cat]}</span><span class="c-art">${c.k}</span><span class="c-name">${esc(c.n)}</span></div>
        <div><p class="statline">${CAT_LABEL[c.cat]}</p>${stats}<p>${esc(c.fx)}</p>
        ${pl.ok ? '' : `<p class="reason"><b>Non jouable maintenant :</b> ${esc(pl.reason)}</p>`}</div></div>`;
    const play = pl.ok && c.cat !== 'arme' && id !== 'geisha' ? btn('playCard', c.cat === 'permanente' ? 'Poser devant moi' : 'Jouer cette carte', 'btn btn-primary') : '';
    return box(pl.ok ? 'turn' : 'wait', 'Carte sélectionnée', esc(c.n), body, `${play}${btn('cancel', 'Désélectionner', 'btn btn-ghost')}`);
}

function previewHTML() {
    const id = S.hand[S.sel];
    const t = S.players[S.target];
    const diff = Engine.difficulty(S.players, S.me, S.target);
    const dm = Engine.damage(S.players, S.me, S.target, id);
    const body = `<div class="preview">
        <div><h3>Difficulté ${diff.ignored ? '—' : diff.total} <small>(précision ${CARDS[id].prec})</small></h3>${diff.ignored ? '<p>Kojirō ignore la difficulté.</p>' : parts(diff.parts)}</div>
        <div><h3>Dégâts potentiels ${dm.total}</h3>${parts(dm.parts)}</div></div>
        <p class="note">Dégâts potentiels : ${esc(t.name)} peut encore se défendre (${t.hp} PV → ${Math.max(0, t.hp - dm.total)} PV sans parade).</p>`;
    return box('turn', 'Confirmer l\'attaque', `${esc(CARDS[id].n)} → ${esc(t.name)}`, body,
        `${btn('confirmAttack', 'Confirmer l\'attaque', 'btn btn-primary')}${btn('changeTarget', 'Changer de cible', 'btn btn-ghost')}`);
}

function bushidoHTML() {
    const b = S.bushido;
    const f = CARDS[b.flipped];
    const neighbour = S.players[leftNeighbour()].name;
    const weapons = S.hand.filter(id => CARDS[id].cat === 'arme').length;
    const free = bushidoFree();
    const body = `<div class="inspect"><div class="bigcard cat-arme"><span class="c-cat">Arme</span><span class="c-art">${f.k}</span><span class="c-name">${esc(f.n)}</span></div>
        <div><p>La carte révélée est une <b>arme</b> (défaussée). Vous devez choisir :</p>
        <ol class="choices"><li><b>A.</b> Défausser 1 arme de votre main et passer le Code à ${esc(neighbour)}.</li>
        <li><b>B.</b> ${free ? 'Défausser le Code (le Shogun ne perd pas d\'honneur à 3 joueurs).' : `Perdre 1 point d'honneur (${meP().honor} → ${meP().honor - 1}) et défausser le Code.`}</li></ol>
        ${weapons ? '<p class="note">Option A : sélectionnez une arme dans votre main.</p>' : '<p class="reason"><b>Option A indisponible :</b> vous n\'avez aucune arme en main.</p>'}</div></div>`;
    const act = `${weapons && b.pick !== null ? btn('bushidoPass', `A · Défausser l'arme et passer le Code à ${esc(neighbour)}`, 'btn btn-primary') : ''}${btn('bushidoPay', free ? 'B · Défausser le Code' : 'B · Perdre 1 point d\'honneur', 'btn btn-ghost')}`;
    return box('turn', 'Récupération · Code du Bushido', 'Une décision est attendue', body, act);
}

function reactionHTML() {
    const r = S.reaction;
    const att = S.players[r.att];
    const dm = Engine.damage(S.players, r.att, S.me, r.weapon);
    const hasParry = S.hand.some(isParry);
    const body = `<div class="inspect"><div class="bigcard cat-arme"><span class="c-cat">Arme</span><span class="c-art">${CARDS[r.weapon].k}</span><span class="c-name">${esc(CARDS[r.weapon].n)}</span></div>
        <div><p><b>${esc(att.name)}</b> vous attaque avec ${esc(CARDS[r.weapon].n)}.</p><p class="statline">Dégâts potentiels <b>${dm.total}</b> · PV ${meP().hp} → ${Math.max(0, meP().hp - dm.total)}</p>${parts(dm.parts)}</div></div>
        <p>${hasParry ? 'Sélectionnez une Parade dans votre main (cartes éclairées), puis confirmez.' : 'Vous n\'avez aucune parade utilisable.'}</p>`;
    const act = `${r.pick !== null ? btn('parry', 'Parer avec la carte sélectionnée', 'btn btn-primary') : ''}${btn('takeHit', `Ne pas parer (−${dm.total} PV)`, 'btn btn-ghost')}`;
    return box('react', 'Réaction requise · hors tour', 'Vous êtes attaqué·e !', body, act);
}

function collectiveHTML() {
    const col = S.collective;
    const mine = collectiveMine();
    const icon = { pending: '…', done: '✓', exempt: '—' };
    const lbl = { pending: 'Réponse attendue', done: 'A répondu', exempt: 'Non concerné' };
    const rows = col.rows.map(r => `<li class="st-${r.status}${r.idx === S.me ? ' me' : ''}"><span aria-hidden="true">${icon[r.status]}</span><b>${esc(S.players[r.idx].name)}${r.idx === S.me ? ' (vous)' : ''}</b><span>${r.status === 'pending' ? lbl.pending : esc(r.text || lbl[r.status])}</span></li>`).join('');
    const hasParry = S.hand.some(isParry);
    const act = mine ? `${col.pick !== null ? btn('collPick', 'Défausser la Parade sélectionnée', 'btn btn-primary') : ''}${btn('collLose', 'Perdre 1 PV', 'btn btn-ghost')}` : '';
    const intro = mine ? `<p><b>À vous de répondre :</b> ${hasParry ? 'sélectionnez une Parade à défausser, ou perdez 1 PV.' : 'perdez 1 PV (aucune Parade en main).'}</p>` : '<p>Vous avez répondu. En attente des autres joueurs.</p>';
    return box(mine ? 'react' : 'wait', 'Réaction collective', `${esc(S.players[col.issuer].name)} joue Cri de guerre`, `${intro}<ul class="responders">${rows}</ul><p class="note">Les réponses ne révèlent jamais le contenu des mains.</p>`, act);
}

function phaseHTML() {
    const steps = [['recover', 'Récupération'], ['draw', 'Pioche'], ['play', 'Jeu'], ['discard', 'Défausse']];
    const cur = steps.findIndex(s => s[0] === S.phase);
    return `<ol class="phases" aria-label="Phases du tour">${steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}" ${i === cur ? 'aria-current="step"' : ''}><span>${i + 1}</span>${s[1]}</li>`).join('')}</ol>`;
}

function dockHTML() {
    if (S.spectator) {
        return `<section class="dock spectator"><p><b>Mode spectateur</b> — vous voyez les informations publiques uniquement. Aucun rôle caché, aucune main, aucune action.</p></section>`;
    }
    const p = meP();
    const down = Engine.downReason(p);
    const role = ROLES[p.role];
    const need = S.hand.length - 7;
    const react = S.mode === 'reaction' || (S.mode === 'collective' && collectiveMine());
    const hand = S.hand.map((id, i) => {
        const o = {};
        if (S.mode === 'discard') o.pick = S.picks.includes(i);
        else if (S.mode === 'bushido') {
            o.react = CARDS[id].cat === 'arme';
            o.off = !o.react;
            o.pick = S.bushido.pick === i;
        } else if (S.mode === 'reaction' || S.mode === 'collective') {
            o.react = isParry(id);
            o.off = !o.react;
            o.pick = (S.mode === 'reaction' ? S.reaction.pick : S.collective.pick) === i;
        } else {
            o.selected = S.sel === i;
            o.off = !Engine.playability(ctx(), id).ok;
        }
        return cardHTML(id, i, o);
    }).join('');
    const canEnd = myTurn() && S.phase === 'play' && S.mode === 'idle';
    const lim = weaponLimit();
    const endLabel = S.hand.length > 7 ? `Terminer mon tour (défausse : ${need})` : 'Terminer mon tour';
    return `<section class="dock${down ? ' is-down' : ''}${react ? ' is-defending' : ''}${myTurn() ? ' is-mine' : ''}" data-seat="${S.me}" aria-label="Votre zone de jeu">
        <div class="me">
            ${portrait(p, true)}
            <div class="me-id">
                <p class="me-name">${esc(p.name)} <span class="muted">(vous)</span>${p.shogun ? '<span class="tag tag-shogun">Shogun</span>' : ''}</p>
                <p class="me-char"><b>${esc(CHARACTERS[p.char].name)}</b> — <span class="ability">${esc(CHARACTERS[p.char].ability)}</span></p>
                <div class="me-stats">${hpHTML(p)}${honorHTML(p)}</div>
                ${down ? `<p class="seat-flag down">${esc(down)}</p>` : ''}
            </div>
            <div class="me-role">
                <button type="button" class="rolechip" data-a="role" aria-pressed="${UI.roleShown}" title="Visible par vous seul : se masque automatiquement">
                    <span class="eye" aria-hidden="true">${UI.roleShown ? '◉' : '◎'}</span>
                    ${UI.roleShown ? `Rôle secret : <b>${role.name}</b>` : 'Rôle secret masqué — afficher'}
                </button>
                ${UI.roleShown ? `<small>${role.camp}. ${role.goal}</small>` : '<small>Privé : jamais visible des autres joueurs.</small>'}
            </div>
        </div>
        <div class="me-perms" aria-label="Vos permanentes"><span class="zone-title">Permanentes</span>${p.perm.length ? p.perm.map(mini).join('') : '<em class="muted">Aucune</em>'}</div>
        <div class="handwrap"><div class="hand n-${Math.min(S.hand.length, 12)}" role="group" aria-label="Votre main, ${plural(S.hand.length, 'carte', 'cartes')}" style="--n:${S.hand.length}">${hand || '<em class="muted">Main vide</em>'}</div></div>
        <div class="me-actions">
            <p class="wcount" title="Armes jouées / autorisées ce tour">Armes <b>${S.played}/${lim.total}</b></p>
            ${btn('endTurn', endLabel, 'btn btn-primary btn-big', canEnd ? '' : 'disabled')}
            ${!canEnd && myTurn() && S.phase === 'play' ? '<small>Terminez d\'abord l\'action en cours.</small>' : ''}
        </div>
    </section>`;
}

function sideHTML() {
    const tabs = [['log', 'Journal'], ['chat', 'Chat'], ['help', 'Aide']];
    let body = '';
    if (UI.side === 'log') {
        body = `<ol class="log" aria-label="Journal des événements">${S.log.map(l => `<li class="l-${l.k}"><span class="lk">${{ info: 'Info', action: 'Action', warn: 'Attention', important: 'Important' }[l.k]}</span>${esc(l.t)}</li>`).join('')}</ol>`;
    } else if (UI.side === 'chat') {
        body = `<div class="chat"><p class="note">Bluffez sur les rôles, mais ne dévoilez pas votre main et ne demandez pas aux autres l'effet d'une carte sur eux.</p>
            <ul id="chatList"><li><b>Kenji</b> On reste soudés, non ?</li><li><b>Sayuri</b> Je ne dirai rien.</li></ul>
            <form id="chatForm"><label class="sr" for="chatInput">Message</label><input id="chatInput" maxlength="140" placeholder="Message…" value="${esc(UI.draft)}"><button class="btn btn-small">Envoyer</button></form></div>`;
    } else {
        body = helpHTML();
    }
    return `<aside class="side${UI.sideOpen ? ' open' : ''}" aria-label="Panneau latéral">
        <div class="tabs" role="tablist">${tabs.map(t => `<button role="tab" aria-selected="${UI.side === t[0]}" data-a="tab" data-t="${t[0]}">${t[1]}</button>`).join('')}<button class="close-side" data-a="toggleSide" aria-label="Fermer le panneau">✕</button></div>
        <div class="tabbody">${body}</div></aside>`;
}

function helpHTML() {
    const w = S.hand.find(id => CARDS[id].cat === 'arme');
    let why = '<p>Aucune arme en main : rien à évaluer.</p>';
    if (w && S.me >= 0) {
        why = `<p>Avec ${esc(CARDS[w].n)} (précision ${CARDS[w].prec}) :</p><ul>${Engine.weaponTargets(S.players, S.me, w).map(t => `<li><b>${esc(S.players[t.idx].name)}</b> : ${t.ok ? 'attaquable' : esc(t.reason)}</li>`).join('')}</ul>`;
    }
    const draw = S.me >= 0 ? Engine.drawCount(S.players, S.me, S.three) : null;
    const lim = S.me >= 0 ? weaponLimit() : null;
    return `<div class="help">
        <details open><summary>Pourquoi ne puis-je pas attaquer ce joueur ?</summary>${why}</details>
        <details><summary>Que signifie être « à terre » ?</summary><p>0 PV ou aucune carte en main. Le joueur n'est pas éliminé : il ne peut pas être ciblé par une arme, ne compte plus dans les distances et revient en jeu dès que ses conditions sont réunies.</p></details>
        ${draw ? `<details><summary>Combien de cartes pioche-je ?</summary>${parts(draw.parts)}<p>Total : ${draw.total}</p></details>` : ''}
        ${lim ? `<details><summary>Combien d'armes puis-je jouer ?</summary>${parts(lim.parts)}<p>Total : ${lim.total}</p></details>` : ''}
        <details><summary>Comment sont comptés les points d'honneur ?</summary><p>Honneur de base × multiplicateur du rôle, plus 1 par Daimyō gardé en main (non multiplié, rien pour le Ronin). Le détail complet est affiché en fin de partie.</p></details>
        <details><summary>PV ou honneur ?</summary><p>Les PV (cœurs ♥ rouges) sont votre santé. L'honneur (sceaux dorés 誉) détermine la victoire. Ce sont deux ressources distinctes.</p></details></div>`;
}

function sheetHTML() {
    if (UI.sheet === null) return '';
    const p = S.players[UI.sheet];
    const down = Engine.downReason(p);
    return `<div class="sheet-back" data-a="sheetClose"><section class="sheet" role="dialog" aria-label="Détail de ${esc(p.name)}" data-a="noop">
        <header>${portrait(p, true)}<div><h2>${esc(p.name)}${p.shogun ? ' <span class="tag tag-shogun">Shogun</span>' : ''}</h2><p>${esc(CHARACTERS[p.char].name)}</p></div><button class="x" data-a="sheetClose" aria-label="Fermer">✕</button></header>
        <p class="ability">${esc(CHARACTERS[p.char].ability)}</p>
        <div class="me-stats">${hpHTML(p)}${honorHTML(p)}<span class="stat hand"><b>${p.hand}</b> cartes en main</span></div>
        ${down ? `<p class="seat-flag down">${esc(down)} — pas éliminé·e : peut revenir en jeu.</p>` : ''}
        <h3>Permanentes</h3>${p.perm.length ? p.perm.map(id => `<p class="perm-line">${mini(id)} ${esc(CARDS[id].fx)}</p>`).join('') : '<p class="muted">Aucune permanente en jeu.</p>'}
        ${p.shogun && S.three ? '<h3>Règles à 3 joueurs</h3><p>Pioche 3 cartes, +1 arme par tour, honneur doublé au décompte.</p>' : ''}
    </section></div>`;
}

function overlayHTML() {
    if (S.overlay === 'reconnect') {
        return `<div class="overlay" role="alertdialog" aria-label="Reconnexion"><div class="overlay-box"><span class="spinner" aria-hidden="true"></span><h2>Connexion perdue</h2><p>Reconnexion en cours… (tentative 2). Votre partie est conservée ; votre place est réservée.</p></div></div>`;
    }
    if (S.overlay === 'results' && S.ended) {
        const r = S.ended;
        const n = S.players.length;
        const win = r.camps[0];
        const rowsHTML = r.rows.map(x => `<tr><th scope="row">${esc(x.p.name)}${x.p.shogun ? ' <span class="tag tag-shogun">Shogun</span>' : ''}</th><td>${esc(CHARACTERS[x.p.char].name)}</td><td>${ROLES[x.p.role].name}</td><td>${x.p.honor}</td><td>×${x.mult}</td><td>${x.bonus ? '+' + x.bonus + ' Daimyō' : '—'}</td><td><b>${x.score}</b></td></tr>`).join('');
        return `<div class="overlay results" role="dialog" aria-label="Résultats de la partie"><div class="overlay-box wide">
            <p class="kicker">Fin de partie</p><h2>${r.tie ? 'Égalité entre camps' : `Victoire : ${win.camp}`}</h2>
            <p>${esc(r.reason)} Les rôles sont maintenant révélés.</p>
            <div class="tablewrap"><table><thead><tr><th>Joueur</th><th>Personnage</th><th>Rôle</th><th>Honneur</th><th>Mult. (${n} j.)</th><th>Bonus</th><th>Score</th></tr></thead><tbody>${rowsHTML}</tbody></table></div>
            <ul class="camps">${r.camps.map((c, i) => `<li class="${i === 0 ? 'win' : ''}"><span>${c.camp}</span><b>${c.total}</b></li>`).join('')}</ul>
            <p class="note">${r.tie ? 'Égalité : la règle de départage n\'est pas définie dans cette spécification — à confirmer avec le livret officiel. ' : ''}Non simulés ici : Lame perdue, victoire au fil de l'épée, étoiles des Ninjas à 4 joueurs.</p>
            <div class="prompt-actions">${btn('again', 'Nouvelle partie', 'btn btn-primary')}${btn('closeOverlay', 'Revoir le plateau', 'btn btn-ghost')}</div></div></div>`;
    }
    return '';
}

const NET = { online: 'En ligne', pending: 'Envoi en cours…', confirmed: 'Confirmé par le serveur', rejected: 'Action refusée', reconnecting: 'Reconnexion…' };

function render() {
    const focus = document.activeElement;
    const fkey = focus && focus.dataset && focus.dataset.a ? `[data-a="${focus.dataset.a}"]${focus.dataset.i !== undefined ? `[data-i="${focus.dataset.i}"]` : ''}${focus.dataset.t ? `[data-t="${focus.dataset.t}"]` : ''}` : null;
    const scroll = $('.hand') ? $('.hand').parentElement.scrollLeft : 0;
    const boardTop = $('.board') ? $('.board').scrollTop : 0;
    sync();

    const n = S.players.length;
    const order = S.players.map((p, i) => i).filter(i => i !== S.me);
    const seats = order.map((i, idx) => seatHTML(i, S.me >= 0 ? idx + 1 : idx, n)).join('');
    const A = S.players[S.active];
    const banner = S.banner ? `<div class="banner banner-${S.banner.kind}" role="alert"><span>${esc(S.banner.text)}</span>${S.banner.btn ? btn(S.banner.btn.a, S.banner.btn.label, 'btn btn-small') : btn('dismiss', 'OK', 'btn btn-small btn-ghost')}</div>` : '';

    $('#app').className = `app${S.mode === 'reaction' ? ' alert-react' : ''}${['reaction', 'discard', 'bushido'].includes(S.mode) || (S.mode === 'collective' && collectiveMine()) ? ' focus-hand' : ''}`;
    $('#app').innerHTML = `
        <header class="topbar">
            <div class="brand">KATANA <small>${n} joueurs · tour 5</small></div>
            <div class="turn"><span class="turn-who">${myTurn() ? '<b>À vous</b> de jouer' : `Tour de <b>${esc(A.name)}</b>`}</span>${phaseHTML()}</div>
            <div class="top-right"><span class="net net-${S.net}" role="status"><i aria-hidden="true"></i>${NET[S.net]}</span>
                <button class="btn btn-small btn-ghost" data-a="toggleSide" aria-label="Journal, chat et aide">☰ Journal</button>
                <button class="btn btn-small btn-ghost" data-a="reduce" aria-pressed="${UI.reduce}">Animations : ${UI.reduce ? 'réduites' : 'normales'}</button></div>
        </header>
        <main class="board">
            <div class="arena">
                <section class="table" aria-label="Table de jeu">${seats}</section>
                <div class="center${S.mode !== 'idle' || S.sel !== null ? ' busy' : ''}">${banner}${pilesHTML()}${promptHTML()}</div>
            </div>
            ${dockHTML()}
        </main>
        ${sideHTML()}${sheetHTML()}${overlayHTML()}`;

    if (fkey) {
        const f = $(fkey);
        if (f) f.focus({ preventScroll: true });
    }
    const hw = $('.handwrap');
    if (hw) hw.scrollLeft = scroll;
    if ($('.board')) $('.board').scrollTop = boardTop;
}

// ---------- Événements ----------

const ACTIONS = {
    card: d => selectCard(+d.i),
    seat: d => clickSeat(+d.i),
    cancel: () => { clearSel(); render(); },
    changeTarget: () => { S.target = null; S.mode = 'targeting'; render(); },
    confirmAttack,
    playCard: playGeneric,
    endTurn,
    confirmDiscard,
    parry: () => reactionRespond(true),
    bushidoPass,
    bushidoPay,
    takeHit: () => reactionRespond(false),
    collPick: () => collectiveRespond(false),
    collLose: () => collectiveRespond(true),
    geishaOpt: d => {
        const t = S.players[S.target];
        const sel = S.sel;
        commit(() => {
            removeCard(sel);
            if (d.o === 'h') {
                t.hand = Math.max(0, t.hand - 1);
                log('action', `Vous défaussez une carte au hasard dans la main de ${t.name} (Geisha).`);
                if (t.hand === 0) log('important', `${t.name} n'a plus de carte en main : à terre.`);
            } else {
                const id = t.perm.splice(+d.o.slice(1), 1)[0];
                log('action', `Vous défaussez ${CARDS[id].n} devant ${t.name} (Geisha).`);
            }
            clearSel();
            S.mode = 'idle';
            sync();
        }, 'geisha');
    },
    tab: d => { UI.side = d.t; render(); },
    toggleSide: () => { UI.sideOpen = !UI.sideOpen; render(); },
    sheetClose: () => { UI.sheet = null; render(); },
    noop: () => {},
    role: () => {
        UI.roleShown = !UI.roleShown;
        clearTimeout(roleTimer);
        if (UI.roleShown) roleTimer = setTimeout(() => { UI.roleShown = false; render(); }, 5000);
        render();
    },
    reduce: () => { UI.reduce = !UI.reduce; document.body.classList.toggle('reduce-motion', UI.reduce); render(); },
    dismiss: () => { S.banner = null; render(); },
    results: () => { S.banner = null; S.overlay = 'results'; render(); },
    closeOverlay: () => { S.overlay = null; render(); },
    again: () => start('attack')
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    if (el.dataset.a === 'sheetClose' && el.classList.contains('sheet-back') && e.target !== el) return;
    const fn = ACTIONS[el.dataset.a];
    if (fn) fn(el.dataset);
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (UI.sheet !== null) { UI.sheet = null; return render(); }
        if (S.sel !== null && ['idle', 'targeting', 'preview', 'geisha'].includes(S.mode)) { clearSel(); return render(); }
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-a]')) {
        e.preventDefault();
        e.target.click();
    }
});

document.addEventListener('input', e => {
    if (e.target.id === 'chatInput') UI.draft = e.target.value;
});

document.addEventListener('submit', e => {
    if (e.target.id !== 'chatForm') return;
    e.preventDefault();
    const text = UI.draft.trim();
    if (!text) return;
    const li = document.createElement('li');
    const who = document.createElement('b');
    who.textContent = meP() ? meP().name : 'Spectateur';
    li.append(who, ` ${text}`);
    $('#chatList').append(li);
    UI.draft = '';
    $('#chatInput').value = '';
});

// Barre de simulation
function applyDevice(v) {
    const f = $('#deviceFrame');
    f.className = 'device';
    f.style.cssText = '';
    if (v !== 'desktop') {
        const dims = { 1366: [1366, 768], 1024: [1024, 768], 390: [390, 844], 360: [360, 780] }[v];
        f.classList.add('framed');
        f.style.width = `${dims[0]}px`;
        f.style.height = `${dims[1]}px`;
    }
    if (S) render();
}

$('#scenario').addEventListener('change', e => start(e.target.value));
$('#device').addEventListener('change', e => applyDevice(e.target.value));
$('#simDefender').addEventListener('change', e => (SIM.defender = e.target.value));
$('#simReject').addEventListener('change', e => (SIM.reject = e.target.checked));
$('#resetBtn').addEventListener('click', () => start($('#scenario').value));

start('attack');
