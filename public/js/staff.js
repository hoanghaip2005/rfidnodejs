// Staff dashboard functionality

let staffDashboard = {
    currentUser: null,
    todayStatus: null,
    recentHistory: [],
    selectedEvent: null,
    socket: null,
    rfidListening: false
};

// Initialize staff dashboard
function initializeStaffDashboard() {
    console.log('Initializing staff dashboard...');

    // Initialize Socket.IO
    initializeSocket();

    // Load initial data
    loadCurrentUser();
    loadTodayStatus();
    loadRecentHistory();
    loadAvailableEvents();

    // Setup event listeners
    setupEventListeners();

    // Setup RFID input
    setupRFIDInput();

    // Setup auto-refresh
    setupAutoRefresh();
}

// Initialize Socket.IO connection
function initializeSocket() {
    if (typeof io !== 'undefined') {
        staffDashboard.socket = io();

        staffDashboard.socket.on('connect', function () {
            console.log('Socket connected');
            updateConnectionStatus(true);
        });

        staffDashboard.socket.on('disconnect', function () {
            console.log('Socket disconnected');
            updateConnectionStatus(false);
        });

        // Listen for attendance updates
        staffDashboard.socket.on('attendance_processed', function (data) {
            handleAttendanceUpdate(data);
        });

        // Listen for RFID scans
        staffDashboard.socket.on('rfid_scan', function (data) {
            handleRFIDScan(data);
        });

        // Listen for system notifications
        staffDashboard.socket.on('notification', function (data) {
            showNotification(data.message, data.type);
        });
    }
}

// Load current user information
async function loadCurrentUser() {
    try {
        const response = await window.apiRequest('/api/user/profile');

        if (response.success) {
            staffDashboard.currentUser = response.data;
            updateUserDisplay(response.data);
        } else {
            console.error('Failed to load user:', response.message);
        }
    } catch (error) {
        console.error('Error loading user:', error);
    }
}

// Update user display
function updateUserDisplay(user) {
    const userName = document.getElementById('userName');
    if (userName) {
        userName.textContent = user.name || user.username;
    }

    const userRole = document.getElementById('userRole');
    if (userRole) {
        userRole.textContent = getRoleDisplayName(user.role);
    }

    const userAvatar = document.getElementById('userAvatar');
    if (userAvatar) {
        userAvatar.textContent = (user.name || user.username).charAt(0).toUpperCase();
    }
}

// Get role display name
function getRoleDisplayName(role) {
    const roles = {
        'admin': 'Quản trị viên',
        'staff': 'Nhân viên',
        'user': 'Người dùng'
    };

    return roles[role] || role;
}

// Load today's attendance status
async function loadTodayStatus() {
    try {
        const response = await window.apiRequest('/api/attendance/today');

        if (response.success) {
            staffDashboard.todayStatus = response.data;
            updateTodayStatusDisplay(response.data);
        } else {
            console.error('Failed to load today status:', response.message);
        }
    } catch (error) {
        console.error('Error loading today status:', error);
    }
}

// Update today's status display
function updateTodayStatusDisplay(status) {
    const statusCard = document.getElementById('todayStatus');
    if (!statusCard) return;

    const statusIcon = statusCard.querySelector('.status-icon');
    const statusText = statusCard.querySelector('.status-text');
    const statusTime = statusCard.querySelector('.status-time');

    if (status.checked_in && !status.checked_out) {
        // Currently checked in
        statusCard.className = 'card text-white bg-success';
        if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-clock"></i>';
        if (statusText) statusText.textContent = 'Đang làm việc';
        if (statusTime) statusTime.textContent = `Vào lúc: ${window.formatDateTime(status.check_in_time, 'time')}`;

    } else if (status.checked_in && status.checked_out) {
        // Completed work day
        statusCard.className = 'card text-white bg-info';
        if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
        if (statusText) statusText.textContent = 'Đã hoàn thành';
        if (statusTime) statusTime.textContent = `${window.formatDateTime(status.check_in_time, 'time')} - ${window.formatDateTime(status.check_out_time, 'time')}`;

    } else {
        // Not checked in yet
        statusCard.className = 'card text-white bg-warning';
        if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-clock"></i>';
        if (statusText) statusText.textContent = 'Chưa chấm công';
        if (statusTime) statusTime.textContent = 'Hãy chấm công để bắt đầu làm việc';
    }

    // Update working hours
    const workingHours = document.getElementById('workingHours');
    if (workingHours && status.working_hours !== undefined) {
        workingHours.textContent = `${status.working_hours.toFixed(1)} giờ`;
    }
}

