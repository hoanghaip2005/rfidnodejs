const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const { executeQuery } = require('../config/database');
const moment = require('moment-timezone');

// Include admin API routes
router.use('/api', require('./admin-api'));

// Admin dashboard
router.get('/', requireAdmin, async (req, res) => {
    try {
        // Get basic statistics
        const today = moment().format('YYYY-MM-DD');
        const thisMonth = moment().format('YYYY-MM');

        const stats = await Promise.all([
            // Total users
            executeQuery('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
            // Today's attendance
            executeQuery('SELECT COUNT(*) as count FROM attendance WHERE scan_date = ? AND status = "valid"', [today]),
            // This month's attendance
            executeQuery('SELECT COUNT(*) as count FROM attendance WHERE scan_date LIKE ? AND status = "valid"', [`${thisMonth}%`]),
            // Active users today
            executeQuery('SELECT COUNT(DISTINCT user_id) as count FROM attendance WHERE scan_date = ? AND status = "valid"', [today])
        ]);

        res.render('admin/dashboard', {
            title: 'Quản trị - Hệ thống chấm công RFID',
            user: req.user,
            stats: {
                totalUsers: stats[0][0].count,
                todayAttendance: stats[1][0].count,
                monthAttendance: stats[2][0].count,
                activeUsersToday: stats[3][0].count
            }
        });

    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.render('admin/dashboard', {
            title: 'Quản trị - Hệ thống chấm công RFID',
            user: req.user,
            stats: {
                totalUsers: 0,
                todayAttendance: 0,
                monthAttendance: 0,
                activeUsersToday: 0
            },
            error: 'Không thể tải thống kê'
        });
    }
});

// User management page
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = await User.findAll();
        res.render('admin/users', {
            title: 'Quản lý người dùng',
            user: req.user,
            users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.render('admin/users', {
            title: 'Quản lý người dùng',
            user: req.user,
            users: [],
            error: 'Không thể tải danh sách người dùng'
        });
    }
});

// Get all users API
router.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const { role, active = 'true' } = req.query;

        let users;
        if (role && role !== 'all') {
            users = await User.findAll(role);
        } else {
            users = await User.findAll();
        }

        // Filter by active status if specified
        if (active !== 'all') {
            const isActive = active === 'true';
            users = users.filter(user => user.isActive === isActive);
        }

        res.json({
            success: true,
            data: users.map(user => user.toJSON())
        });

    } catch (error) {
        console.error('Get users API error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_USERS_ERROR',
            message: 'Không thể lấy danh sách người dùng'
        });
    }
});

// Create user
router.post('/api/users', [requireAdmin, adminLimiter], async (req, res) => {
    try {
        const { id, name, username, password, role = 'at_work' } = req.body;

        if (!id || !name || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_FIELDS',
                message: 'Vui lòng điền đầy đủ thông tin'
            });
        }

        // Check if user ID or username already exists
        const existingUserById = await User.findById(id);
        if (existingUserById) {
            return res.status(400).json({
                success: false,
                error: 'USER_ID_EXISTS',
                message: 'ID người dùng đã tồn tại'
            });
        }

        const existingUserByUsername = await User.findByUsername(username);
        if (existingUserByUsername) {
            return res.status(400).json({
                success: false,
                error: 'USERNAME_EXISTS',
                message: 'Tên đăng nhập đã tồn tại'
            });
        }

        const user = await User.create({ id, name, username, password, role });

        console.log(`Admin ${req.user.username} created user ${username}`);

        res.json({
            success: true,
            message: 'Tạo người dùng thành công',
            data: user.toJSON()
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            success: false,
            error: 'CREATE_USER_ERROR',
            message: 'Đã xảy ra lỗi khi tạo người dùng'
        });
    }
});

// Update user
router.put('/api/users/:id', [requireAdmin, adminLimiter], async (req, res) => {
    try {
        const { id } = req.params;
        const { name, username, password, role, isActive } = req.body;

        const existingUser = await User.findById(id);
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Người dùng không tồn tại'
            });
        }

        // Check if new username already exists (excluding current user)
        if (username && username !== existingUser.username) {
            const userWithSameUsername = await User.findByUsername(username);
            if (userWithSameUsername) {
                return res.status(400).json({
                    success: false,
                    error: 'USERNAME_EXISTS',
                    message: 'Tên đăng nhập đã tồn tại'
                });
            }
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (username) updateData.username = username;
        if (password) updateData.password = password;
        if (role) updateData.role = role;
        if (isActive !== undefined) updateData.isActive = isActive;

        const updatedUser = await User.update(id, updateData);

        console.log(`Admin ${req.user.username} updated user ${id}`);

        res.json({
            success: true,
            message: 'Cập nhật người dùng thành công',
            data: updatedUser.toJSON()
        });

    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            error: 'UPDATE_USER_ERROR',
            message: 'Đã xảy ra lỗi khi cập nhật người dùng'
        });
    }
});

// Delete user (soft delete)
router.delete('/api/users/:id', [requireAdmin, adminLimiter], async (req, res) => {
    try {
        const { id } = req.params;

        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                error: 'CANNOT_DELETE_SELF',
                message: 'Không thể xóa tài khoản của chính mình'
            });
        }

        const existingUser = await User.findById(id);
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'USER_NOT_FOUND',
                message: 'Người dùng không tồn tại'
            });
        }

        await User.delete(id);

        console.log(`Admin ${req.user.username} deleted user ${id}`);

        res.json({
            success: true,
            message: 'Xóa người dùng thành công'
        });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'DELETE_USER_ERROR',
            message: 'Đã xảy ra lỗi khi xóa người dùng'
        });
    }
});

