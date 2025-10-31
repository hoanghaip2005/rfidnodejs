// Authentication and login functionality

// Store login form state
let loginState = {
    isSubmitting: false,
    rememberMe: false
};

// Login form submission
async function handleLogin(event) {
    event.preventDefault();

    if (loginState.isSubmitting) {
        return;
    }

    const form = event.target;
    const formData = new FormData(form);

    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;

    try {
        loginState.isSubmitting = true;

        // Update button state
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đăng nhập...';

        // Clear previous errors
        clearFormErrors(form);

        const loginData = {
            username: formData.get('username'),
            password: formData.get('password'),
            remember_me: formData.get('remember_me') === 'on'
        };

        // Add network information if available
        if (window.gatewayIP) {
            loginData.gateway_ip = window.gatewayIP;
        }

        if (window.wifiName) {
            loginData.wifi_name = window.wifiName;
        }

        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginData)
        });

        const result = await response.json();

        if (result.success) {
            // Successful login
            showLoginMessage('Đăng nhập thành công!', 'success');

            // Redirect after a short delay
            setTimeout(() => {
                window.location.href = result.redirectUrl || '/';
            }, 1000);

        } else {
            // Login failed
            showLoginMessage(result.message || 'Đăng nhập thất bại', 'error');

            // Show field-specific errors
            if (result.errors) {
                showFormErrors(form, result.errors);
            }

            // Reset form state
            resetLoginForm(form, submitButton, originalText);
        }

    } catch (error) {
        console.error('Login error:', error);
        showLoginMessage('Đã xảy ra lỗi kết nối. Vui lòng thử lại.', 'error');
        resetLoginForm(form, submitButton, originalText);
    }
}

// Reset login form to initial state
function resetLoginForm(form, submitButton, originalText) {
    loginState.isSubmitting = false;
    submitButton.disabled = false;
    submitButton.innerHTML = originalText;

    // Focus on first input with error or username field
    const errorInput = form.querySelector('.is-invalid');
    if (errorInput) {
        errorInput.focus();
    } else {
        const usernameInput = form.querySelector('input[name="username"]');
        if (usernameInput) {
            usernameInput.focus();
        }
    }
}

