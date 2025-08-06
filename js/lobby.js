let socket;
let currentUser = null;
let hasJoined = false;
let gameState = null;

function getCurrentUsername() {
    const token = localStorage.getItem('token');
    if (!token) return null;
    
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.username || payload.sub;
    } catch (e) {
        console.error('Erreur lors du décodage du token:', e);
        return null;
    }
}

async function toggleJoinLeave() {
    if (hasJoined) {
        await leaveGame();
    } else {
        await joinGame();
    }
}

// Fonction pour rejoindre la partie
async function joinGame() {
    if (hasJoined) return;
    
    const username = getCurrentUsername();
    if (!username) {
        alert('Erreur: Impossible de récupérer votre nom d\'utilisateur');
        window.location.href = 'login.html';
        return;
    }

    const token = localStorage.getItem('token');
    
    try {
        // Requête HTTP pour rejoindre
        const response = await fetch('http://localhost:8080/game/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify({ username })
        });

        if (response.ok) {
            // Vérifier si la réponse contient du JSON valide
            const contentType = response.headers.get('content-type');
            let data = null;
            
            if (contentType && contentType.includes('application/json')) {
                try {
                    data = await response.json();
                    console.log('Rejoint avec succès:', data);
                    
                    // Notifier via WebSocket
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            type: 'join_game',
                            data: {
                                username: username,
                                position: data.player ? data.player.position : null
                            }
                        }));
                    }
                    
                    // Mettre à jour l'interface locale
                    updateLocalPlayerJoined(username, data.player || { position: 4 });
                    showNotification(`Vous avez rejoint la partie à la position ${data.player ? data.player.position : 4}!`, 'success');
                    
                } catch (jsonError) {
                    console.warn('Réponse non-JSON reçue, mais requête réussie');
                    // Continuer avec des valeurs par défaut
                    updateLocalPlayerJoined(username, { position: 4 });
                    showNotification('Vous avez rejoint la partie!', 'success');
                }
            } else {
                // Si ce n'est pas du JSON, traiter comme succès avec valeurs par défaut
                updateLocalPlayerJoined(username, { position: 4 });
                showNotification('Vous avez rejoint la partie!', 'success');
            }
            
        } else {
            // Gérer les erreurs HTTP
            let errorMessage = 'Erreur inconnue';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
            } catch (jsonError) {
                const textError = await response.text();
                errorMessage = textError || `Erreur HTTP ${response.status}`;
            }
            alert('Erreur: ' + errorMessage);
        }
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur de connexion au serveur');
    }
}

// Fonction pour quitter la partie
async function leaveGame() {
    if (!hasJoined) return;
    
    const username = getCurrentUsername();
    if (!username) return;

    const token = localStorage.getItem('token');
    
    try {
        const response = await fetch('http://localhost:8080/game/leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify({ username })
        });

        if (response.ok) {
            // Cloner la réponse pour pouvoir la lire plusieurs fois si nécessaire
            const responseClone = response.clone();
            const contentType = response.headers.get('content-type');
            let data = null;
            
            try {
                if (contentType && contentType.includes('application/json')) {
                    data = await response.json();
                    console.log('Quitté avec succès:', data);
                } else {
                    const textResponse = await response.text();
                    console.log('Réponse texte:', textResponse);
                }
            } catch (parseError) {
                console.warn('Erreur lors du parsing de la réponse, mais requête réussie');
            }
            
            // Notifier via WebSocket
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'leave_game',
                    data: {
                        username: username
                    }
                }));
            }
            
            // Mettre à jour l'interface locale
            updateLocalPlayerLeft(username);
            showNotification('Vous avez quitté la partie!', 'info');
            
        } else {
            // Gérer les erreurs HTTP
            let errorMessage = 'Erreur inconnue';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorMessage;
            } catch (jsonError) {
                try {
                    const textError = await response.text();
                    errorMessage = textError || `Erreur HTTP ${response.status}`;
                } catch (textError) {
                    errorMessage = `Erreur HTTP ${response.status}`;
                }
            }
            console.error('Erreur lors de la sortie:', errorMessage);
            showNotification('Erreur lors de la sortie: ' + errorMessage, 'error');
        }
    } catch (error) {
        console.error('Erreur de connexion:', error);
        showNotification('Erreur de connexion au serveur', 'error');
    }
}

