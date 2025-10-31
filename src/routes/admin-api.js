const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { requireAuth, requireRole } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const { executeQuery } = require('../config/database');
const moment = require('moment-timezone');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

// Configure multer for file upload
const upload = multer({
    dest: 'uploads/temp/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.xlsx' && ext !== '.xls') {
            return cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls)'));
        }
        cb(null, true);
    }
});

// Ensure upload directory exists
if (!fs.existsSync('uploads/temp')) {
    fs.mkdirSync('uploads/temp', { recursive: true });
}

// Apply API rate limiting and admin role requirement
router.use(apiLimiter);
router.use(requireAuth);
router.use(requireRole('admin'));

// ==================== USER MANAGEMENT ====================

// Get users with pagination and filtering
router.get('/users', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', role = '', status = '' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;

        let whereConditions = [];
        let queryParams = [];

        // Search filter
        if (search) {
            whereConditions.push('(name LIKE ? OR email LIKE ?)');
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        // Role filter
        if (role) {
            whereConditions.push('role = ?');
            queryParams.push(role);
        }

        // Status filter
        if (status) {
            whereConditions.push('status = ?');
            queryParams.push(status);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
        const [countResult] = await executeQuery(countQuery, queryParams);
        const total = countResult.total;

        // Get paginated users
        const usersQuery = `
            SELECT id, name, email, role, status, department, phone, rfidCard, 
                   createdAt, updatedAt, notes
            FROM users 
            ${whereClause}
            ORDER BY createdAt DESC 
            LIMIT ? OFFSET ?
        `;
        const users = await executeQuery(usersQuery, [...queryParams, limitNum, offset]);

        // Get statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin,
                SUM(CASE WHEN role = 'staff' THEN 1 ELSE 0 END) as staff
            FROM users
        `;
        const [statistics] = await executeQuery(statsQuery);

        res.json({
            success: true,
            data: {
                users: users,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: total,
                    totalPages: Math.ceil(total / limitNum),
                    hasNext: offset + limitNum < total,
                    hasPrev: pageNum > 1
                },
                statistics: statistics
            }
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_USERS_ERROR',
            message: 'Không thể tải danh sách người dùng'
        });
    }
});

// Search users (must be before /users/:id to avoid conflict)
router.get('/users/search', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length < 2) {
            return res.json({
                success: true,
                data: []
            });
        }

        const searchTerm = `%${q.trim()}%`;
        const users = await executeQuery(`
            SELECT id, name, username 
            FROM users 
            WHERE id LIKE ? OR name LIKE ? OR username LIKE ?
            LIMIT 10
        `, [searchTerm, searchTerm, searchTerm]);

        // Map id to employee_id for frontend compatibility
        const mappedUsers = users.map(user => ({
            id: user.id,
            employee_id: user.id,
            name: user.name,
            username: user.username
        }));

        res.json({
            success: true,
            data: mappedUsers
        });
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({
            success: false,
            error: 'SEARCH_USERS_ERROR',
            message: 'Không thể tìm kiếm người dùng'
        });
    }
});

// Get single user
router.get('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy người dùng'
            });
        }

        res.json({
            success: true,
            data: user
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_USER_ERROR',
            message: 'Không thể tải thông tin người dùng'
        });
    }
});

// Create new user
router.post('/users', async (req, res) => {
    try {
        const { employee_id, name, department, username, password, role = 'staff' } = req.body;

        // Validate required fields
        if (!employee_id || !name || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'Vui lòng điền đầy đủ thông tin bắt buộc (ID, Tên, Username, Password)'
            });
        }

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_PASSWORD',
                message: 'Mật khẩu phải có ít nhất 6 ký tự'
            });
        }

        // Check if employee_id (id) already exists
        const existingId = await executeQuery('SELECT id FROM users WHERE id = ?', [employee_id]);
        if (existingId.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'EMPLOYEE_ID_EXISTS',
                message: 'Mã nhân viên này đã tồn tại'
            });
        }

        // Check if username already exists
        const existingUsername = await executeQuery('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsername.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'USERNAME_EXISTS',
                message: 'Tên đăng nhập này đã được sử dụng'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user - use employee_id as id (PRIMARY KEY)
        await executeQuery(
            `INSERT INTO users (id, name, department, username, password, role, is_active, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
            [employee_id, name, department || null, username, hashedPassword, role]
        );

        // Get created user
        const newUser = await executeQuery('SELECT id, name, department, username, role FROM users WHERE id = ?', [employee_id]);

        res.status(201).json({
            success: true,
            message: 'Tạo tài khoản thành công',
            data: {
                ...newUser[0],
                employee_id: newUser[0].id // Map id to employee_id for frontend
            }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            success: false,
            error: 'CREATE_USER_ERROR',
            message: 'Không thể tạo người dùng: ' + error.message
        });
    }
});

