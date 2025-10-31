// Authentication check and session management
document.addEventListener('DOMContentLoaded', function () {
    // Check authentication status
    checkAuthStatus();

    // Setup periodic session check
    setInterval(checkAuthStatus, 300000); // Check every 5 minutes
});

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();

        if (!data.authenticated) {
            // Redirect to login if not authenticated
            window.location.href = '/auth/login';
        }
    } catch (error) {
        console.error('Auth status check failed:', error);
        // Optionally redirect to login on error
        // window.location.href = '/auth/login';
    }
}

// Logout function
async function logout() {
    if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
        try {
            const response = await fetch('/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();

            if (data.success) {
                window.location.href = data.redirectUrl || '/auth/login';
            } else {
                alert('Đã xảy ra lỗi khi đăng xuất');
            }
        } catch (error) {
            console.error('Logout error:', error);
            alert('Đã xảy ra lỗi khi đăng xuất');
        }
    }
}

// Handle session expired
window.addEventListener('beforeunload', function () {
    // Optional: Send beacon to server about page unload
});