// Main JavaScript for RFID Attendance System - Node.js Version

let isSubmitting = false;
let gatewayIP = null;
let wifiName = null;

// Network detection utilities
async function detectGatewayIP() {
    try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');

        return new Promise((resolve) => {
            pc.createOffer().then(offer => pc.setLocalDescription(offer));

            pc.onicecandidate = (ice) => {
                if (ice && ice.candidate && ice.candidate.candidate) {
                    const candidate = ice.candidate.candidate;
                    const match = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
                    if (match) {
                        const localIP = match[1];
                        const ipParts = localIP.split('.');
                        if (ipParts.length === 4) {
                            const gatewayGuess = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.1`;
                            gatewayIP = gatewayGuess;
                            console.log('Detected potential gateway:', gatewayGuess);
                            resolve(gatewayGuess);
                        }
                    }
                }
            };

            setTimeout(() => {
                pc.close();
                resolve(null);
            }, 2000);
        });
    } catch (error) {
        console.log('Gateway detection failed:', error);
        return null;
    }
}

async function detectWiFiInfo() {
    try {
        if ('connection' in navigator) {
            const connection = navigator.connection;
            if (connection && connection.effectiveType) {
                console.log('Connection type:', connection.effectiveType);
                // Try to get more info but WiFi name is usually not accessible
                return null;
            }
        }
        return null;
    } catch (error) {
        console.log('WiFi detection failed:', error);
        return null;
    }
}

// Initialize network detection
async function initializeNetworkDetection() {
    try {
        gatewayIP = await detectGatewayIP();
        wifiName = await detectWiFiInfo();

        console.log('Network detection results:', {
            gatewayIP,
            wifiName
        });
    } catch (error) {
        console.error('Network detection initialization failed:', error);
    }
}

// RFID Scan processing
async function processRFIDScan(cardId, eventId = null) {
    if (isSubmitting) {
        console.log('Already submitting, skipping...');
        return;
    }

    isSubmitting = true;

    try {
        const requestData = {
            rfid_card: cardId.toString()
        };

        if (eventId) {
            requestData.event_id = eventId;
        }

        // Add network information
        if (gatewayIP) {
            requestData.gateway_ip = gatewayIP;
        }

        if (wifiName) {
            requestData.wifi_name = wifiName;
        }

        const response = await fetch('/api/rfid/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (result.success) {
            showMessage(result.message, 'success');

            // Emit to other components if needed
            if (typeof window.socket !== 'undefined') {
                window.socket.emit('attendance_processed', {
                    user: result.data.user,
                    action: result.data.action,
                    time: result.data.time
                });
            }

            // Refresh data
            if (typeof loadTodayStatus === 'function') {
                loadTodayStatus();
            }

            if (typeof loadRecentHistory === 'function') {
                loadRecentHistory();
            }

        } else {
            showMessage(result.message || 'Đã xảy ra lỗi khi chấm công', 'error');
        }

    } catch (error) {
        console.error('RFID scan error:', error);
        showMessage('Đã xảy ra lỗi kết nối. Vui lòng thử lại.', 'error');
    } finally {
        setTimeout(() => {
            isSubmitting = false;
        }, 1000); // Prevent spam for 1 second
    }
}

// Manual RFID input processing
async function processManualRFID(inputId, eventId = null) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const cardId = input.value.trim();
    if (!cardId) {
        showMessage('Vui lòng nhập ID thẻ RFID', 'warning');
        return;
    }

    // Validate card ID format
    if (!/^\d{8,12}$/.test(cardId)) {
        showMessage('ID thẻ RFID không hợp lệ (8-12 số)', 'warning');
        return;
    }

    await processRFIDScan(cardId, eventId);
    input.value = '';
}

// Show message to user
function showMessage(message, type = 'info') {
    // Try to find existing message container
    let container = document.getElementById('messageContainer');

    if (!container) {
        // Create message container if not exists
        container = document.createElement('div');
        container.id = 'messageContainer';
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        container.style.maxWidth = '400px';
        document.body.appendChild(container);
    }

    const alertTypes = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'warning': 'alert-warning',
        'info': 'alert-info'
    };

    const alertClass = alertTypes[type] || alertTypes['info'];

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertClass} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    container.appendChild(alertDiv);

    // Auto remove after 5 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

// Format date and time
function formatDateTime(dateTime, format = 'datetime') {
    const date = new Date(dateTime);
    const options = {
        timeZone: 'Asia/Ho_Chi_Minh'
    };

    switch (format) {
        case 'time':
            options.hour = '2-digit';
            options.minute = '2-digit';
            options.second = '2-digit';
            return date.toLocaleTimeString('vi-VN', options);

        case 'date':
            options.year = 'numeric';
            options.month = '2-digit';
            options.day = '2-digit';
            return date.toLocaleDateString('vi-VN', options);

        case 'datetime':
        default:
            options.year = 'numeric';
            options.month = '2-digit';
            options.day = '2-digit';
            options.hour = '2-digit';
            options.minute = '2-digit';
            return date.toLocaleString('vi-VN', options);
    }
}

// Common API request function
async function apiRequest(url, options = {}) {
    try {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const finalOptions = { ...defaultOptions, ...options };

        // Add network headers if available
        if (gatewayIP) {
            finalOptions.headers['X-Gateway-IP'] = gatewayIP;
        }

        if (wifiName) {
            finalOptions.headers['X-WiFi-Name'] = wifiName;
        }

        const response = await fetch(url, finalOptions);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();

    } catch (error) {
        console.error('API request error:', error);
        throw error;
    }
}

// User management helpers
async function logout() {
    if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
        try {
            const result = await apiRequest('/auth/logout', { method: 'POST' });

            if (result.success) {
                window.location.href = result.redirectUrl || '/auth/login';
            } else {
                showMessage(result.message || 'Đăng xuất thất bại', 'error');
            }
        } catch (error) {
            console.error('Logout error:', error);
            showMessage('Đã xảy ra lỗi khi đăng xuất', 'error');
        }
    }
}

// Change password function
async function changePassword() {
    // Create change password modal
    const modalHTML = `
        <div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="changePasswordModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="changePasswordModalLabel">
                            <i class="fas fa-key me-2"></i>Đổi mật khẩu
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <form id="changePasswordForm">
                            <div class="mb-3">
                                <label for="currentPassword" class="form-label">Mật khẩu hiện tại</label>
                                <div class="input-group">
                                    <input type="password" class="form-control" id="currentPassword" name="currentPassword" required>
                                    <button class="btn btn-outline-secondary" type="button" onclick="togglePasswordVisibility('currentPassword')">
                                        <i class="fas fa-eye" id="currentPasswordIcon"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label for="newPassword" class="form-label">Mật khẩu mới</label>
                                <div class="input-group">
                                    <input type="password" class="form-control" id="newPassword" name="newPassword" required minlength="6">
                                    <button class="btn btn-outline-secondary" type="button" onclick="togglePasswordVisibility('newPassword')">
                                        <i class="fas fa-eye" id="newPasswordIcon"></i>
                                    </button>
                                </div>
                                <div class="form-text">Mật khẩu phải có ít nhất 6 ký tự</div>
                            </div>
                            <div class="mb-3">
                                <label for="confirmPassword" class="form-label">Xác nhận mật khẩu mới</label>
                                <div class="input-group">
                                    <input type="password" class="form-control" id="confirmPassword" name="confirmPassword" required>
                                    <button class="btn btn-outline-secondary" type="button" onclick="togglePasswordVisibility('confirmPassword')">
                                        <i class="fas fa-eye" id="confirmPasswordIcon"></i>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Hủy</button>
                        <button type="button" class="btn btn-primary" onclick="submitChangePassword()">
                            <i class="fas fa-save me-1"></i>Đổi mật khẩu
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('changePasswordModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
    modal.show();

    // Focus on first input when modal is shown
    document.getElementById('changePasswordModal').addEventListener('shown.bs.modal', function () {
        document.getElementById('currentPassword').focus();
    });

    // Clean up when modal is hidden
    document.getElementById('changePasswordModal').addEventListener('hidden.bs.modal', function () {
        document.getElementById('changePasswordModal').remove();
    });
}

// Toggle password visibility
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(inputId + 'Icon');

    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// Submit change password
async function submitChangePassword() {
    const form = document.getElementById('changePasswordForm');
    const formData = new FormData(form);

    const currentPassword = formData.get('currentPassword');
    const newPassword = formData.get('newPassword');
    const confirmPassword = formData.get('confirmPassword');

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        showMessage('Vui lòng điền đầy đủ thông tin', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showMessage('Mật khẩu mới và xác nhận mật khẩu không khớp', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showMessage('Mật khẩu mới phải có ít nhất 6 ký tự', 'error');
        return;
    }

    if (newPassword === currentPassword) {
        showMessage('Mật khẩu mới phải khác mật khẩu hiện tại', 'error');
        return;
    }

    try {
        // Disable submit button
        const submitBtn = document.querySelector('#changePasswordModal .btn-primary');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Đang xử lý...';

        const result = await apiRequest('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
                currentPassword,
                newPassword,
                confirmPassword
            })
        });

        if (result.success) {
            showMessage('Đổi mật khẩu thành công', 'success');

            // Hide modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('changePasswordModal'));
            modal.hide();

            // Clear form
            form.reset();
        } else {
            showMessage(result.message || 'Đổi mật khẩu thất bại', 'error');
        }

        // Re-enable submit button
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;

    } catch (error) {
        console.error('Change password error:', error);
        showMessage('Đã xảy ra lỗi khi đổi mật khẩu', 'error');

        // Re-enable submit button
        const submitBtn = document.querySelector('#changePasswordModal .btn-primary');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-save me-1"></i>Đổi mật khẩu';
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', function () {
    console.log('RFID Attendance System - Node.js Version');

    // Initialize network detection
    initializeNetworkDetection();

    // Setup global keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        // F5 or Ctrl+R: Refresh page
        if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
            e.preventDefault();
            window.location.reload();
        }

        // Escape: Clear focus from inputs
        if (e.key === 'Escape') {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }
        }
    });

    // Setup global error handler
    window.addEventListener('error', function (e) {
        console.error('Global error:', e.error);
        showMessage('Đã xảy ra lỗi hệ thống', 'error');
    });

    // Setup unhandled promise rejection handler
    window.addEventListener('unhandledrejection', function (e) {
        console.error('Unhandled promise rejection:', e.reason);
        showMessage('Đã xảy ra lỗi không mong muốn', 'error');
        e.preventDefault();
    });
});

// Export functions for global use
window.processRFIDScan = processRFIDScan;
window.processManualRFID = processManualRFID;
window.showMessage = showMessage;
window.formatDateTime = formatDateTime;
window.apiRequest = apiRequest;
window.logout = logout;
window.changePassword = changePassword;
window.togglePasswordVisibility = togglePasswordVisibility;
window.submitChangePassword = submitChangePassword;