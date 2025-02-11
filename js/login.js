async function login() {
    const username = document.getElementById('username').value;
    if (!username) {
        alert('Please enter a username');
        return;
    }

    const response = await fetch('http://localhost:8080/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username })
    });

    if (response.ok) {
        const data = await response.json();
        localStorage.setItem('token', data.token);
        window.location.href = 'lobby.html';
    } else {
        alert('Login failed');
    }
}