// Mettre à jour l'interface quand le joueur local rejoint
function updateLocalPlayerJoined(username, player) {
    const centerPlus = document.getElementById('centerPlus');
    const centerText = document.getElementById('centerText');
    const playerName = document.getElementById('playerName');
    const centerPosition = document.getElementById('centerPosition');
    const joinBtn = document.getElementById('joinBtn');
    const startBtn = document.getElementById('startBtn');
    
    // Mettre à jour la position centrale
    if (centerPlus) centerPlus.style.display = 'none';
    if (centerText) centerText.style.display = 'none';
    if (playerName) {
        playerName.textContent = username;
        playerName.style.display = 'block';
    }
    
    if (centerPosition) {
        centerPosition.classList.add('joined');
    }
    
    if (joinBtn) {
        joinBtn.textContent = 'LEAVE';
        joinBtn.classList.add('leave-mode');
    }
    
    hasJoined = true;
    
    if (startBtn) startBtn.style.display = 'block';
}

// Mettre à jour l'interface quand le joueur local quitte
function updateLocalPlayerLeft(username) {
    const centerPlus = document.getElementById('centerPlus');
    const centerText = document.getElementById('centerText');
    const playerName = document.getElementById('playerName');
    const centerPosition = document.getElementById('centerPosition');
    const joinBtn = document.getElementById('joinBtn');
    const startBtn = document.getElementById('startBtn');
    
    // Remettre l'affichage initial de la position centrale
    if (centerPlus) centerPlus.style.display = 'block';
    if (centerText) {
        centerText.style.display = 'block';
        centerText.textContent = 'Position 4';
    }
    if (playerName) {
        playerName.style.display = 'none';
    }
    
    if (centerPosition) {
        centerPosition.classList.remove('joined');
    }
    
    // Mettre à jour le bouton LEAVE -> JOIN
    if (joinBtn) {
        joinBtn.textContent = 'JOIN';
        joinBtn.classList.remove('leave-mode');
    }
    
    hasJoined = false;
    
    // Masquer le bouton START
    if (startBtn) startBtn.style.display = 'none';
}

