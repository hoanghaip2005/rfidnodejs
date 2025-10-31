// Admin dashboard functionality

let adminDashboard = {
    stats: {},
    activities: [],
    socket: null,
    intervals: {}
};

// Initialize admin dashboard
function initializeAdminDashboard() {
    console.log('Initializing admin dashboard...');

    // Initialize Socket.IO
    initializeSocket();

    // Load initial data
    loadDashboardStats();
    loadRecentActivities();
    loadSystemStatus();

    // Setup periodic updates
    setupPeriodicUpdates();

    // Setup event listeners
    setupEventListeners();

    // Initialize charts if needed
    initializeCharts();
}

// Initialize Socket.IO connection
function initializeSocket() {
    if (typeof io !== 'undefined') {
        adminDashboard.socket = io();

        adminDashboard.socket.on('connect', function () {
            console.log('Socket connected');
            updateConnectionStatus(true);
        });

        adminDashboard.socket.on('disconnect', function () {
            console.log('Socket disconnected');
            updateConnectionStatus(false);
        });

        // Listen for real-time updates
        adminDashboard.socket.on('attendance_update', function (data) {
            handleAttendanceUpdate(data);
        });

        adminDashboard.socket.on('user_activity', function (data) {
            handleUserActivity(data);
        });

        adminDashboard.socket.on('system_alert', function (data) {
            handleSystemAlert(data);
        });

        adminDashboard.socket.on('stats_update', function (data) {
            updateDashboardStats(data);
        });
    }
}

// Load dashboard statistics
async function loadDashboardStats() {
    try {
        const response = await window.apiRequest('/api/admin/stats');

        if (response.success) {
            adminDashboard.stats = response.data;
            updateStatsDisplay(response.data);
        } else {
            console.error('Failed to load stats:', response.message);
            window.showMessage('Không thể tải thống kê', 'error');
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        window.showMessage('Lỗi khi tải thống kê', 'error');
    }
}

// Update statistics display
function updateStatsDisplay(stats) {
    // Update stat cards
    updateStatCard('totalUsers', stats.totalUsers, 'người dùng');
    updateStatCard('todayAttendance', stats.todayAttendance, 'lượt chấm công hôm nay');
    updateStatCard('activeEvents', stats.activeEvents, 'sự kiện đang diễn ra');
    updateStatCard('systemUptime', stats.systemUptime, 'thời gian hoạt động');

    // Update progress bars
    updateProgressBar('attendanceProgress', stats.attendanceRate);
    updateProgressBar('eventProgress', stats.eventParticipationRate);

    // Update last update time
    const lastUpdate = document.getElementById('lastStatsUpdate');
    if (lastUpdate) {
        lastUpdate.textContent = `Cập nhật lần cuối: ${window.formatDateTime(new Date(), 'time')}`;
    }
}

// Update individual stat card
function updateStatCard(elementId, value, label) {
    const element = document.getElementById(elementId);
    if (element) {
        const valueElement = element.querySelector('.stat-value');
        const labelElement = element.querySelector('.stat-label');

        if (valueElement) {
            valueElement.textContent = formatStatValue(value);
        }

        if (labelElement) {
            labelElement.textContent = label;
        }
    }
}

// Update progress bar
function updateProgressBar(elementId, percentage) {
    const progressBar = document.getElementById(elementId);
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);
        progressBar.textContent = `${percentage}%`;
    }
}

// Format stat values
function formatStatValue(value) {
    if (typeof value === 'number') {
        return value.toLocaleString('vi-VN');
    }
    return value;
}

// Load recent activities
async function loadRecentActivities() {
    try {
        const response = await window.apiRequest('/api/admin/activities');

        if (response.success) {
            adminDashboard.activities = response.data;
            updateActivitiesDisplay(response.data);
        } else {
            console.error('Failed to load activities:', response.message);
        }
    } catch (error) {
        console.error('Error loading activities:', error);
    }
}

// Update activities display
function updateActivitiesDisplay(activities) {
    const container = document.getElementById('recentActivities');
    if (!container) return;

    container.innerHTML = '';

    if (activities.length === 0) {
        container.innerHTML = '<div class="text-muted text-center">Chưa có hoạt động nào</div>';
        return;
    }

    activities.forEach(activity => {
        const activityElement = createActivityElement(activity);
        container.appendChild(activityElement);
    });
}

// Create activity element
function createActivityElement(activity) {
    const div = document.createElement('div');
    div.className = 'activity-item d-flex align-items-center mb-3';

    const iconClass = getActivityIcon(activity.type);
    const timeAgo = getTimeAgo(activity.created_at);

    div.innerHTML = `
        <div class="activity-icon me-3">
            <i class="fas fa-${iconClass}"></i>
        </div>
        <div class="activity-content flex-grow-1">
            <div class="activity-title">${activity.title}</div>
            <div class="activity-description text-muted small">${activity.description}</div>
        </div>
        <div class="activity-time text-muted small">
            ${timeAgo}
        </div>
    `;

    return div;
}

// Get icon for activity type
function getActivityIcon(type) {
    const icons = {
        'attendance': 'clock',
        'user': 'user',
        'event': 'calendar',
        'system': 'cog',
        'security': 'shield-alt',
        'error': 'exclamation-triangle'
    };

    return icons[type] || 'info-circle';
}

// Get time ago string
function getTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) {
        return 'Vừa xong';
    } else if (diffMins < 60) {
        return `${diffMins} phút trước`;
    } else if (diffHours < 24) {
        return `${diffHours} giờ trước`;
    } else if (diffDays < 7) {
        return `${diffDays} ngày trước`;
    } else {
        return window.formatDateTime(timestamp, 'date');
    }
}