// Reset user password
router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_PASSWORD',
                message: 'Mật khẩu phải có ít nhất 6 ký tự'
            });
        }

        // Check if user exists
        const user = await executeQuery('SELECT id FROM users WHERE id = ?', [id]);
        if (user.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Người dùng không tồn tại'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await executeQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, id]);

        res.json({
            success: true,
            message: 'Cấp lại mật khẩu thành công'
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            error: 'RESET_PASSWORD_ERROR',
            message: 'Không thể cấp lại mật khẩu'
        });
    }
});

// Update user
router.put('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const { name, email, role, status, department, phone, rfidCard, notes, resetPassword } = req.body;

        // Check if user exists
        const existingUser = await User.findById(userId);
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy người dùng'
            });
        }

        // Check if email is taken by another user
        if (email && email !== existingUser.email) {
            const emailUser = await User.findByEmail(email);
            if (emailUser && emailUser.id !== parseInt(userId)) {
                return res.status(409).json({
                    success: false,
                    error: 'EMAIL_EXISTS',
                    message: 'Email này đã được sử dụng bởi người dùng khác'
                });
            }
        }

        // Check if RFID card is taken by another user
        if (rfidCard && rfidCard !== existingUser.rfidCard) {
            const rfidUser = await User.findByRfidCard(rfidCard);
            if (rfidUser && rfidUser.id !== parseInt(userId)) {
                return res.status(409).json({
                    success: false,
                    error: 'RFID_EXISTS',
                    message: 'RFID card này đã được sử dụng bởi người dùng khác'
                });
            }
        }

        // Prepare update data
        const updateData = {
            name: name || existingUser.name,
            email: email || existingUser.email,
            role: role || existingUser.role,
            status: status || existingUser.status,
            department,
            phone,
            rfidCard,
            notes
        };

        // Reset password if requested
        if (resetPassword) {
            const defaultPassword = '123456';
            updateData.password = await bcrypt.hash(defaultPassword, 10);
        }

        // Update user
        const updatedUser = await User.update(userId, updateData);

        // Emit real-time update
        req.io.to('admin').emit('user_updated', {
            user: { ...updatedUser, password: undefined },
            admin: req.user.name
        });

        res.json({
            success: true,
            message: 'Cập nhật người dùng thành công',
            data: { ...updatedUser, password: undefined }
        });

    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            error: 'UPDATE_USER_ERROR',
            message: 'Không thể cập nhật người dùng'
        });
    }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // Check if user exists
        const existingUser = await User.findById(userId);
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy người dùng'
            });
        }

        // Prevent deleting self
        if (parseInt(userId) === req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'CANNOT_DELETE_SELF',
                message: 'Không thể xóa chính mình'
            });
        }

        // Delete user (attendance records will be kept for historical data)
        await User.delete(userId);

        // Emit real-time update
        req.io.to('admin').emit('user_deleted', {
            user: { ...existingUser, password: undefined },
            admin: req.user.name
        });

        res.json({
            success: true,
            message: 'Xóa người dùng thành công'
        });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'DELETE_USER_ERROR',
            message: 'Không thể xóa người dùng'
        });
    }
});