// Attendance management page
router.get('/attendance', requireAdmin, (req, res) => {
    res.render('admin/attendance', {
        title: 'Quản lý chấm công',
        user: req.user
    });
});

// Get attendance records
router.get('/api/attendance', requireAdmin, async (req, res) => {
    try {
        const { start_date, end_date, user_id, limit = 100, offset = 0 } = req.query;

        // Default to last 7 days if no dates provided
        const endDate = end_date || moment().format('YYYY-MM-DD');
        const startDate = start_date || moment().subtract(7, 'days').format('YYYY-MM-DD');

        const records = await Attendance.findByDateRange(startDate, endDate, user_id);

        // Apply pagination
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);
        const paginatedRecords = records.slice(offsetNum, offsetNum + limitNum);

        res.json({
            success: true,
            data: {
                records: paginatedRecords,
                total: records.length,
                pagination: {
                    limit: limitNum,
                    offset: offsetNum,
                    hasMore: offsetNum + limitNum < records.length
                },
                dateRange: { startDate, endDate }
            }
        });

    } catch (error) {
        console.error('Get attendance records error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_ATTENDANCE_ERROR',
            message: 'Không thể lấy dữ liệu chấm công'
        });
    }
});

// Get attendance statistics
router.get('/api/attendance/stats', requireAdmin, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // Default to current month if no dates provided
        const endDate = end_date || moment().format('YYYY-MM-DD');
        const startDate = start_date || moment().startOf('month').format('YYYY-MM-DD');

        const stats = await Attendance.getAttendanceStats(startDate, endDate);

        res.json({
            success: true,
            data: {
                ...stats,
                dateRange: { startDate, endDate }
            }
        });

    } catch (error) {
        console.error('Get attendance stats error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_STATS_ERROR',
            message: 'Không thể lấy thống kê chấm công'
        });
    }
});

// Network configuration page
router.get('/network-config', requireAdmin, (req, res) => {
    res.render('admin/network-config', {
        title: 'Cấu hình mạng',
        user: req.user
    });
});

// Get network configurations
router.get('/api/network-config', requireAdmin, async (req, res) => {
    try {
        const [networks, wifis] = await Promise.all([
            executeQuery('SELECT * FROM network_configs ORDER BY id DESC'),
            executeQuery('SELECT * FROM wifi_configs ORDER BY id DESC')
        ]);

        res.json({
            success: true,
            data: {
                networks,
                wifis
            }
        });

    } catch (error) {
        console.error('Get network config error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_NETWORK_CONFIG_ERROR',
            message: 'Không thể lấy cấu hình mạng'
        });
    }
});

// Update network configurations
router.post('/api/network-config', [requireAdmin, adminLimiter], async (req, res) => {
    try {
        const { networks, wifis } = req.body;

        if (!networks || !wifis) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_CONFIG_DATA',
                message: 'Dữ liệu cấu hình không hợp lệ'
            });
        }

        // Update network configurations
        // For simplicity, we'll clear and recreate all configs
        await executeQuery('DELETE FROM network_configs');
        await executeQuery('DELETE FROM wifi_configs');

        // Insert new network configs
        for (const network of networks) {
            await executeQuery(
                'INSERT INTO network_configs (network_ip, network_mask, description, is_active) VALUES (?, ?, ?, ?)',
                [network.ip, network.mask, network.description || '', true]
            );
        }

        // Insert new wifi configs
        for (const wifi of wifis) {
            await executeQuery(
                'INSERT INTO wifi_configs (wifi_name, description, is_active) VALUES (?, ?, ?)',
                [wifi.name, wifi.description || '', true]
            );
        }

        console.log(`Admin ${req.user.username} updated network configuration`);

        res.json({
            success: true,
            message: 'Cập nhật cấu hình mạng thành công'
        });

    } catch (error) {
        console.error('Update network config error:', error);
        res.status(500).json({
            success: false,
            error: 'UPDATE_NETWORK_CONFIG_ERROR',
            message: 'Đã xảy ra lỗi khi cập nhật cấu hình mạng'
        });
    }
});

// ==================== NEW ADMIN PAGES ====================

// Users management page
router.get('/users', requireAdmin, (req, res) => {
    res.render('admin/users', {
        title: 'Quản lý Người dùng - RFID Admin',
        user: req.user
    });
});

// Reports page
router.get('/reports', requireAdmin, (req, res) => {
    res.render('admin/reports', {
        title: 'Báo cáo Chấm công - RFID Admin',
        user: req.user
    });
});

// Settings page
router.get('/settings', requireAdmin, (req, res) => {
    res.render('admin/settings', {
        title: 'Cài đặt Hệ thống - RFID Admin',
        user: req.user
    });
});

// Manage checkpoints page
router.get('/manage-checkpoints', requireAdmin, (req, res) => {
    res.render('admin/manage-checkpoints', {
        title: 'Quản lý Checkpoints - RFID Admin',
        user: req.user
    });
});

// System management page
router.get('/manage', requireAdmin, (req, res) => {
    res.render('admin/manage', {
        title: 'Quản lý Hệ thống - RFID Admin',
        user: req.user
    });
});

module.exports = router;