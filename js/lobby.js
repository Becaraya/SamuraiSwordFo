let socket;

async function fetchUsers() {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Please login first');
        return;
    }

    const response = await fetch('http://localhost:8080/tokens', {
        method: 'GET',
        headers: {
            'Authorization': token
        }
    });

    if (response.ok) {
        const data = await response.json();
        updateUsersList(data.tokens);
    } else {
        alert('Failed to fetch users');
    }
}

function updateUsersList(tokens) {
    const lobbyList = document.getElementById('lobbyList');
    const tableList = document.getElementById('tableList');
    const spectatorList = document.getElementById('spectatorList');

    lobbyList.innerHTML = '';
    tableList.innerHTML = '';
    spectatorList.innerHTML = '';

    for (const [username, userState] of Object.entries(tokens)) {
        const li = document.createElement('li');
        li.textContent = `${username} (expires at ${new Date(userState.Expiry).toLocaleString()})`;
        if (userState.State === 'Lobby') {
            lobbyList.appendChild(li);
        } else if (userState.State === 'Table') {
            tableList.appendChild(li);
        } else if (userState.State === 'Spectateur') {
            spectatorList.appendChild(li);
        }
    }
}

function connectWebSocket() {
    socket = new WebSocket('ws://localhost:8080/ws');

    socket.onmessage = function(event) {
        const message = JSON.parse(event.data);
        const userList = document.getElementById(`${message.state.toLowerCase()}List`);
        const existingUser = Array.from(userList.children).find(li => li.textContent.includes(message.username));
        if (!existingUser) {
            const li = document.createElement('li');
            li.textContent = `${message.username} (expires at ${new Date(message.expiry).toLocaleString()})`;
            userList.appendChild(li);
        }
    };

    socket.onclose = function(event) {
        console.log('WebSocket closed:', event);
    };

    socket.onerror = function(error) {
        console.log('WebSocket error:', error);
    };
}

function changeState(username, newState) {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Please login first');
        return;
    }

    fetch('http://localhost:8080/change-state', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        body: JSON.stringify({ username, state: newState })
    }).then(response => {
        if (response.ok) {
            fetchUsers();
        } else {
            alert('Failed to change state');
        }
    });
}

window.onload = function() {
    connectWebSocket();
    fetchUsers();
    setInterval(fetchUsers, 60000); // Refresh the user list every minute
};