// Show login message
function showLoginMessage(message, type = 'info') {
    const messageContainer = document.getElementById('loginMessage');

    if (messageContainer) {
        const alertTypes = {
            'success': 'alert-success',
            'error': 'alert-danger',
            'warning': 'alert-warning',
            'info': 'alert-info'
        };

        const alertClass = alertTypes[type] || alertTypes['info'];

        messageContainer.className = `alert ${alertClass}`;
        messageContainer.innerHTML = `<i class="fas fa-${getIconForType(type)}"></i> ${message}`;
        messageContainer.style.display = 'block';

        // Auto hide success messages
        if (type === 'success') {
            setTimeout(() => {
                messageContainer.style.display = 'none';
            }, 3000);
        }
    } else {
        // Fallback to global message
        if (typeof window.showMessage === 'function') {
            window.showMessage(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }
}

// Get icon for message type
function getIconForType(type) {
    const icons = {
        'success': 'check-circle',
        'error': 'exclamation-circle',
        'warning': 'exclamation-triangle',
        'info': 'info-circle'
    };

    return icons[type] || icons['info'];
}

// Show form field errors
function showFormErrors(form, errors) {
    Object.keys(errors).forEach(fieldName => {
        const field = form.querySelector(`[name="${fieldName}"]`);
        if (field) {
            field.classList.add('is-invalid');

            // Find or create error feedback element
            let feedback = field.parentNode.querySelector('.invalid-feedback');
            if (!feedback) {
                feedback = document.createElement('div');
                feedback.className = 'invalid-feedback';
                field.parentNode.appendChild(feedback);
            }

            feedback.textContent = errors[fieldName];
        }
    });
}

// Clear form errors
function clearFormErrors(form) {
    // Remove invalid classes
    form.querySelectorAll('.is-invalid').forEach(field => {
        field.classList.remove('is-invalid');
    });

    // Remove error feedback
    form.querySelectorAll('.invalid-feedback').forEach(feedback => {
        feedback.remove();
    });
}

// Validate form fields in real-time
function setupFormValidation(form) {
    const inputs = form.querySelectorAll('input[required]');

    inputs.forEach(input => {
        input.addEventListener('blur', function () {
            validateField(this);
        });

        input.addEventListener('input', function () {
            // Clear error state when user starts typing
            if (this.classList.contains('is-invalid')) {
                this.classList.remove('is-invalid');
                const feedback = this.parentNode.querySelector('.invalid-feedback');
                if (feedback) {
                    feedback.remove();
                }
            }
        });
    });
}

// Validate individual field
function validateField(field) {
    const value = field.value.trim();
    let isValid = true;
    let errorMessage = '';

    if (field.hasAttribute('required') && !value) {
        isValid = false;
        errorMessage = 'Trường này là bắt buộc';
    } else if (field.type === 'email' && value && !isValidEmail(value)) {
        isValid = false;
        errorMessage = 'Email không hợp lệ';
    } else if (field.name === 'username' && value && value.length < 3) {
        isValid = false;
        errorMessage = 'Tên đăng nhập phải có ít nhất 3 ký tự';
    } else if (field.type === 'password' && value && value.length < 6) {
        isValid = false;
        errorMessage = 'Mật khẩu phải có ít nhất 6 ký tự';
    }

    if (!isValid) {
        field.classList.add('is-invalid');

        let feedback = field.parentNode.querySelector('.invalid-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'invalid-feedback';
            field.parentNode.appendChild(feedback);
        }
        feedback.textContent = errorMessage;
    } else {
        field.classList.remove('is-invalid');
        const feedback = field.parentNode.querySelector('.invalid-feedback');
        if (feedback) {
            feedback.remove();
        }
    }

    return isValid;
}

// Email validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Initialize login page
function initializeLoginPage() {
    const loginForm = document.getElementById('loginForm');

    if (loginForm) {
        // Setup form submission
        loginForm.addEventListener('submit', handleLogin);

        // Setup form validation
        setupFormValidation(loginForm);

        // Setup remember me functionality
        const rememberMeCheckbox = loginForm.querySelector('input[name="remember_me"]');
        if (rememberMeCheckbox) {
            rememberMeCheckbox.addEventListener('change', function () {
                loginState.rememberMe = this.checked;
            });
        }

        // Focus on username field
        const usernameField = loginForm.querySelector('input[name="username"]');
        if (usernameField) {
            usernameField.focus();
        }

        // Setup keyboard shortcuts
        loginForm.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !loginState.isSubmitting) {
                loginForm.dispatchEvent(new Event('submit'));
            }
        });
    }

    // Check for auto-login or remember me
    checkAutoLogin();
}

// Check for auto-login functionality
async function checkAutoLogin() {
    try {
        const response = await fetch('/auth/check', {
            method: 'GET',
            credentials: 'same-origin'
        });

        const result = await response.json();

        if (result.success && result.user) {
            // User is already logged in, redirect
            showLoginMessage('Đã đăng nhập, đang chuyển hướng...', 'info');
            setTimeout(() => {
                window.location.href = result.redirectUrl || '/';
            }, 1000);
        }
    } catch (error) {
        console.log('Auto-login check failed:', error);
        // Ignore errors, just continue with normal login
    }
}

// Logout functionality
async function handleLogout() {
    if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
        try {
            const response = await fetch('/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();

            if (result.success) {
                window.location.href = result.redirectUrl || '/auth/login';
            } else {
                showLoginMessage(result.message || 'Đăng xuất thất bại', 'error');
            }
        } catch (error) {
            console.error('Logout error:', error);
            showLoginMessage('Đã xảy ra lỗi khi đăng xuất', 'error');
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    // Check if we're on login page
    if (document.getElementById('loginForm')) {
        initializeLoginPage();
    }
});

// Export functions for global use
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.showLoginMessage = showLoginMessage;