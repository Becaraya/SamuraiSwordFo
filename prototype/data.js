'use strict';
/* Données simulées du prototype UX. Aucune illustration du jeu original : les visuels sont des placeholders (glyphes). */

const CARDS = {
    katana:         { n: 'Katana',         cat: 'arme',       prec: 2, dmg: 3, k: '刀', fx: 'Attaque un joueur à portée.' },
    bokken:         { n: 'Bokken',         cat: 'arme',       prec: 1, dmg: 1, k: '木', fx: 'Attaque un joueur à portée.' },
    kusarigama:     { n: 'Kusarigama',     cat: 'arme',       prec: 2, dmg: 2, k: '鎌', fx: 'Attaque un joueur à portée.' },
    nodachi:        { n: 'Nodachi',        cat: 'arme',       prec: 3, dmg: 3, k: '太', fx: 'Attaque un joueur à portée.' },
    parade:         { n: 'Parade',         cat: 'action',     k: '防', fx: "Annule une attaque d'arme qui vous prend pour cible. Jouable à tout moment, même en dehors de votre tour." },
    geisha:         { n: 'Geisha',         cat: 'action',     k: '芸', fx: 'Défaussez 1 carte permanente en jeu ou 1 carte au hasard dans la main d\'un autre joueur de votre choix.' },
    cri_de_guerre:  { n: 'Cri de guerre',  cat: 'action',     k: '吼', fx: 'Tous les autres joueurs doivent défausser 1 parade ou perdre 1 point de vie. Les joueurs à terre ne sont pas affectés.' },
    daimyo:         { n: 'Daimyō',         cat: 'action',     k: '大', fx: 'Piochez 2 cartes. Si vous la possédez en main à la fin de la partie, elle rapporte 1 point d\'honneur.' },
    meditation:     { n: 'Méditation',     cat: 'action',     k: '瞑', fx: 'Récupérez tous vos points de vie. Un autre joueur de votre choix pioche 1 carte.' },
    diversion:      { n: 'Diversion',      cat: 'action',     k: '誘', fx: 'Piochez au hasard 1 carte dans la main d\'un joueur de votre choix.' },
    concentration:  { n: 'Concentration',  cat: 'permanente', k: '集', fx: 'Vous pouvez jouer 1 arme de plus par tour par carte Concentration que vous possédez.' },
    armure:         { n: 'Armure',         cat: 'permanente', k: '鎧', fx: 'Les autres joueurs vous attaquent avec une difficulté augmentée de 1. Les bonus se cumulent.' },
    attaque_rapide: { n: 'Attaque rapide', cat: 'permanente', k: '速', fx: 'Vos armes causent 1 dégât supplémentaire par carte Attaque rapide que vous possédez.' },
    code_du_bushido: { n: 'Code du Bushido', cat: 'permanente', k: '武', fx: "Se place devant n'importe quel joueur (un seul en jeu). À la fin de sa phase de récupération, retournez et défaussez la carte du dessus de la pioche. Arme : défaussez 1 arme et passez le Code à votre voisin de gauche, ou perdez 1 point d'honneur et défaussez le Code. Sinon : passez le Code à votre voisin de gauche." }
};

const CAT_LABEL = { arme: 'Arme', action: 'Action', permanente: 'Permanente' };

const CHARACTERS = {
    benkei:    { name: 'Benkei',    pv: 5, ability: 'Les autres joueurs vous attaquent avec une difficulté augmentée de 1.' },
    chiyome:   { name: 'Chiyome',   pv: 4, ability: "Seules les armes peuvent vous faire perdre des PV (Cri de guerre et Ju Jitsu sans effet)." },
    ginchiyo:  { name: 'Ginchiyo',  pv: 4, ability: 'Réduit de 1 les dégâts des armes (minimum 1).' },
    goemon:    { name: 'Goemon',    pv: 5, ability: 'Peut jouer 1 arme supplémentaire par tour.' },
    hanzo:     { name: 'Hanzō',     pv: 4, ability: "Peut jouer ses armes comme des parades (sauf sa dernière carte en main)." },
    hideyoshi: { name: 'Hideyoshi', pv: 4, ability: 'Pioche 1 carte supplémentaire pendant sa phase de pioche.' },
    ieyasu:    { name: 'Ieyasu',    pv: 5, ability: 'Peut prendre la première carte de sa pioche dans la défausse.' },
    kojiro:    { name: 'Kojirō',    pv: 5, ability: 'Ses armes attaquent n\'importe quel joueur sans tenir compte de la difficulté.' },
    musashi:   { name: 'Musashi',   pv: 5, ability: 'Ses armes causent 1 dégât supplémentaire.' },
    nobunaga:  { name: 'Nobunaga',  pv: 5, ability: 'Peut sacrifier 1 PV (sauf son dernier) pour piocher 1 carte.' },
    tomoe:     { name: 'Tomoe',     pv: 5, ability: 'Pioche 1 carte quand une de ses armes blesse un joueur.' },
    ushiwaka:  { name: 'Ushiwaka',  pv: 4, ability: 'Pioche 1 carte par PV perdu à cause d\'une arme.' }
};

const ROLES = {
    shogun:  { name: 'Shogun',   camp: 'Camp du Shogun', goal: 'Éliminer les Ninjas et le Ronin.' },
    samurai: { name: 'Samouraï', camp: 'Camp du Shogun', goal: 'Protéger le Shogun et vaincre les Ninjas et le Ronin.' },
    ninja:   { name: 'Ninja',    camp: 'Camp des Ninjas', goal: 'Vaincre le Shogun avant la fin de la partie.' },
    ronin:   { name: 'Ronin',    camp: 'Camp du Ronin',   goal: 'Rester en vie : vous gagnez seul contre tous.' }
};

// Multiplicateurs de score par nombre de joueurs (null = rôle absent). "etoiles" : voir règle à 4 joueurs.
const MULT = {
    shogun:  { 3: 2, 4: 1, 5: 1, 6: 1, 7: 1 },
    samurai: { 3: null, 4: 2, 5: 1, 6: 2, 7: 1 },
    ninja:   { 3: 1, 4: 'etoiles', 5: 1, 6: 1, 7: 1 },
    ronin:   { 3: null, 4: null, 5: 2, 6: 3, 7: 3 }
};

function players7() {
    const p = (name, char, hp, honor, hand, perm, role, extra) =>
        Object.assign({ name, char, hp, honor, hand, perm, role, connected: true }, extra);
    return [
        p('Aiko',    'goemon',    5, 4, 7, ['concentration'], 'ninja'),
        p('Kenji',   'benkei',    5, 5, 5, ['armure'],        'shogun', { shogun: true }),
        p('Sayuri',  'hanzo',     3, 4, 4, [],                'samurai'),
        p('Ryo',     'chiyome',   4, 4, 3, ['armure'],        'ninja'),
        p('Mizuki',  'hideyoshi', 0, 3, 2, [],                'samurai'),
        p('Takeshi', 'musashi',   5, 5, 6, ['attaque_rapide'], 'ninja'),
        p('Haruka',  'ushiwaka',  2, 4, 0, [],                'ronin')
    ];
}

function players3() {
    const p = (name, char, hp, honor, hand, perm, role, extra) =>
        Object.assign({ name, char, hp, honor, hand, perm, role, connected: true }, extra);
    return [
        p('Aiko',  'ieyasu',  5, 6, 7, [],            'shogun', { shogun: true }),
        p('Kenji', 'kojiro',  5, 3, 5, ['armure'],    'ninja'),
        p('Sayuri', 'tomoe',  5, 3, 4, [],            'ninja')
    ];
}