// ==================== REPORTS ====================

// Get attendance report statistics
router.get('/reports/stats', async (req, res) => {
    try {
        const today = moment().tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM users WHERE status = 'active') as totalEmployees,
                (SELECT COUNT(DISTINCT userId) FROM attendances WHERE scanDate = ?) as presentToday,
                (SELECT COUNT(DISTINCT userId) FROM attendances 
                 WHERE scanDate = ? AND actionType = 'check_in' 
                 AND TIME(scanTime) > '08:30:00') as lateToday
        `;

        const [stats] = await executeQuery(statsQuery, [today, today]);

        // Calculate attendance rate
        const attendanceRate = stats.totalEmployees > 0
            ? Math.round((stats.presentToday / stats.totalEmployees) * 100)
            : 0;

        res.json({
            success: true,
            data: {
                ...stats,
                attendanceRate
            }
        });

    } catch (error) {
        console.error('Get report stats error:', error);
        res.status(500).json({
            success: false,
            error: 'REPORT_STATS_ERROR',
            message: 'Không thể tải thống kê báo cáo'
        });
    }
});

// Generate attendance report
router.get('/reports/attendance', async (req, res) => {
    try {
        const { startDate, endDate, userId, reportType = 'daily' } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_DATE_RANGE',
                message: 'Vui lòng chọn khoảng thời gian'
            });
        }

        let whereConditions = ['a.scanDate BETWEEN ? AND ?'];
        let queryParams = [startDate, endDate];

        if (userId) {
            whereConditions.push('a.userId = ?');
            queryParams.push(userId);
        }

        const whereClause = whereConditions.join(' AND ');

        // Get attendance records grouped by user and date
        const reportQuery = `
            SELECT 
                a.userId,
                u.name as userName,
                u.email as userEmail,
                u.department,
                a.scanDate as date,
                MIN(CASE WHEN a.actionType = 'check_in' THEN a.scanTime END) as firstCheckIn,
                MAX(CASE WHEN a.actionType = 'check_out' THEN a.scanTime END) as lastCheckOut,
                COUNT(CASE WHEN a.actionType = 'check_in' THEN 1 END) as checkInCount,
                COUNT(CASE WHEN a.actionType = 'check_out' THEN 1 END) as checkOutCount
            FROM attendances a
            INNER JOIN users u ON a.userId = u.id
            WHERE ${whereClause}
            GROUP BY a.userId, u.name, u.email, u.department, a.scanDate
            ORDER BY a.scanDate DESC, u.name ASC
        `;

        const records = await executeQuery(reportQuery, queryParams);

        // Calculate total hours for each record
        const processedRecords = records.map(record => {
            let totalHours = 0;
            if (record.firstCheckIn && record.lastCheckOut) {
                const checkIn = moment(record.firstCheckIn);
                const checkOut = moment(record.lastCheckOut);
                totalHours = checkOut.diff(checkIn, 'hours', true);
            }

            return {
                ...record,
                totalHours: Math.max(0, totalHours) // Ensure non-negative hours
            };
        });

        res.json({
            success: true,
            data: {
                records: processedRecords,
                summary: {
                    totalRecords: processedRecords.length,
                    dateRange: { startDate, endDate },
                    reportType
                }
            }
        });

    } catch (error) {
        console.error('Generate attendance report error:', error);
        res.status(500).json({
            success: false,
            error: 'GENERATE_REPORT_ERROR',
            message: 'Không thể tạo báo cáo chấm công'
        });
    }
});

// Get detailed attendance for specific user and date
router.get('/reports/detail', async (req, res) => {
    try {
        const { userId, date } = req.query;

        if (!userId || !date) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_PARAMETERS',
                message: 'Thiếu thông tin userId hoặc date'
            });
        }

        // Get user info
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy người dùng'
            });
        }

        // Get attendance records for the day
        const records = await Attendance.findByUserAndDate(userId, date);

        // Calculate summary
        let totalHours = 0;
        const checkIns = records.filter(r => r.actionType === 'check_in');
        const checkOuts = records.filter(r => r.actionType === 'check_out');

        for (let i = 0; i < Math.min(checkIns.length, checkOuts.length); i++) {
            const checkInTime = moment(checkIns[i].scanTime);
            const checkOutTime = moment(checkOuts[i].scanTime);
            totalHours += checkOutTime.diff(checkInTime, 'hours', true);
        }

        res.json({
            success: true,
            data: {
                user: { ...user, password: undefined },
                date,
                records,
                summary: {
                    totalHours: Math.round(totalHours * 100) / 100,
                    checkInCount: checkIns.length,
                    checkOutCount: checkOuts.length
                }
            }
        });

    } catch (error) {
        console.error('Get attendance detail error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_DETAIL_ERROR',
            message: 'Không thể tải chi tiết chấm công'
        });
    }
});

// ==================== SYSTEM MANAGEMENT ====================

// Get system status
router.get('/system/status', async (req, res) => {
    try {
        // Get online users count (this would require tracking connected users)
        const onlineUsers = req.io.engine.clientsCount || 0;

        res.json({
            success: true,
            data: {
                server: {
                    status: 'online',
                    uptime: process.uptime(),
                    timestamp: moment().tz('Asia/Ho_Chi_Minh').format()
                },
                database: {
                    connected: true, // This should be checked dynamically
                    type: process.env.DB_TYPE || 'mysql'
                },
                rfid: {
                    connected: true, // This should be checked from RFIDService
                    port: process.env.RFID_PORT || 'COM3'
                },
                onlineUsers
            }
        });

    } catch (error) {
        console.error('Get system status error:', error);
        res.status(500).json({
            success: false,
            error: 'SYSTEM_STATUS_ERROR',
            message: 'Không thể lấy trạng thái hệ thống'
        });
    }
});

// Get system information
router.get('/system/info', async (req, res) => {
    try {
        const packageJson = require('../../package.json');

        res.json({
            success: true,
            data: {
                version: packageJson.version,
                nodeVersion: process.version,
                uptime: process.uptime(),
                platform: process.platform,
                arch: process.arch,
                memory: process.memoryUsage()
            }
        });

    } catch (error) {
        console.error('Get system info error:', error);
        res.status(500).json({
            success: false,
            error: 'SYSTEM_INFO_ERROR',
            message: 'Không thể lấy thông tin hệ thống'
        });
    }
});

// System restart
router.post('/system/restart', async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Hệ thống đang khởi động lại...'
        });

        // Emit notification to all users
        req.io.emit('system_restart', {
            message: 'Hệ thống đang khởi động lại. Vui lòng chờ...',
            timestamp: moment().tz('Asia/Ho_Chi_Minh').format()
        });

        // Restart after a delay
        setTimeout(() => {
            process.exit(0);
        }, 2000);

    } catch (error) {
        console.error('System restart error:', error);
        res.status(500).json({
            success: false,
            error: 'RESTART_ERROR',
            message: 'Không thể khởi động lại hệ thống'
        });
    }
});

// ==================== SETTINGS MANAGEMENT ====================

// Get settings
router.get('/settings', async (req, res) => {
    try {
        // In a real implementation, these would come from a settings table or config file
        const settings = {
            general: {
                systemName: 'RFID Attendance System',
                timezone: 'Asia/Ho_Chi_Minh',
                language: 'vi',
                maintenanceMode: false
            },
            attendance: {
                workStartTime: '08:00',
                workEndTime: '17:00',
                lateThreshold: 30,
                antiSpamDelay: 5,
                allowWeekendWork: true
            },
            security: {
                networkRestriction: true,
                allowedNetworks: 'CompanyWiFi,Office_5G',
                companyGateway: '192.168.1.1',
                rateLimit: 60,
                detailedLogging: true
            },
            rfid: {
                comPort: 'COM3',
                baudRate: 9600,
                autoReconnect: true,
                testMode: false
            }
        };

        res.json({
            success: true,
            data: settings
        });

    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_SETTINGS_ERROR',
            message: 'Không thể tải cài đặt'
        });
    }
});

// Update settings
router.put('/settings/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const settings = req.body;

        // In a real implementation, save to database or config file
        console.log(`Updating ${category} settings:`, settings);

        res.json({
            success: true,
            message: `Đã cập nhật cài đặt ${category}`
        });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({
            success: false,
            error: 'UPDATE_SETTINGS_ERROR',
            message: 'Không thể cập nhật cài đặt'
        });
    }
});

// ==================== LOCATION MANAGEMENT ====================

// Get all locations
router.get('/locations', async (req, res) => {
    try {
        const locations = await executeQuery('SELECT * FROM locations ORDER BY name ASC');

        res.json({
            success: true,
            data: locations
        });
    } catch (error) {
        console.error('Get locations error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_LOCATIONS_ERROR',
            message: 'Không thể tải danh sách locations'
        });
    }
});

// Add location
router.post('/locations', async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_INPUT',
                message: 'Tên location không được để trống'
            });
        }

        // Check if location already exists
        const existing = await executeQuery('SELECT id FROM locations WHERE name = ?', [name.trim()]);
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'LOCATION_EXISTS',
                message: 'Location đã tồn tại'
            });
        }

        // Insert new location
        const result = await executeQuery('INSERT INTO locations (name) VALUES (?)', [name.trim()]);

        res.json({
            success: true,
            message: 'Thêm location thành công',
            data: {
                id: result.insertId,
                name: name.trim()
            }
        });
    } catch (error) {
        console.error('Add location error:', error);
        res.status(500).json({
            success: false,
            error: 'ADD_LOCATION_ERROR',
            message: 'Không thể thêm location'
        });
    }
});

// Update location
router.put('/locations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_INPUT',
                message: 'Tên location không được để trống'
            });
        }

        // Check if location exists
        const existing = await executeQuery('SELECT id FROM locations WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'LOCATION_NOT_FOUND',
                message: 'Location không tồn tại'
            });
        }

        // Check if new name already exists (except current location)
        const duplicate = await executeQuery('SELECT id FROM locations WHERE name = ? AND id != ?', [name.trim(), id]);
        if (duplicate.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'LOCATION_EXISTS',
                message: 'Tên location đã tồn tại'
            });
        }

        // Update location
        await executeQuery('UPDATE locations SET name = ? WHERE id = ?', [name.trim(), id]);

        res.json({
            success: true,
            message: 'Cập nhật location thành công',
            data: {
                id,
                name: name.trim()
            }
        });
    } catch (error) {
        console.error('Update location error:', error);
        res.status(500).json({
            success: false,
            error: 'UPDATE_LOCATION_ERROR',
            message: 'Không thể cập nhật location'
        });
    }
});

// Delete location
router.delete('/locations/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if location exists and get its name
        const existing = await executeQuery('SELECT id, name FROM locations WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'LOCATION_NOT_FOUND',
                message: 'Location không tồn tại'
            });
        }

        const locationName = existing[0].name;

        // Check if location is being used in attendance (by name)
        const inUse = await executeQuery('SELECT COUNT(*) as count FROM attendance WHERE location = ?', [locationName]);
        if (inUse[0].count > 0) {
            return res.status(400).json({
                success: false,
                error: 'LOCATION_IN_USE',
                message: `Location "${locationName}" đang được sử dụng trong ${inUse[0].count} bản ghi chấm công, không thể xóa`
            });
        }

        // Delete location
        await executeQuery('DELETE FROM locations WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Xóa location thành công'
        });
    } catch (error) {
        console.error('Delete location error:', error);
        res.status(500).json({
            success: false,
            error: 'DELETE_LOCATION_ERROR',
            message: 'Không thể xóa location: ' + error.message
        });
    }
});

// ==================== FILE UPLOAD/DOWNLOAD ====================

// Upload employees from Excel
router.post('/users/upload', upload.single('file'), async (req, res) => {
    let uploadedFilePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'NO_FILE',
                message: 'Vui lòng chọn file Excel'
            });
        }

        uploadedFilePath = req.file.path;

        // Read Excel file
        const workbook = xlsx.readFile(uploadedFilePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON (assumes first row is header)
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (!data || data.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'EMPTY_FILE',
                message: 'File Excel không có dữ liệu'
            });
        }

        let added = 0;
        let skipped = 0;
        let errors = [];

        // Process each row
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const rowNum = i + 2; // +2 because row 1 is header, and Excel is 1-indexed

            try {
                // Get data from Excel columns (support multiple column name formats)
                const employeeId = row['ID'] || row['id'] || row['Employee ID'] || row['Mã NV'];
                const name = row['Name'] || row['name'] || row['Tên'] || row['Họ tên'];
                const department = row['Department'] || row['department'] || row['Phòng ban'] || row['Phong ban'] || null;
                const username = row['Username'] || row['username'] || row['Tên đăng nhập'] || null;
                const password = row['Password'] || row['password'] || row['Mật khẩu'] || null;
                const role = (row['Role'] || row['role'] || row['Vai trò'] || 'staff').toLowerCase();

                // Validate required fields
                if (!employeeId || !name) {
                    errors.push(`Dòng ${rowNum}: Thiếu ID hoặc Tên`);
                    skipped++;
                    continue;
                }

                // Validate role
                const validRoles = ['staff', 'event_manager', 'admin'];
                const finalRole = validRoles.includes(role) ? role : 'staff';

                // Check if employee_id (id) already exists
                const existing = await executeQuery('SELECT id FROM users WHERE id = ?', [employeeId]);
                if (existing.length > 0) {
                    errors.push(`Dòng ${rowNum}: ID ${employeeId} đã tồn tại`);
                    skipped++;
                    continue;
                }

                // Use username if provided, otherwise use employee_id
                const finalUsername = username || employeeId;

                // Check if username already exists
                const existingUsername = await executeQuery('SELECT id FROM users WHERE username = ?', [finalUsername]);
                if (existingUsername.length > 0) {
                    errors.push(`Dòng ${rowNum}: Username ${finalUsername} đã tồn tại`);
                    skipped++;
                    continue;
                }

                // Hash password if provided, otherwise use default password
                const finalPassword = password || '123456';
                const hashedPassword = await bcrypt.hash(finalPassword, 10);

                // Insert user - use employeeId as id (PRIMARY KEY)
                await executeQuery(
                    `INSERT INTO users (id, name, department, username, password, role, is_active, created_at, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                    [employeeId, name, department || null, finalUsername, hashedPassword, finalRole]
                );

                added++;
            } catch (error) {
                console.error(`Error processing row ${rowNum}:`, error);
                errors.push(`Dòng ${rowNum}: ${error.message}`);
                skipped++;
            }
        }

        // Delete uploaded file
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
            fs.unlinkSync(uploadedFilePath);
        }

        res.json({
            success: true,
            message: `Upload hoàn tất! Đã thêm ${added} nhân viên, bỏ qua ${skipped} dòng`,
            data: {
                added,
                skipped,
                total: data.length,
                errors: errors.length > 0 ? errors : undefined
            }
        });

    } catch (error) {
        console.error('Upload employees error:', error);

        // Delete uploaded file in case of error
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
            fs.unlinkSync(uploadedFilePath);
        }

        res.status(500).json({
            success: false,
            error: 'UPLOAD_ERROR',
            message: 'Không thể upload file: ' + error.message
        });
    }
});