// Load system status
async function loadSystemStatus() {
    try {
        const response = await window.apiRequest('/api/admin/system-status');

        if (response.success) {
            updateSystemStatus(response.data);
        }
    } catch (error) {
        console.error('Error loading system status:', error);
    }
}

// Update system status display
function updateSystemStatus(status) {
    // Update connection status
    updateConnectionStatus(status.database);

    // Update RFID status
    updateRFIDStatus(status.rfid);

    // Update system health
    updateSystemHealth(status.health);
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

// Update RFID status
function updateRFIDStatus(status) {
    const indicator = document.getElementById('rfidStatus');
    if (indicator) {
        if (status.connected) {
            indicator.className = 'status-indicator status-online';
            indicator.title = `RFID kết nối: ${status.port || 'N/A'}`;
        } else {
            indicator.className = 'status-indicator status-offline';
            indicator.title = 'RFID không kết nối';
        }
    }
}

// Update system health
function updateSystemHealth(health) {
    const indicator = document.getElementById('systemHealth');
    if (indicator) {
        const healthClass = health > 80 ? 'status-online' :
            health > 60 ? 'status-warning' : 'status-offline';

        indicator.className = `status-indicator ${healthClass}`;
        indicator.title = `Sức khỏe hệ thống: ${health}%`;
    }
}

// Setup periodic updates
function setupPeriodicUpdates() {
    // Update stats every 30 seconds
    adminDashboard.intervals.stats = setInterval(loadDashboardStats, 30000);

    // Update activities every 60 seconds
    adminDashboard.intervals.activities = setInterval(loadRecentActivities, 60000);

    // Update system status every 10 seconds
    adminDashboard.intervals.system = setInterval(loadSystemStatus, 10000);
}

// Setup event listeners
function setupEventListeners() {
    // Refresh buttons
    const refreshStatsBtn = document.getElementById('refreshStats');
    if (refreshStatsBtn) {
        refreshStatsBtn.addEventListener('click', loadDashboardStats);
    }

    const refreshActivitiesBtn = document.getElementById('refreshActivities');
    if (refreshActivitiesBtn) {
        refreshActivitiesBtn.addEventListener('click', loadRecentActivities);
    }

    // Settings button
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettings);
    }

    // Export data button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportData);
    }
}

// Handle real-time attendance update
function handleAttendanceUpdate(data) {
    // Add to activities
    const activity = {
        type: 'attendance',
        title: `${data.user.name} đã ${data.action === 'check_in' ? 'vào' : 'ra'}`,
        description: `Thời gian: ${window.formatDateTime(data.time)}`,
        created_at: data.time
    };

    adminDashboard.activities.unshift(activity);
    if (adminDashboard.activities.length > 50) {
        adminDashboard.activities.pop();
    }

    updateActivitiesDisplay(adminDashboard.activities);

    // Update stats
    if (adminDashboard.stats.todayAttendance !== undefined) {
        adminDashboard.stats.todayAttendance++;
        updateStatCard('todayAttendance', adminDashboard.stats.todayAttendance, 'lượt chấm công hôm nay');
    }

    // Show notification
    showNotification(`${data.user.name} đã ${data.action === 'check_in' ? 'vào làm' : 'ra về'}`, 'info');
}

// Handle user activity
function handleUserActivity(data) {
    const activity = {
        type: 'user',
        title: data.title,
        description: data.description,
        created_at: data.timestamp
    };

    adminDashboard.activities.unshift(activity);
    updateActivitiesDisplay(adminDashboard.activities);
}

// Handle system alert
function handleSystemAlert(data) {
    showNotification(data.message, data.type || 'warning');

    const activity = {
        type: 'system',
        title: 'Cảnh báo hệ thống',
        description: data.message,
        created_at: new Date().toISOString()
    };

    adminDashboard.activities.unshift(activity);
    updateActivitiesDisplay(adminDashboard.activities);
}

// Show notification
function showNotification(message, type = 'info') {
    if (typeof window.showMessage === 'function') {
        window.showMessage(message, type);
    }
}

// Initialize charts (placeholder for future chart implementation)
function initializeCharts() {
    // TODO: Implement charts using Chart.js or similar library
    console.log('Charts initialization placeholder');
}

// Open settings modal
function openSettings() {
    // TODO: Implement settings modal
    console.log('Settings modal placeholder');
    window.showMessage('Tính năng cài đặt đang được phát triển', 'info');
}

// Export data
async function exportData() {
    try {
        const response = await window.apiRequest('/api/admin/export');

        if (response.success) {
            // Create download link
            const link = document.createElement('a');
            link.href = response.data.downloadUrl;
            link.download = response.data.filename;
            link.click();

            window.showMessage('Xuất dữ liệu thành công', 'success');
        } else {
            window.showMessage(response.message || 'Không thể xuất dữ liệu', 'error');
        }
    } catch (error) {
        console.error('Export error:', error);
        window.showMessage('Lỗi khi xuất dữ liệu', 'error');
    }
}

// Cleanup function
function cleanupAdminDashboard() {
    // Clear intervals
    Object.values(adminDashboard.intervals).forEach(interval => {
        clearInterval(interval);
    });

    // Disconnect socket
    if (adminDashboard.socket) {
        adminDashboard.socket.disconnect();
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('adminDashboard')) {
        initializeAdminDashboard();
    }
});

// Cleanup when page unloads
window.addEventListener('beforeunload', cleanupAdminDashboard);

// Export functions for global use
window.initializeAdminDashboard = initializeAdminDashboard;
window.loadDashboardStats = loadDashboardStats;
window.loadRecentActivities = loadRecentActivities;