// Fonction pour afficher des notifications
function showNotification(message, type = 'info') {
    // Créer l'élément de notification s'il n'existe pas
    let notification = document.getElementById('notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 5px;
            color: white;
            font-weight: bold;
            z-index: 1000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        `;
        document.body.appendChild(notification);
    }
    
    // Définir le style selon le type
    const colors = {
        success: '#2ecc71',
        error: '#e74c3c',
        info: '#3498db',
        warning: '#f39c12'
    };
    
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    
    // Animer l'apparition
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Masquer après 3 secondes
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
    }, 3000);
}

// Fonction pour récupérer l'état du jeu
async function fetchGameState() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch('http://localhost:8080/game', {
            method: 'GET',
            headers: {
                'Authorization': token
            }
        });

        if (response.ok) {
            const data = await response.json();
            gameState = data.game;
            updateGameDisplay(data.players);
        }
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'état du jeu:', error);
    }
}

// Fonction pour mettre à jour l'affichage du jeu
function updateGameDisplay(players) {
    const currentUsername = getCurrentUsername();
    
    // Réinitialiser toutes les positions
    for (let i = 1; i <= 7; i++) {
        const position = document.querySelector(`[data-position="${i}"]`);
        if (position) {
            const plusIcon = position.querySelector('.plus-icon');
            const positionText = position.querySelector('.position-text');
            let playerNameSpan = position.querySelector('.player-name');
            
            if (!playerNameSpan) {
                playerNameSpan = document.createElement('span');
                playerNameSpan.className = 'player-name';
                position.appendChild(playerNameSpan);
            }
            
            // Réinitialiser l'affichage
            if (plusIcon) plusIcon.style.display = 'block';
            if (positionText) {
                positionText.style.display = 'block';
                positionText.textContent = `Position ${i}`;
            }
            playerNameSpan.style.display = 'none';
            
            position.classList.remove('joined');
        }
    }
    
    // Afficher les joueurs à leurs positions
    if (players && typeof players === 'object') {
        Object.values(players).forEach(player => {
            const position = document.querySelector(`[data-position="${player.position}"]`);
            if (position) {
                const plusIcon = position.querySelector('.plus-icon');
                const positionText = position.querySelector('.position-text');
                const playerNameSpan = position.querySelector('.player-name');
                
                if (plusIcon) plusIcon.style.display = 'none';
                if (positionText) positionText.style.display = 'none';
                if (playerNameSpan) {
                    playerNameSpan.textContent = player.name;
                    playerNameSpan.style.display = 'block';
                }
                
                position.classList.add('joined');
                
                // Si c'est le joueur actuel
                if (player.name === currentUsername) {
                    hasJoined = true;
                    
                    // Mettre à jour le bouton JOIN/LEAVE
                    const joinBtn = document.getElementById('joinBtn');
                    if (joinBtn) {
                        joinBtn.textContent = 'LEAVE';
                        joinBtn.classList.add('leave-mode');
                    }
                    
                    // Afficher le bouton START
                    const startBtn = document.getElementById('startBtn');
                    if (startBtn) startBtn.style.display = 'block';
                }
            }
        });
    }
    
    // Si le joueur actuel n'est pas dans la liste, s'assurer que l'interface est correcte
    if (!hasJoined) {
        const joinBtn = document.getElementById('joinBtn');
        if (joinBtn) {
            joinBtn.textContent = 'JOIN';
            joinBtn.classList.remove('leave-mode');
        }
        
        const startBtn = document.getElementById('startBtn');
        if (startBtn) startBtn.style.display = 'none';
    }
    
    updateConnectedUsersList(players);
}

// Fonction de connexion WebSocket
function connectWebSocket() {
    const token = localStorage.getItem('token');
    const username = getCurrentUsername();
    if (!token || !username) return;
    
    socket = new WebSocket('ws://localhost:8080/ws');

    socket.onopen = function(event) {
        console.log('WebSocket connecté');
        
        // S'authentifier immédiatement
        socket.send(JSON.stringify({
            type: 'auth',
            data: {
                username: username,
                token: token
            }
        }));
    };

    socket.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('Message WebSocket reçu:', message);
            
            switch (message.type) {
                case 'game_update':
                    // Mise à jour de l'état du jeu
                    if (message.data.players) {
                        updateGameDisplay(message.data.players);
                    }
                    
                    // Afficher une notification selon l'événement
                    if (message.data.event === 'player_joined' && message.from !== username) {
                        showNotification(`🎮 ${message.from} a rejoint la partie!`, 'info');
                    } else if (message.data.event === 'player_left' && message.from !== username) {
                        showNotification(`👋 ${message.from} a quitté la partie!`, 'warning');
                    }
                    break;
                    
                case 'player_joined':
                    // Notification quand un joueur rejoint
                    if (message.from !== username) {
                        showNotification(`🎮 ${message.data.username} a rejoint la partie!`, 'info');
                    }
                    fetchGameState();
                    break;
                    
                case 'player_left':
                    // Notification quand un joueur quitte
                    if (message.from !== username) {
                        showNotification(`👋 ${message.data.username} a quitté la partie!`, 'warning');
                    }
                    fetchGameState();
                    break;
                    
                case 'game_started':
                    showNotification('🚀 La partie a commencé!', 'success');
                    gameState = message.data.game;
                    break;
                    
                case 'game_starting':
                    if (message.from !== username) {
                        showNotification(`⏳ ${message.from} lance la partie...`, 'warning');
                    }
                    break;
            }
        } catch (error) {
            console.error('Erreur lors du parsing du message WebSocket:', error);
        }
    };

    socket.onclose = function(event) {
        console.log('WebSocket fermé:', event);
        showNotification('Connexion interrompue. Reconnexion...', 'warning');
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = function(error) {
        console.error('Erreur WebSocket:', error);
        showNotification('Erreur de connexion', 'error');
    };
}

// Fonction pour démarrer le jeu
async function startGame() {
    const username = getCurrentUsername();
    
    if (!hasJoined) {
        alert('Vous devez d\'abord rejoindre la partie !');
        return;
    }

    const token = localStorage.getItem('token');
    
    try {
        // Envoyer via WebSocket d'abord pour notification immédiate
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'start_game',
                data: {
                    username: username
                }
            }));
        }
        
        const response = await fetch('http://localhost:8080/game/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            }
        });

        if (response.ok) {
            const data = await response.json();
            showNotification('🚀 Partie démarrée avec succès!', 'success');
            console.log('Partie démarrée:', data);
        } else {
            const errorData = await response.json();
            showNotification((errorData.error || 'Erreur lors du démarrage'), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        showNotification('Erreur de connexion', 'error');
    }
}

// Mise à jour de la liste des utilisateurs connectés
function updateConnectedUsersList(players) {
    const usersList = document.getElementById('connectedUsersList');
    if (!usersList) return;
    
    usersList.innerHTML = '';
    
    const currentUsername = getCurrentUsername();
    
    if (players && typeof players === 'object') {
        Object.values(players).forEach(player => {
            const li = document.createElement('li');
            
            if (player.name === currentUsername) {
                li.classList.add('current-user');
                li.textContent = `${player.name} (vous)`;
            } else {
                li.textContent = `${player.name}`;
            }
            
            usersList.appendChild(li);
        });
    }
}

async function fetchUsers() {
    await fetchGameState();
}

function logout() {
    localStorage.removeItem('token');
    if (socket) {
        socket.close();
    }
    window.location.href = 'login.html';
}

// Initialisation de la page
window.onload = function() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = getCurrentUsername();
    
    connectWebSocket();
    setTimeout(fetchGameState, 1000);
    setInterval(fetchGameState, 30000);
};