// Load recent attendance history
async function loadRecentHistory() {
    try {
        const response = await window.apiRequest('/api/attendance/history?limit=10');

        if (response.success) {
            staffDashboard.recentHistory = response.data;
            updateHistoryDisplay(response.data);
        } else {
            console.error('Failed to load history:', response.message);
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Update history display
function updateHistoryDisplay(history) {
    const container = document.getElementById('recentHistory');
    if (!container) return;

    container.innerHTML = '';

    if (history.length === 0) {
        container.innerHTML = '<div class="text-muted text-center">Chưa có lịch sử chấm công</div>';
        return;
    }

    history.forEach(record => {
        const recordElement = createHistoryElement(record);
        container.appendChild(recordElement);
    });
}

// Create history element
function createHistoryElement(record) {
    const div = document.createElement('div');
    div.className = 'history-item d-flex justify-content-between align-items-center mb-2 p-2 border rounded';

    const date = window.formatDateTime(record.date, 'date');
    const checkIn = record.check_in_time ? window.formatDateTime(record.check_in_time, 'time') : '--:--';
    const checkOut = record.check_out_time ? window.formatDateTime(record.check_out_time, 'time') : '--:--';
    const hours = record.working_hours ? `${record.working_hours.toFixed(1)}h` : '0h';

    div.innerHTML = `
        <div class="history-date">
            <strong>${date}</strong>
        </div>
        <div class="history-times text-center">
            <small class="text-muted">Vào: ${checkIn}</small><br>
            <small class="text-muted">Ra: ${checkOut}</small>
        </div>
        <div class="history-hours">
            <span class="badge bg-primary">${hours}</span>
        </div>
    `;

    return div;
}

// Load available events
async function loadAvailableEvents() {
    try {
        const response = await window.apiRequest('/api/events/available');

        if (response.success) {
            updateEventSelector(response.data);
        } else {
            console.error('Failed to load events:', response.message);
        }
    } catch (error) {
        console.error('Error loading events:', error);
    }
}

// Update event selector
function updateEventSelector(events) {
    const selector = document.getElementById('eventSelector');
    if (!selector) return;

    selector.innerHTML = '<option value="">Chấm công thường</option>';

    events.forEach(event => {
        const option = document.createElement('option');
        option.value = event.id;
        option.textContent = `${event.name} (${window.formatDateTime(event.start_time, 'datetime')})`;
        selector.appendChild(option);
    });
}

// Setup event listeners
function setupEventListeners() {
    // Manual RFID input
    const manualRFIDBtn = document.getElementById('manualRFIDBtn');
    if (manualRFIDBtn) {
        manualRFIDBtn.addEventListener('click', function () {
            const eventId = document.getElementById('eventSelector')?.value || null;
            window.processManualRFID('rfidInput', eventId);
        });
    }

    // RFID input enter key
    const rfidInput = document.getElementById('rfidInput');
    if (rfidInput) {
        rfidInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                const eventId = document.getElementById('eventSelector')?.value || null;
                window.processManualRFID('rfidInput', eventId);
            }
        });
    }

    // Event selector change
    const eventSelector = document.getElementById('eventSelector');
    if (eventSelector) {
        eventSelector.addEventListener('change', function () {
            staffDashboard.selectedEvent = this.value || null;
        });
    }

    // Refresh buttons
    const refreshStatusBtn = document.getElementById('refreshStatus');
    if (refreshStatusBtn) {
        refreshStatusBtn.addEventListener('click', loadTodayStatus);
    }

    const refreshHistoryBtn = document.getElementById('refreshHistory');
    if (refreshHistoryBtn) {
        refreshHistoryBtn.addEventListener('click', loadRecentHistory);
    }

    // Toggle RFID listening
    const toggleRFIDBtn = document.getElementById('toggleRFID');
    if (toggleRFIDBtn) {
        toggleRFIDBtn.addEventListener('click', toggleRFIDListening);
    }
}

