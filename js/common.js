// Surcharge possible via js/config.js (voir config.js.example)
const CONFIG = Object.assign({
    API_URL: 'http://localhost:8080',
    WS_URL: 'ws://localhost:8080/ws',
    DEBUG: false
}, window.KATANA_CONFIG || {});

const Session = {
    getToken() {
        return localStorage.getItem('token');
    },

    setToken(token) {
        localStorage.setItem('token', token);
    },

    clear() {
        localStorage.removeItem('token');
    },

    getPayload() {
        const token = this.getToken();
        if (!token) return null;
        try {
            const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(
                atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
            );
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    },

    getUsername() {
        const payload = this.getPayload();
        return payload ? (payload.username || payload.sub || null) : null;
    },

    isValid() {
        const payload = this.getPayload();
        if (!payload || !(payload.username || payload.sub)) return false;
        return !payload.exp || payload.exp * 1000 > Date.now();
    }
};

// Retourne { ok, status, data } ; redirige vers la connexion si le token est refusé.
async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = Session.getToken();
    if (token) headers['Authorization'] = token;

    let response;
    try {
        response = await fetch(CONFIG.API_URL + path, { ...options, headers: { ...headers, ...options.headers } });
    } catch (e) {
        return { ok: false, status: 0, data: { error: 'Serveur injoignable' } };
    }

    let data = null;
    try {
        data = await response.json();
    } catch (e) {
        data = null;
    }

    if (response.status === 401 && token) {
        Session.clear();
        window.location.href = 'login.html';
    }

    return { ok: response.ok, status: response.status, data: data || {} };
}

function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toasts');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toasts';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
