// Socket.IO handlers for real-time features
const { RFIDService } = require('./RFIDService');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const moment = require('moment-timezone');

class SocketIOHandlers {
    constructor(io, rfidService) {
        this.io = io;
        this.rfidService = rfidService;
        this.connectedClients = new Map();
        this.adminClients = new Set();
        this.staffClients = new Set();

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            console.log('🔌 Client connected:', socket.id);

            this.handleConnection(socket);
            this.setupSocketEventListeners(socket);
        });

        // Setup RFID service event listeners
        this.setupRFIDEventListeners();
    }

    handleConnection(socket) {
        // Store client connection info
        this.connectedClients.set(socket.id, {
            connectedAt: new Date(),
            userAgent: socket.handshake.headers['user-agent'],
            ip: socket.handshake.address
        });

        // Send initial status to client
        socket.emit('system_status', {
            server: {
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            },
            rfid: this.rfidService.getStatus(),
            database: { connected: true },
            connectedClients: this.connectedClients.size
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('🔌 Client disconnected:', socket.id);
            this.connectedClients.delete(socket.id);
            this.adminClients.delete(socket.id);
            this.staffClients.delete(socket.id);
        });
    }

    setupSocketEventListeners(socket) {
        // User authentication/identification
        socket.on('authenticate', async (data) => {
            try {
                if (data.userId) {
                    const user = await User.findById(data.userId);
                    if (user) {
                        const clientInfo = this.connectedClients.get(socket.id);
                        if (clientInfo) {
                            clientInfo.user = user;

                            // Add to role-based client sets
                            if (user.role === 'admin') {
                                this.adminClients.add(socket.id);
                            } else if (user.role === 'staff' || user.role === 'at_work') {
                                this.staffClients.add(socket.id);
                            }
                        }

                        socket.emit('authenticated', {
                            success: true,
                            user: user.toJSON()
                        });

                        console.log(`👤 User authenticated: ${user.username} (${socket.id})`);
                    }
                }
            } catch (error) {
                console.error('Authentication error:', error);
                socket.emit('authenticated', { success: false, error: 'Authentication failed' });
            }
        });

        // Manual RFID scan (for R65D keyboard mode or manual input)
        socket.on('manual_rfid_scan', async (data) => {
            try {
                if (data && data.cardId) {
                    console.log(`📱 Manual RFID scan: ${data.cardId} from ${socket.id}`);
                    await this.processRFIDScan(data.cardId, data.eventId, socket);
                }
            } catch (error) {
                console.error('Manual RFID scan error:', error);
                socket.emit('rfid_error', {
                    error: 'Manual scan failed',
                    details: error.message
                });
            }
        });

        // Toggle RFID listening for specific client
        socket.on('toggle_rfid_listening', (data) => {
            const clientInfo = this.connectedClients.get(socket.id);
            if (clientInfo) {
                clientInfo.listeningToRFID = data.listening;
                console.log(`🎧 RFID listening ${data.listening ? 'enabled' : 'disabled'} for ${socket.id}`);
            }
        });

        // Request real-time stats (for admin dashboard)
        socket.on('request_stats', async () => {
            try {
                const stats = await this.generateDashboardStats();
                socket.emit('stats_update', stats);
            } catch (error) {
                console.error('Stats request error:', error);
                socket.emit('stats_error', { error: 'Failed to get stats' });
            }
        });

        // Request attendance history
        socket.on('request_attendance_history', async (data) => {
            try {
                const { userId, limit = 10 } = data;
                const today = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

                let attendance;
                if (userId) {
                    attendance = await Attendance.findByDateRange(today, today, userId);
                } else {
                    attendance = await Attendance.findByDateRange(
                        moment().subtract(7, 'days').format('YYYY-MM-DD'),
                        today
                    );
                }

                socket.emit('attendance_history', {
                    success: true,
                    data: attendance.slice(0, limit)
                });
            } catch (error) {
                console.error('Attendance history request error:', error);
                socket.emit('attendance_history', {
                    success: false,
                    error: 'Failed to get attendance history'
                });
            }
        });

        // Join admin room for admin-specific broadcasts
        socket.on('join_admin_room', () => {
            const clientInfo = this.connectedClients.get(socket.id);
            if (clientInfo?.user?.role === 'admin') {
                socket.join('admin');
                console.log(`👑 Admin joined room: ${clientInfo.user.username}`);
            }
        });

        // Join staff room for staff-specific broadcasts
        socket.on('join_staff_room', () => {
            const clientInfo = this.connectedClients.get(socket.id);
            if (clientInfo?.user && ['staff', 'at_work'].includes(clientInfo.user.role)) {
                socket.join('staff');
                console.log(`👷 Staff joined room: ${clientInfo.user.username}`);
            }
        });
    }

    setupRFIDEventListeners() {
        // RFID device connection status
        this.rfidService.on('connected', (deviceInfo) => {
            console.log('📡 RFID Reader connected:', deviceInfo);
            this.io.emit('rfid_status', {
                connected: true,
                device: deviceInfo,
                timestamp: new Date().toISOString()
            });
        });

        this.rfidService.on('disconnected', () => {
            console.log('📡 RFID Reader disconnected');
            this.io.emit('rfid_status', {
                connected: false,
                timestamp: new Date().toISOString()
            });
        });

        this.rfidService.on('error', (error) => {
            console.error('📡 RFID Reader error:', error);
            this.io.emit('rfid_error', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
        });

        // RFID scan detected from hardware
        this.rfidService.on('scan', async (scanData) => {
            console.log('📱 RFID scan detected:', scanData);

            // Process the scan
            await this.processRFIDScan(scanData.cardId, null, null);
        });

        // RFID anti-spam detection
        this.rfidService.on('spam', (spamData) => {
            console.log('🚫 RFID spam detected:', spamData);
            this.io.emit('rfid_spam', {
                cardId: spamData.cardId,
                message: 'Duplicate scan detected within spam interval',
                timestamp: new Date().toISOString()
            });
        });
    }

    async processRFIDScan(cardId, eventId = null, originSocket = null) {
        try {
            console.log(`🔍 Processing RFID scan: ${cardId}`);

            // Find user by RFID card (assuming card ID maps to user ID)
            const user = await User.findById(cardId);
            if (!user) {
                const errorMsg = `User not found for RFID card: ${cardId}`;
                console.log(`❌ ${errorMsg}`);

                if (originSocket) {
                    originSocket.emit('attendance_error', {
                        error: 'USER_NOT_FOUND',
                        message: 'Không tìm thấy người dùng với thẻ RFID này',
                        cardId
                    });
                }
                return;
            }

            const now = moment().tz('Asia/Ho_Chi_Minh');
            const today = now.format('YYYY-MM-DD');

            // Check for recent duplicate scans
            const isDuplicate = await Attendance.checkDuplicateScan(user.id, cardId, 5);
            if (isDuplicate) {
                const errorMsg = `Duplicate scan detected for ${user.username}`;
                console.log(`🚫 ${errorMsg}`);

                if (originSocket) {
                    originSocket.emit('attendance_error', {
                        error: 'DUPLICATE_SCAN',
                        message: 'Thao tác quá nhanh. Vui lòng đợi 5 giây.',
                        cardId
                    });
                }
                return;
            }

            // Get last scan to determine action (check in/out)
            const lastScan = await Attendance.getLastScanForUser(user.id, today);
            const actionType = (!lastScan || lastScan.actionType === 'check_out') ? 'check_in' : 'check_out';

            // Record attendance
            const attendanceData = {
                userId: user.id,
                rfidCard: cardId,
                scanTime: now.toISOString(),
                scanDate: today,
                actionType,
                eventId,
                status: 'valid'
            };

            const attendance = await Attendance.recordAttendance(attendanceData);

            console.log(`✅ Attendance recorded: ${user.username} - ${actionType}`);

            // Broadcast to all clients
            const broadcastData = {
                success: true,
                user: user.toJSON(),
                action: actionType,
                time: now.toISOString(),
                event: eventId ? { id: eventId } : null,
                attendance: attendance
            };

            this.io.emit('attendance_processed', broadcastData);

            // Send specific notification to admin clients
            this.io.to('admin').emit('attendance_notification', {
                type: 'attendance',
                message: `${user.name} đã ${actionType === 'check_in' ? 'vào làm' : 'ra về'}`,
                user: user.toJSON(),
                action: actionType,
                timestamp: now.toISOString()
            });

            // Send confirmation to origin socket if specified
            if (originSocket) {
                originSocket.emit('attendance_success', {
                    message: `Chấm công thành công: ${actionType === 'check_in' ? 'Vào làm' : 'Ra về'}`,
                    user: user.toJSON(),
                    action: actionType,
                    time: now.toISOString()
                });
            }

            // Update work session
            await this.updateWorkSession(user.id, actionType, now);

        } catch (error) {
            console.error('❌ RFID scan processing error:', error);

            if (originSocket) {
                originSocket.emit('attendance_error', {
                    error: 'PROCESSING_ERROR',
                    message: 'Đã xảy ra lỗi khi xử lý chấm công',
                    details: error.message
                });
            }
        }
    }

    async updateWorkSession(userId, actionType, timestamp) {
        try {
            const today = timestamp.format('YYYY-MM-DD');

            // This would integrate with work_sessions table
            // Implementation depends on business logic requirements
            console.log(`📊 Work session update: ${userId} - ${actionType} at ${timestamp.format()}`);

        } catch (error) {
            console.error('Work session update error:', error);
        }
    }

    async generateDashboardStats() {
        try {
            const today = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

            // Get today's attendance count
            const todayAttendance = await Attendance.findByDateRange(today, today);

            // Get total users
            const totalUsers = await User.findAll();

            // Calculate stats
            const stats = {
                totalUsers: totalUsers.length,
                todayAttendance: todayAttendance.length,
                activeUsers: totalUsers.filter(u => u.isActive).length,
                systemUptime: Math.floor(process.uptime()),
                connectedClients: this.connectedClients.size,
                rfidStatus: this.rfidService.getStatus(),
                timestamp: new Date().toISOString()
            };

            return stats;
        } catch (error) {
            console.error('Stats generation error:', error);
            throw error;
        }
    }

    // Broadcast system notification to all clients
    broadcastSystemNotification(message, type = 'info', targetRole = null) {
        const notification = {
            type,
            message,
            timestamp: new Date().toISOString()
        };

        if (targetRole === 'admin') {
            this.io.to('admin').emit('system_notification', notification);
        } else if (targetRole === 'staff') {
            this.io.to('staff').emit('system_notification', notification);
        } else {
            this.io.emit('system_notification', notification);
        }
    }

    // Get connection statistics
    getConnectionStats() {
        return {
            totalConnections: this.connectedClients.size,
            adminConnections: this.adminClients.size,
            staffConnections: this.staffClients.size,
            clients: Array.from(this.connectedClients.entries()).map(([id, info]) => ({
                id,
                user: info.user?.username || 'anonymous',
                connectedAt: info.connectedAt,
                listeningToRFID: info.listeningToRFID || false
            }))
        };
    }
}

module.exports = SocketIOHandlers;