// Setup RFID input
function setupRFIDInput() {
    const rfidInput = document.getElementById('rfidInput');
    if (rfidInput) {
        // Auto-focus on RFID input
        rfidInput.focus();

        // Prevent form submission on enter (handled by keypress event)
        rfidInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
        });

        // Clear input after processing
        rfidInput.addEventListener('blur', function () {
            setTimeout(() => {
                this.focus();
            }, 100);
        });
    }
}

// Setup auto-refresh
function setupAutoRefresh() {
    // Refresh status every 30 seconds
    setInterval(loadTodayStatus, 30000);

    // Refresh history every 2 minutes
    setInterval(loadRecentHistory, 120000);
}

// Toggle RFID listening
function toggleRFIDListening() {
    staffDashboard.rfidListening = !staffDashboard.rfidListening;

    const toggleBtn = document.getElementById('toggleRFID');
    if (toggleBtn) {
        if (staffDashboard.rfidListening) {
            toggleBtn.innerHTML = '<i class="fas fa-stop"></i> Dừng lắng nghe';
            toggleBtn.className = 'btn btn-danger btn-sm';
            showNotification('Đã bật chế độ lắng nghe RFID', 'info');
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-play"></i> Lắng nghe RFID';
            toggleBtn.className = 'btn btn-success btn-sm';
            showNotification('Đã tắt chế độ lắng nghe RFID', 'info');
        }
    }

    // Emit to server
    if (staffDashboard.socket) {
        staffDashboard.socket.emit('toggle_rfid_listening', {
            listening: staffDashboard.rfidListening
        });
    }
}

// Handle attendance update
function handleAttendanceUpdate(data) {
    // Check if it's for current user
    if (staffDashboard.currentUser && data.user.id === staffDashboard.currentUser.id) {
        // Reload today's status
        loadTodayStatus();

        // Reload history
        loadRecentHistory();

        // Show notification
        const action = data.action === 'check_in' ? 'vào làm' : 'ra về';
        showNotification(`Chấm công thành công: ${action}`, 'success');
    }
}

// Handle RFID scan
function handleRFIDScan(data) {
    if (staffDashboard.rfidListening) {
        const eventId = staffDashboard.selectedEvent;
        window.processRFIDScan(data.card_id, eventId);
    }
}

// Update connection status
function updateConnectionStatus(isConnected) {
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
        if (isConnected) {
            indicator.className = 'status-indicator status-online';
            indicator.title = 'Kết nối bình thường';
        } else {
            indicator.className = 'status-indicator status-offline';
            indicator.title = 'Mất kết nối';
        }
    }
}

// Show notification
function showNotification(message, type = 'info') {
    if (typeof window.showMessage === 'function') {
        window.showMessage(message, type);
    }
}

// Export current month attendance
async function exportMonthlyAttendance() {
    try {
        const response = await window.apiRequest('/api/attendance/export/monthly');

        if (response.success) {
            // Create download link
            const link = document.createElement('a');
            link.href = response.data.downloadUrl;
            link.download = response.data.filename;
            link.click();

            showNotification('Xuất báo cáo thành công', 'success');
        } else {
            showNotification(response.message || 'Không thể xuất báo cáo', 'error');
        }
    } catch (error) {
        console.error('Export error:', error);
        showNotification('Lỗi khi xuất báo cáo', 'error');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('staffDashboard')) {
        initializeStaffDashboard();
    }
});

// Cleanup when page unloads
window.addEventListener('beforeunload', function () {
    if (staffDashboard.socket) {
        staffDashboard.socket.disconnect();
    }
});

// Export functions for global use
window.initializeStaffDashboard = initializeStaffDashboard;
window.loadTodayStatus = loadTodayStatus;
window.loadRecentHistory = loadRecentHistory;
window.exportMonthlyAttendance = exportMonthlyAttendance;