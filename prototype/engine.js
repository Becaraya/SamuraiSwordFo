'use strict';
/* Règles calculées (pures, sans DOM) : en production, ces fonctions vivent côté serveur ; l'UI ne fait qu'afficher leur résultat. */

const Engine = {
    maxHp: p => CHARACTERS[p.char].pv,

    downReason(p) {
        if (p.hp <= 0) return 'À terre : 0 PV';
        if (p.hand <= 0) return 'À terre : aucune carte en main';
        return null;
    },

    // Les joueurs à terre ne comptent plus comme intermédiaires (l'attaquant reste dans l'anneau).
    ring(players, a) {
        return players.map((p, i) => i).filter(i => i === a || !Engine.downReason(players[i]));
    },

    distance(players, a, t) {
        const ring = Engine.ring(players, a);
        const ia = ring.indexOf(a);
        const it = ring.indexOf(t);
        if (it < 0) return null;
        const d = Math.abs(ia - it);
        return Math.min(d, ring.length - d);
    },

    difficulty(players, a, t) {
        const att = players[a];
        const tgt = players[t];
        const base = Engine.distance(players, a, t);
        const parts = [{ label: `Distance autour de la table`, v: base }];
        if (att.char === 'kojiro') return { parts, total: base, ignored: true };

        const armor = tgt.perm.filter(c => c === 'armure').length;
        if (armor) parts.push({ label: `Armure de ${tgt.name}${armor > 1 ? ` ×${armor}` : ''}`, v: armor });
        if (tgt.char === 'benkei') parts.push({ label: 'Benkei (capacité)', v: 1 });
        return { parts, total: parts.reduce((s, x) => s + x.v, 0), ignored: false };
    },

    damage(players, a, t, weaponId) {
        const att = players[a];
        const parts = [{ label: CARDS[weaponId].n, v: CARDS[weaponId].dmg }];
        if (att.char === 'musashi') parts.push({ label: 'Musashi (capacité)', v: 1 });
        const quick = att.perm.filter(c => c === 'attaque_rapide').length;
        if (quick) parts.push({ label: `Attaque rapide${quick > 1 ? ` ×${quick}` : ''}`, v: quick });
        if (players[t].char === 'ginchiyo') parts.push({ label: 'Ginchiyo (réduction)', v: -1 });
        const total = Math.max(1, parts.reduce((s, x) => s + x.v, 0));
        return { parts, total };
    },

    weaponLimit(players, i, threePlayers) {
        const p = players[i];
        const parts = [{ label: 'Base', v: 1 }];
        if (p.char === 'goemon') parts.push({ label: 'Goemon (capacité)', v: 1 });
        const conc = p.perm.filter(c => c === 'concentration').length;
        if (conc) parts.push({ label: `Concentration${conc > 1 ? ` ×${conc}` : ''}`, v: conc });
        if (threePlayers && p.shogun) parts.push({ label: 'Shogun à 3 joueurs', v: 1 });
        return { parts, total: parts.reduce((s, x) => s + x.v, 0) };
    },

    drawCount(players, i, threePlayers) {
        const p = players[i];
        const parts = [{ label: 'Base', v: 2 }];
        if (p.char === 'hideyoshi') parts.push({ label: 'Hideyoshi (capacité)', v: 1 });
        if (threePlayers && p.shogun) parts.push({ label: 'Shogun à 3 joueurs', v: 1 });
        return { parts, total: parts.reduce((s, x) => s + x.v, 0) };
    },

    // Évalue toutes les cibles possibles d'une arme : { idx, ok, reason, diff }
    weaponTargets(players, a, weaponId) {
        const w = CARDS[weaponId];
        return players.map((p, idx) => {
            if (idx === a) return null;
            const down = Engine.downReason(p);
            if (down) return { idx, ok: false, reason: `${down.replace('À terre : ', 'À terre — ')} : ne peut pas être ciblé par une arme.` };
            const diff = Engine.difficulty(players, a, idx);
            if (!diff.ignored && diff.total > w.prec) {
                return { idx, ok: false, diff, reason: `Précision insuffisante : difficulté ${diff.total}, précision de ${w.n} ${w.prec}.` };
            }
            return { idx, ok: true, diff };
        }).filter(Boolean);
    },

    // ctx : { players, me, myTurn, phase, played, limit, hand }
    playability(ctx, cardId) {
        const c = CARDS[cardId];
        if (cardId === 'parade') {
            return { ok: false, reason: "Une Parade se joue en réaction à une attaque qui vous cible, même hors de votre tour." };
        }
        if (!ctx.myTurn) return { ok: false, reason: "Cette carte n'est jouable que pendant votre tour." };
        if (ctx.phase !== 'play') return { ok: false, reason: 'Les cartes se jouent pendant la phase de jeu.' };
        if (cardId === 'code_du_bushido' && ctx.players.some(p => p.perm.includes(cardId))) {
            return { ok: false, reason: 'Un seul Code du Bushido peut être en jeu à la fois.' };
        }
        if (c.cat === 'arme') {
            if (ctx.played >= ctx.limit) return { ok: false, reason: `Vous avez déjà joué le maximum d'armes ce tour (${ctx.played}/${ctx.limit}).` };
            if (!Engine.weaponTargets(ctx.players, ctx.me, cardId).some(t => t.ok)) {
                return { ok: false, reason: 'Aucune cible valide : toutes les cibles sont à terre ou hors de portée.' };
            }
        }
        return { ok: true };
    }
};
