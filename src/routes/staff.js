const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { requireStaff } = require('../middleware/auth');
const { requireCompanyNetwork } = require('../middleware/networkSecurity');
const { rfidScanLimiter } = require('../middleware/rateLimiter');
const moment = require('moment-timezone');

// Staff dashboard
router.get('/', requireStaff, (req, res) => {
    res.render('staff/dashboard', {
        title: 'Nhân viên - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Check In Work page
router.get('/checkinwork', requireStaff, (req, res) => {
    res.render('staff/checkinwork', {
        title: 'Check In Work - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Check Out Work page
router.get('/checkoutwork', requireStaff, (req, res) => {
    res.render('staff/checkoutwork', {
        title: 'Check Out Work - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Available Status page
router.get('/available', requireStaff, (req, res) => {
    res.render('staff/available', {
        title: 'Available Status - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Staff attendance page
router.get('/attendance', requireStaff, (req, res) => {
    res.render('staff/attendance', {
        title: 'Chấm công - Hệ thống RFID',
        user: req.user
    });
});

// Check-in/Check-out work
router.post('/checkinwork', [requireStaff, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { rfid_card } = req.body;

        if (!rfid_card) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_RFID',
                message: 'Vui lòng quét thẻ RFID'
            });
        }

        const userId = req.user.id;
        const now = moment.tz('Asia/Ho_Chi_Minh');
        const today = now.format('YYYY-MM-DD');
        const currentTime = now.format('YYYY-MM-DD HH:mm:ss');

        // Check for duplicate scan (anti-spam)
        const isDuplicate = await Attendance.checkDuplicateScan(userId, rfid_card, 5);
        if (isDuplicate) {
            return res.status(429).json({
                success: false,
                error: 'DUPLICATE_SCAN',
                message: 'Vui lòng chờ 5 giây trước khi quét lại'
            });
        }

        // Get last scan to determine action
        const lastScan = await Attendance.getLastScanForUser(userId, today);
        let actionType = 'check_in';

        if (lastScan) {
            // If last scan was check_in, next should be check_out
            actionType = lastScan.actionType === 'check_in' ? 'check_out' : 'check_in';
        }

        // Record attendance
        const attendanceData = {
            userId,
            rfidCard: rfid_card,
            scanTime: currentTime,
            scanDate: today,
            actionType,
            eventId: null,
            clientIp: req.networkInfo?.clientIp || req.ip || null,
            gatewayIp: req.networkInfo?.gatewayIp || null,
            wifiName: req.networkInfo?.wifiName || null,
            location: 'Main Office',
            notes: null,
            status: 'valid'
        };

        const attendance = await Attendance.recordAttendance(attendanceData);

        // Emit real-time update
        req.io.emit('attendance_update', {
            type: 'work_attendance',
            action: actionType,
            user: req.user.toJSON(),
            attendance: attendance,
            timestamp: currentTime
        });

        console.log(`${req.user.name} (${req.user.id}) ${actionType} at ${currentTime}`);

        res.json({
            success: true,
            message: actionType === 'check_in' ? 'Chấm công vào thành công' : 'Chấm công ra thành công',
            data: {
                action: actionType,
                time: currentTime,
                user: req.user.toJSON(),
                attendance: attendance
            }
        });

    } catch (error) {
        console.error('Check-in/out work error:', error);
        res.status(500).json({
            success: false,
            error: 'CHECKIN_ERROR',
            message: 'Đã xảy ra lỗi khi chấm công. Vui lòng thử lại.'
        });
    }
});

// Get staff attendance history
router.get('/attendance/history', requireStaff, async (req, res) => {
    try {
        const { start_date, end_date, limit = 50, action } = req.query;
        const userId = req.user.id;

        // Default to last 30 days if no dates provided
        const endDate = end_date || moment().format('YYYY-MM-DD');
        const startDate = start_date || moment().subtract(30, 'days').format('YYYY-MM-DD');

        let attendanceRecords = await Attendance.findByDateRange(startDate, endDate, userId);

        // Filter by action type if specified
        if (action && (action === 'check_in' || action === 'check_out')) {
            attendanceRecords = attendanceRecords.filter(record => record.action_type === action);
        }

        // Limit results
        const limitedRecords = attendanceRecords.slice(0, parseInt(limit));

        res.json({
            success: true,
            data: {
                records: limitedRecords,
                total: attendanceRecords.length,
                dateRange: { startDate, endDate }
            }
        });

    } catch (error) {
        console.error('Get attendance history error:', error);
        res.status(500).json({
            success: false,
            error: 'HISTORY_ERROR',
            message: 'Đã xảy ra lỗi khi lấy lịch sử chấm công'
        });
    }
});

// Get today's attendance status
router.get('/attendance/today', requireStaff, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = moment().format('YYYY-MM-DD');

        const todayRecords = await Attendance.findByUserAndDate(userId, today);

        let status = 'not_checked_in';
        let lastAction = null;
        let totalHours = 0;

        if (todayRecords.length > 0) {
            const lastRecord = todayRecords[todayRecords.length - 1];
            lastAction = lastRecord.actionType;
            status = lastAction === 'check_in' ? 'checked_in' : 'checked_out';

            // Calculate total hours worked
            const checkIns = todayRecords.filter(r => r.actionType === 'check_in');
            const checkOuts = todayRecords.filter(r => r.actionType === 'check_out');

            for (let i = 0; i < Math.min(checkIns.length, checkOuts.length); i++) {
                const checkInTime = moment(checkIns[i].scanTime);
                const checkOutTime = moment(checkOuts[i].scanTime);
                totalHours += checkOutTime.diff(checkInTime, 'hours', true);
            }
        }

        res.json({
            success: true,
            data: {
                status,
                lastAction,
                totalHours: Math.round(totalHours * 100) / 100,
                records: todayRecords,
                date: today
            }
        });

    } catch (error) {
        console.error('Get today attendance error:', error);
        res.status(500).json({
            success: false,
            error: 'TODAY_STATUS_ERROR',
            message: 'Đã xảy ra lỗi khi lấy trạng thái chấm công hôm nay'
        });
    }
});

// Get staff work report
router.get('/report', requireStaff, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const userId = req.user.id;

        // Default to current month if no dates provided
        const endDate = end_date || moment().format('YYYY-MM-DD');
        const startDate = start_date || moment().startOf('month').format('YYYY-MM-DD');

        const report = await Attendance.getUserAttendanceReport(userId, startDate, endDate);

        res.json({
            success: true,
            data: {
                report,
                dateRange: { startDate, endDate },
                user: req.user.toJSON()
            }
        });

    } catch (error) {
        console.error('Get staff report error:', error);
        res.status(500).json({
            success: false,
            error: 'REPORT_ERROR',
            message: 'Đã xảy ra lỗi khi tạo báo cáo'
        });
    }
});

// Check-out work
router.post('/checkoutwork', [requireStaff, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { rfid_card, method } = req.body;

        if (!rfid_card) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_RFID',
                message: 'Vui lòng quét thẻ RFID hoặc nhập mã nhân viên'
            });
        }

        const userId = req.user.id;
        const now = moment.tz('Asia/Ho_Chi_Minh');
        const today = now.format('YYYY-MM-DD');
        const currentTime = now.format('YYYY-MM-DD HH:mm:ss');

        // Check for duplicate scan (anti-spam)
        const isDuplicate = await Attendance.checkDuplicateScan(userId, rfid_card, 5);
        if (isDuplicate) {
            return res.status(429).json({
                success: false,
                error: 'DUPLICATE_SCAN',
                message: 'Vui lòng chờ 5 giây trước khi quét lại'
            });
        }

        // Validate RFID card ownership (skip for manual method)
        let user = req.user; // Default to current logged-in user
        if (method !== 'manual') {
            user = await User.findByRfidCard(rfid_card);
            if (!user || user.id !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'INVALID_CARD',
                    message: 'Thẻ RFID không hợp lệ hoặc không thuộc về bạn'
                });
            }
        }

        // Get today's attendance status
        const todayAttendance = await Attendance.getTodayStatus(userId, today);

        // Check if user has checked in today
        if (!todayAttendance || !todayAttendance.check_in_time) {
            return res.status(400).json({
                success: false,
                error: 'NOT_CHECKED_IN',
                message: 'Bạn chưa chấm công vào hôm nay'
            });
        }

        // Check if user has already checked out today
        if (todayAttendance.check_out_time) {
            return res.status(400).json({
                success: false,
                error: 'ALREADY_CHECKED_OUT',
                message: 'Bạn đã chấm công ra hôm nay'
            });
        }

        // Record check-out
        const attendanceData = {
            userId,
            rfidCard: rfid_card,
            scanTime: currentTime,
            scanDate: today,
            actionType: 'check_out',
            eventId: null,
            clientIp: req.networkInfo?.clientIp || req.ip || null,
            gatewayIp: req.networkInfo?.gatewayIp || null,
            wifiName: req.networkInfo?.wifiName || null,
            location: 'Main Office',
            notes: null,
            status: 'valid'
        };

        const attendance = await Attendance.recordAttendance(attendanceData);

        // Emit socket event for real-time updates
        if (req.app.get('io')) {
            req.app.get('io').emit('attendance_update', {
                user: user.toJSON(),
                action: 'check_out',
                time: currentTime
            });
        }

        res.json({
            success: true,
            data: {
                action: 'check_out',
                user: user.toJSON(),
                attendance: attendance,
                time: currentTime
            },
            message: 'Chấm công ra thành công'
        });

    } catch (error) {
        console.error('Check-out work error:', error);
        res.status(500).json({
            success: false,
            error: 'CHECKOUT_ERROR',
            message: 'Đã xảy ra lỗi khi chấm công ra. Vui lòng thử lại.'
        });
    }
});

module.exports = router;