// Download attendance data
router.get('/attendance/download', async (req, res) => {
    try {
        const { dateRange, startDate, endDate } = req.query;

        let whereClause = '';
        let params = [];

        // Build date filter
        const today = moment().format('YYYY-MM-DD');

        if (dateRange === 'today') {
            whereClause = 'WHERE scan_date = ?';
            params = [today];
        } else if (dateRange === 'yesterday') {
            const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
            whereClause = 'WHERE scan_date = ?';
            params = [yesterday];
        } else if (dateRange === 'thisweek') {
            const weekStart = moment().startOf('week').format('YYYY-MM-DD');
            whereClause = 'WHERE scan_date >= ?';
            params = [weekStart];
        } else if (dateRange === 'lastweek') {
            const lastWeekStart = moment().subtract(1, 'week').startOf('week').format('YYYY-MM-DD');
            const lastWeekEnd = moment().subtract(1, 'week').endOf('week').format('YYYY-MM-DD');
            whereClause = 'WHERE scan_date BETWEEN ? AND ?';
            params = [lastWeekStart, lastWeekEnd];
        } else if (dateRange === 'thismonth') {
            const monthStart = moment().startOf('month').format('YYYY-MM-DD');
            whereClause = 'WHERE scan_date >= ?';
            params = [monthStart];
        } else if (dateRange === 'lastmonth') {
            const lastMonthStart = moment().subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
            const lastMonthEnd = moment().subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
            whereClause = 'WHERE scan_date BETWEEN ? AND ?';
            params = [lastMonthStart, lastMonthEnd];
        } else if (dateRange === 'custom' && startDate && endDate) {
            whereClause = 'WHERE scan_date BETWEEN ? AND ?';
            params = [startDate, endDate];
        }

        // Get attendance data
        const attendance = await executeQuery(`
            SELECT 
                u.id as employee_id,
                u.name,
                a.scan_date,
                a.scan_time,
                a.action_type,
                a.location,
                a.status
            FROM attendance a
            JOIN users u ON a.user_id = u.id
            ${whereClause}
            ORDER BY a.scan_date DESC, a.scan_time DESC, u.id ASC
        `, params);

        // Group by user and date to calculate check-in/check-out
        const processedData = [];
        const userDateMap = new Map();

        attendance.forEach(record => {
            const key = `${record.employee_id}_${record.scan_date}`;
            if (!userDateMap.has(key)) {
                userDateMap.set(key, {
                    employee_id: record.employee_id,
                    name: record.name,
                    scan_date: record.scan_date,
                    check_in_time: null,
                    check_out_time: null,
                    location: record.location,
                    status: record.status
                });
            }

            const entry = userDateMap.get(key);
            if (record.action_type === 'check_in' || record.action_type === 'checkin') {
                if (!entry.check_in_time) entry.check_in_time = record.scan_time;
            } else if (record.action_type === 'check_out' || record.action_type === 'checkout') {
                entry.check_out_time = record.scan_time;
            }
        });

        // Convert map to array and calculate hours
        userDateMap.forEach(entry => {
            let hours_worked = 0;
            if (entry.check_in_time && entry.check_out_time) {
                const checkIn = new Date(entry.check_in_time);
                const checkOut = new Date(entry.check_out_time);
                hours_worked = Math.round((checkOut - checkIn) / (1000 * 60 * 60) * 10) / 10; // Round to 1 decimal
            }
            processedData.push({
                ...entry,
                hours_worked
            });
        });

        // Create Excel file
        const worksheet = xlsx.utils.json_to_sheet(processedData.map(row => ({
            'Mã NV': row.employee_id,
            'Tên nhân viên': row.name,
            'Ngày': row.scan_date,
            'Giờ vào': row.check_in_time || '',
            'Giờ ra': row.check_out_time || '',
            'Vị trí': row.location || '',
            'Số giờ làm': row.hours_worked,
            'Trạng thái': row.status
        })));

        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Chấm công');

        // Generate buffer
        const excelBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        // Set headers for file download
        const fileName = `ChamCong_${dateRange || 'all'}_${moment().format('YYYYMMDD_HHmmss')}.xlsx`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        // Send file
        res.send(excelBuffer);
    } catch (error) {
        console.error('Download attendance error:', error);
        res.status(500).json({
            success: false,
            error: 'DOWNLOAD_ERROR',
            message: 'Không thể tải dữ liệu chấm công: ' + error.message
        });
    }
});

module.exports = router;