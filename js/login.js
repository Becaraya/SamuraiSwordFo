const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{2,20}$/u;

const form = document.getElementById('loginForm');
const input = document.getElementById('username');
const errorBox = document.getElementById('loginError');
const submitBtn = document.getElementById('loginBtn');

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    input.classList.toggle('invalid', Boolean(message));
}

async function login(event) {
    event.preventDefault();
    const username = input.value.trim();

    if (!USERNAME_PATTERN.test(username)) {
        showError('Le pseudo doit contenir 2 à 20 caractères (lettres, chiffres, _ ou -).');
        input.focus();
        return;
    }

    showError('');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connexion…';

    const { ok, status, data } = await apiFetch('/login', {
        method: 'POST',
        body: JSON.stringify({ username })
    });

    if (ok && data.token) {
        Session.setToken(data.token);
        window.location.href = 'lobby.html';
        return;
    }

    if (status === 409) {
        showError('Ce pseudo est déjà utilisé par un joueur connecté.');
    } else if (status === 0) {
        showError('Serveur injoignable. Vérifiez que l\'API est démarrée.');
    } else {
        showError(data.error || 'Connexion impossible.');
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrer';
}

if (Session.isValid()) {
    window.location.replace('lobby.html');
}

form.addEventListener('submit', login);
input.addEventListener('input', () => showError(''));
