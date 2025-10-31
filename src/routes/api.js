const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { requireAuth, requireEventManager } = require('../middleware/auth');
const { apiLimiter, rfidScanLimiter } = require('../middleware/rateLimiter');
const { requireCompanyNetwork } = require('../middleware/networkSecurity');
const moment = require('moment-timezone');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const XLSX = require('xlsx');
const path = require('path');

// Apply API rate limiting to all routes
router.use(apiLimiter);

// Authentication status check
router.get('/auth/status', (req, res) => {
    res.json({
        authenticated: !!req.user,
        user: req.user ? req.user.toJSON() : null
    });
});

// RFID scan endpoint
router.post('/rfid/scan', [requireAuth, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { rfid_card, event_id = null } = req.body;

        if (!rfid_card) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_RFID',
                message: 'Vui lòng quét thẻ RFID'
            });
        }

        // Resolve target user by RFID card from users table
        let targetUserId = req.user.id;
        try {
            console.log(`🔍 Looking up RFID card: ${rfid_card}`);
            const rfidOwner = await User.findByRfidCard(rfid_card);
            console.log(`🔍 RFID owner found:`, rfidOwner ? { id: rfidOwner.id, name: rfidOwner.name } : 'NULL');
            if (rfidOwner && rfidOwner.id) {
                targetUserId = rfidOwner.id;
                console.log(`✅ Target user ID set to: ${targetUserId}`);
            } else {
                console.log(`⚠️ No user found for RFID ${rfid_card}, using logged-in user: ${req.user.id}`);
            }
        } catch (e) {
            console.error(`❌ Error looking up RFID card:`, e.message);
            // Ignore lookup errors and keep fallback to logged-in user
        }
        const now = moment.tz('Asia/Ho_Chi_Minh');
        const today = now.format('YYYY-MM-DD');
        const currentTime = now.format('YYYY-MM-DD HH:mm:ss');

        // Check for duplicate scan (anti-spam)
        const isDuplicate = await Attendance.checkDuplicateScan(targetUserId, rfid_card, 5);
        if (isDuplicate) {
            return res.status(429).json({
                success: false,
                error: 'DUPLICATE_SCAN',
                message: 'Vui lòng chờ 5 giây trước khi quét lại'
            });
        }

        // Determine action type based on last scan
        const lastScan = await Attendance.getLastScanForUser(targetUserId, event_id ? null : today);
        let actionType = 'check_in';

        if (lastScan) {
            if (event_id) {
                // For events, alternate between check_in and check_out
                actionType = lastScan.actionType === 'check_in' ? 'check_out' : 'check_in';
            } else {
                // For regular work, check same day
                if (lastScan.scanDate === today) {
                    actionType = lastScan.actionType === 'check_in' ? 'check_out' : 'check_in';
                }
            }
        }

        // Record attendance
        const attendanceData = {
            userId: targetUserId,
            rfidCard: rfid_card,
            scanTime: currentTime,
            scanDate: today,
            actionType,
            eventId: event_id || null,
            clientIp: req.networkInfo?.clientIp || req.ip || null,
            gatewayIp: req.networkInfo?.gatewayIp || null,
            wifiName: req.networkInfo?.wifiName || null,
            location: 'Main Office',
            // Preserve who performed the scan if different from target
            notes: (req.user?.id && req.user.id !== targetUserId) ? `scanned_by:${req.user.id}` : null,
            status: 'valid'
        };

        const attendance = await Attendance.recordAttendance(attendanceData);

        // Get target user info for response (if different from logged-in user)
        let targetUser = req.user;
        if (targetUserId !== req.user.id) {
            try {
                const foundUser = await User.findById(targetUserId);
                if (foundUser) {
                    targetUser = foundUser;
                }
            } catch (e) {
                // Fallback to req.user if lookup fails
            }
        }

        // Emit real-time update
        req.io.emit('attendance_update', {
            type: event_id ? 'event_attendance' : 'work_attendance',
            action: actionType,
            user: targetUser.toJSON(),
            attendance: attendance,
            timestamp: currentTime,
            eventId: event_id
        });

        const actorInfo = `${req.user.name} (${req.user.id})`;
        const targetInfo = targetUserId !== req.user.id ? ` -> on behalf of user ${targetUserId}` : '';
        console.log(`API RFID Scan: ${actorInfo} ${actionType} at ${currentTime}${event_id ? ` for event ${event_id}` : ''}${targetInfo}`);

        res.json({
            success: true,
            message: actionType === 'check_in' ? 'Chấm công vào thành công' : 'Chấm công ra thành công',
            data: {
                action: actionType,
                time: currentTime,
                user: targetUser.toJSON(),
                attendance: attendance,
                eventId: event_id
            }
        });

    } catch (error) {
        console.error('API RFID scan error:', error);
        res.status(500).json({
            success: false,
            error: 'RFID_SCAN_ERROR',
            message: 'Đã xảy ra lỗi khi quét thẻ RFID. Vui lòng thử lại.'
        });
    }
});

// Get user attendance summary
router.get('/attendance/summary', requireAuth, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const userId = req.user.id;

        // Default to current month if no dates provided
        const endDate = end_date || moment().format('YYYY-MM-DD');
        const startDate = start_date || moment().startOf('month').format('YYYY-MM-DD');

        const [todayStatus, monthlyReport] = await Promise.all([
            // Today's status
            Attendance.findByUserAndDate(userId, moment().format('YYYY-MM-DD')),
            // Monthly report
            Attendance.getUserAttendanceReport(userId, startDate, endDate)
        ]);

        // Calculate today's status
        let currentStatus = 'not_checked_in';
        let totalHoursToday = 0;

        if (todayStatus.length > 0) {
            const lastRecord = todayStatus[todayStatus.length - 1];
            currentStatus = lastRecord.actionType === 'check_in' ? 'checked_in' : 'checked_out';

            // Calculate hours worked today
            const checkIns = todayStatus.filter(r => r.actionType === 'check_in');
            const checkOuts = todayStatus.filter(r => r.actionType === 'check_out');

            for (let i = 0; i < Math.min(checkIns.length, checkOuts.length); i++) {
                const checkInTime = moment(checkIns[i].scanTime);
                const checkOutTime = moment(checkOuts[i].scanTime);
                totalHoursToday += checkOutTime.diff(checkInTime, 'hours', true);
            }
        }

        // Calculate monthly totals
        let totalDaysWorked = 0;
        let totalHoursWorked = 0;

        for (const day of monthlyReport) {
            if (day.first_check_in && day.last_check_out) {
                totalDaysWorked++;
                const dayStart = moment(day.first_check_in);
                const dayEnd = moment(day.last_check_out);
                totalHoursWorked += dayEnd.diff(dayStart, 'hours', true);
            }
        }

        res.json({
            success: true,
            data: {
                today: {
                    status: currentStatus,
                    totalHours: Math.round(totalHoursToday * 100) / 100,
                    records: todayStatus
                },
                monthly: {
                    totalDaysWorked,
                    totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
                    averageHoursPerDay: totalDaysWorked > 0 ? Math.round((totalHoursWorked / totalDaysWorked) * 100) / 100 : 0,
                    dateRange: { startDate, endDate }
                },
                user: req.user.toJSON()
            }
        });

    } catch (error) {
        console.error('Get attendance summary error:', error);
        res.status(500).json({
            success: false,
            error: 'SUMMARY_ERROR',
            message: 'Không thể lấy tóm tắt chấm công'
        });
    }
});

// Get attendance history with pagination
router.get('/attendance/history', requireAuth, async (req, res) => {
    try {
        const { start_date, end_date, date, page = 1, limit = 20 } = req.query;
        const { executeQuery } = require('../config/database');
        const userId = req.user.id;

        let allRecords;

        // If specific date is provided (for admin view of all users that day)
        if (date) {
            const query = `
                SELECT a.*, u.name as user_name
                FROM attendance a
                LEFT JOIN users u ON a.user_id = u.id
                WHERE a.scan_date = ? AND a.status = 'valid'
                ORDER BY a.scan_time DESC
            `;
            allRecords = await executeQuery(query, [date]);
        } else {
            // Otherwise, get logged-in user's own attendance history
            const endDate = end_date || moment().format('YYYY-MM-DD');
            const startDate = start_date || moment().subtract(30, 'days').format('YYYY-MM-DD');

            const query = `
                SELECT a.*, u.name as user_name
                FROM attendance a
                LEFT JOIN users u ON a.user_id = u.id
                WHERE a.user_id = ? AND a.scan_date BETWEEN ? AND ? AND a.status = 'valid'
                ORDER BY a.scan_time DESC
            `;
            allRecords = await executeQuery(query, [userId, startDate, endDate]);
        }

        // Apply pagination
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        const paginatedRecords = allRecords.slice(offset, offset + limitNum);

        res.json({
            success: true,
            records: paginatedRecords,
            data: {
                records: paginatedRecords,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: allRecords.length,
                    totalPages: Math.ceil(allRecords.length / limitNum),
                    hasNext: offset + limitNum < allRecords.length,
                    hasPrev: pageNum > 1
                }
            }
        });

    } catch (error) {
        console.error('Get attendance history error:', error);
        res.status(500).json({
            success: false,
            error: 'HISTORY_ERROR',
            message: 'Không thể lấy lịch sử chấm công'
        });
    }
});

// Get system status
router.get('/system/status', requireAuth, (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                server: {
                    status: 'online',
                    timestamp: moment().tz('Asia/Ho_Chi_Minh').format(),
                    timezone: 'Asia/Ho_Chi_Minh'
                },
                user: req.user.toJSON(),
                network: req.networkInfo || {},
                version: require('../../package.json').version
            }
        });
    } catch (error) {
        console.error('Get system status error:', error);
        res.status(500).json({
            success: false,
            error: 'STATUS_ERROR',
            message: 'Không thể lấy trạng thái hệ thống'
        });
    }
});

// Manual RFID input (for keyboard mode devices like R65D)
router.post('/rfid/manual', [requireAuth, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { card_id, event_id = null } = req.body;

        if (!card_id) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_CARD_ID',
                message: 'Vui lòng nhập ID thẻ RFID'
            });
        }

        // Normalize card ID (same logic as RFIDService)
        const normalizedCardId = card_id.toString().replace(/\D/g, '').padStart(10, '0');

        if (normalizedCardId.length < 8 || normalizedCardId.length > 12) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_CARD_ID',
                message: 'ID thẻ RFID không hợp lệ'
            });
        }

        // Process the same way as automatic RFID scan
        req.body.rfid_card = normalizedCardId;
        return await router.stack.find(layer => layer.route && layer.route.path === '/rfid/scan').route.stack[0].handle(req, res);

    } catch (error) {
        console.error('Manual RFID input error:', error);
        res.status(500).json({
            success: false,
            error: 'MANUAL_RFID_ERROR',
            message: 'Đã xảy ra lỗi khi xử lý thẻ RFID thủ công'
        });
    }
});

// Ensure event_checkpoints table exists (use proper DDL by DB type to avoid noisy errors)
async function ensureEventCheckpointsTable(executeQuery) {
    const { DB_TYPE } = require('../config/database');
    if (DB_TYPE === 'mysql') {
        const createMysql = `
            CREATE TABLE IF NOT EXISTS event_checkpoints (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_name VARCHAR(255) NOT NULL,
                checkpoint_name VARCHAR(100) NOT NULL,
                checkpoint_type VARCHAR(10) NOT NULL,
                display_order INT DEFAULT 1,
                is_active TINYINT(1) DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_event_checkpoint (event_name, checkpoint_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
        await executeQuery(createMysql);
    } else {
        const createSqlite = `
            CREATE TABLE IF NOT EXISTS event_checkpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_name TEXT NOT NULL,
                checkpoint_name TEXT NOT NULL,
                checkpoint_type TEXT NOT NULL,
                display_order INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(event_name, checkpoint_name)
            );`;
        await executeQuery(createSqlite);
    }
}

// Ensure event checkpoint logs table exists to store check actions
async function ensureEventCheckpointLogsTable(executeQuery) {
    const { DB_TYPE } = require('../config/database');
    if (DB_TYPE === 'mysql') {
        const createMysql = `
            CREATE TABLE IF NOT EXISTS event_checkpoint_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_id INT NOT NULL,
                user_id VARCHAR(50) NOT NULL,
                checkpoint_name VARCHAR(100) NOT NULL,
                action_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                method VARCHAR(20) DEFAULT 'manual',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_event_user (event_id, user_id),
                INDEX idx_event_checkpoint (event_id, checkpoint_name),
                CONSTRAINT fk_ecl_event FOREIGN KEY (event_id) REFERENCES events(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
        await executeQuery(createMysql);
    } else {
        const createSqlite = `
            CREATE TABLE IF NOT EXISTS event_checkpoint_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                checkpoint_name TEXT NOT NULL,
                action_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                method TEXT DEFAULT 'manual',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );`;
        await executeQuery(createSqlite);
    }
}

// List events for event manager (active only)
router.get('/event-manager/events', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        // Allow any authenticated user to see active events
        const rows = await executeQuery(
            "SELECT id, name, status FROM events WHERE status = 'active' OR status IS NULL ORDER BY COALESCE(start_date, created_at) DESC, name ASC"
        );
        res.json({ success: true, events: rows || [] });
    } catch (error) {
        console.error('List manager events error:', error);
        res.status(500).json({ success: false, message: 'Không thể tải danh sách sự kiện' });
    }
});

// Availability matrix for an event
router.get('/event-manager/available', requireAuth, async (req, res) => {
    try {
        const { executeQuery, DB_TYPE } = require('../config/database');
        const { event_name } = req.query;
        if (!event_name) {
            return res.status(400).json({ success: false, error: 'MISSING_EVENT_NAME', message: 'Thiếu tên sự kiện' });
        }

        // Resolve event by name
        const ev = await executeQuery('SELECT id, name FROM events WHERE name = ? LIMIT 1', [event_name]);
        if (!ev || !ev[0]) {
            return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Không tìm thấy sự kiện' });
        }
        const eventId = ev[0].id;

        // Get active checkpoints for event (use event_name per existing schema)
        const cps = await executeQuery(
            'SELECT checkpoint_name FROM event_checkpoints WHERE event_name = ? AND is_active = TRUE ORDER BY display_order',
            [event_name]
        );
        const headers = (cps || []).map(r => r.checkpoint_name);

        // Get participants of this event
        const participants = await executeQuery(
            'SELECT user_id, COALESCE(name, "") AS name, COALESCE(phone, "") AS phone FROM event_participants WHERE event_id = ? ORDER BY user_id',
            [eventId]
        );

        // Build log map: user_id -> checkpoint_name -> last_time
        let logsRows;
        if (DB_TYPE === 'mysql') {
            logsRows = await executeQuery(
                `SELECT user_id, checkpoint_name, MAX(action_time) AS last_time
                 FROM event_checkpoint_logs
                 WHERE event_id = ?
                 GROUP BY user_id, checkpoint_name`,
                [eventId]
            );
        } else {
            logsRows = await executeQuery(
                `SELECT user_id, checkpoint_name, MAX(action_time) AS last_time
                 FROM event_checkpoint_logs
                 WHERE event_id = ?
                 GROUP BY user_id, checkpoint_name`,
                [eventId]
            );
        }

        const logMap = new Map();
        for (const r of logsRows || []) {
            const uid = String(r.user_id);
            const key = uid + '::' + r.checkpoint_name;
            let val = r.last_time;
            try {
                const d = new Date(r.last_time);
                if (!isNaN(d.getTime())) {
                    // Format "YYYY-MM-DD HH:mm:ss"
                    const pad = n => String(n).padStart(2, '0');
                    val = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                }
            } catch (_) { /* keep original */ }
            logMap.set(key, val);
        }

        // Compose customers data
        const customers = (participants || []).map(p => {
            const row = { id: String(p.user_id), name: p.name || '', phone: p.phone || '' };
            headers.forEach(h => {
                const key = String(p.user_id) + '::' + h;
                row[h] = logMap.get(key) || '';
            });
            return row;
        });

        return res.json({ success: true, headers, customers });
    } catch (error) {
        console.error('Availability error:', error);
        return res.status(500).json({ success: false, error: 'AVAILABILITY_ERROR', message: 'Không thể tải tình trạng sự kiện' });
    }
});

// Remove a participant from event (also delete logs)
router.post('/event-manager/remove-participant', requireAuth, async (req, res) => {
    try {
        const { executeQuery, executeTransaction } = require('../config/database');
        const { event_name, user_id } = req.body || {};

        if (!event_name || !user_id) {
            return res.status(400).json({ success: false, error: 'MISSING_FIELDS', message: 'Thiếu event_name hoặc user_id' });
        }
        // Restrict to admin or event_manager
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa người khỏi sự kiện' });
        }

        const ev = await executeQuery('SELECT id FROM events WHERE name = ? LIMIT 1', [event_name]);
        if (!ev || !ev[0]) {
            return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Không tìm thấy sự kiện' });
        }
        const eventId = ev[0].id;

        const queries = [
            { query: 'DELETE FROM event_checkpoint_logs WHERE event_id = ? AND user_id = ?', params: [eventId, user_id] },
            { query: 'DELETE FROM event_participants WHERE event_id = ? AND user_id = ?', params: [eventId, user_id] }
        ];

        const results = await executeTransaction(queries);
        const logsDeleted = results?.[0]?.affectedRows ?? results?.[0]?.changes ?? 0;
        const participantsDeleted = results?.[1]?.affectedRows ?? results?.[1]?.changes ?? 0;

        return res.json({ success: true, message: 'Đã xóa người khỏi sự kiện', logsDeleted, participantsDeleted });
    } catch (error) {
        console.error('Remove participant error:', error);
        return res.status(500).json({ success: false, error: 'REMOVE_PARTICIPANT_ERROR', message: 'Không thể xóa người khỏi sự kiện' });
    }
});

// Export availability report to Excel
router.get('/event-manager/export-availability', requireAuth, async (req, res) => {
    try {
        const { executeQuery, DB_TYPE } = require('../config/database');
        const { event_name } = req.query;
        if (!event_name) {
            return res.status(400).json({ success: false, error: 'MISSING_EVENT_NAME', message: 'Thiếu tên sự kiện' });
        }
        // Restrict to admin or event_manager
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xuất báo cáo' });
        }

        // Resolve event
        const ev = await executeQuery('SELECT id, name FROM events WHERE name = ? LIMIT 1', [event_name]);
        if (!ev || !ev[0]) {
            return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Không tìm thấy sự kiện' });
        }
        const eventId = ev[0].id;

        // Checkpoints
        const cps = await executeQuery(
            'SELECT checkpoint_name FROM event_checkpoints WHERE event_name = ? AND is_active = TRUE ORDER BY display_order',
            [event_name]
        );
        const headers = (cps || []).map(r => r.checkpoint_name);

        // Participants
        const participants = await executeQuery(
            'SELECT user_id, COALESCE(name, "") AS name, COALESCE(phone, "") AS phone FROM event_participants WHERE event_id = ? ORDER BY user_id',
            [eventId]
        );

        // Logs map
        const logsRows = await executeQuery(
            `SELECT user_id, checkpoint_name, MAX(action_time) AS last_time
             FROM event_checkpoint_logs WHERE event_id = ? GROUP BY user_id, checkpoint_name`,
            [eventId]
        );
        const logMap = new Map();
        for (const r of logsRows || []) {
            const key = String(r.user_id) + '::' + r.checkpoint_name;
            logMap.set(key, r.last_time || '');
        }

        // Build worksheet data
        const sheetRows = [];
        const headerRow = ['ID', 'Name', 'Phone', ...headers];
        sheetRows.push(headerRow);
        for (const p of participants || []) {
            const row = [String(p.user_id), p.name || '', p.phone || ''];
            headers.forEach(h => {
                const val = logMap.get(String(p.user_id) + '::' + h) || '';
                row.push(val);
            });
            sheetRows.push(row);
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sheetRows);
        XLSX.utils.book_append_sheet(wb, ws, 'Availability');

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const safeName = event_name.replace(/[^a-zA-Z0-9_-]+/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="availability_${safeName}.xlsx"`);
        return res.send(buf);
    } catch (error) {
        console.error('Export availability error:', error);
        return res.status(500).json({ success: false, error: 'EXPORT_ERROR', message: 'Không thể xuất báo cáo' });
    }
});

// Import participants (CSV parsed client-side)
// Core import function reused by multiple routes
async function importParticipantsCore({ event_name, event_id, participants }) {
    const { executeQuery, DB_TYPE } = require('../config/database');

    if ((!event_name && !event_id) || !Array.isArray(participants) || participants.length === 0) {
        return { ok: false, status: 400, body: { success: false, message: 'Thiếu thông tin sự kiện hoặc danh sách participants' } };
    }

    // Resolve event id
    let resolvedEventId = event_id ? parseInt(event_id, 10) : null;
    if (!resolvedEventId && event_name) {
        const ev = await executeQuery('SELECT id FROM events WHERE name = ? LIMIT 1', [event_name]);
        if (ev && ev[0]) resolvedEventId = ev[0].id;
    }
    if (!resolvedEventId) {
        return { ok: false, status: 404, body: { success: false, message: 'Không tìm thấy sự kiện' } };
    }

    // Detect event_participants schema (columns and constraints)
    let cols = new Map();
    let userIdMaxLen = null; // null => unknown/no limit check
    let userIdIsNumeric = false;
    let statusColumn = 'status'; // default for MySQL schema in this project
    let registeredAtColumn = 'registered_at';
    let hasNameCol = false;
    let hasPhoneCol = false;
    let nameMaxLen = null;
    let phoneMaxLen = null;

    try {
        if (DB_TYPE === 'mysql') {
            const colRows = await executeQuery(
                `SELECT COLUMN_NAME as name, DATA_TYPE as dataType, CHARACTER_MAXIMUM_LENGTH as maxLen
                 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_participants'`
            );
            for (const r of colRows) {
                cols.set(r.name, r);
            }
            hasNameCol = cols.has('name');
            hasPhoneCol = cols.has('phone');
            // Ensure optional text columns exist for better UX
            if (!hasNameCol) {
                try {
                    await executeQuery("ALTER TABLE event_participants ADD COLUMN name VARCHAR(255) NULL AFTER user_id");
                    hasNameCol = true;
                } catch (_) { /* ignore if cannot alter */ }
            }
            if (!hasPhoneCol) {
                try {
                    await executeQuery("ALTER TABLE event_participants ADD COLUMN phone VARCHAR(50) NULL AFTER name");
                    hasPhoneCol = true;
                } catch (_) { /* ignore if cannot alter */ }
            }
            statusColumn = cols.has('status') ? 'status' : (cols.has('attendance_status') ? 'attendance_status' : 'status');
            registeredAtColumn = cols.has('registered_at') ? 'registered_at' : (cols.has('registration_time') ? 'registration_time' : 'registered_at');
            if (hasNameCol) nameMaxLen = (cols.get('name')?.maxLen) || 255;
            if (hasPhoneCol) phoneMaxLen = (cols.get('phone')?.maxLen) || 50;
            const uidCol = cols.get('user_id');
            if (uidCol) {
                userIdMaxLen = uidCol.maxLen || null;
                userIdIsNumeric = ['int', 'bigint', 'mediumint', 'smallint', 'tinyint'].includes((uidCol.dataType || '').toLowerCase());
                const dt = (uidCol.dataType || '').toLowerCase();
                // If schema mistakenly uses binary/blob for user_id, attempt to fix to VARCHAR(50)
                if (['blob', 'binary', 'varbinary'].includes(dt)) {
                    try {
                        await executeQuery("ALTER TABLE event_participants MODIFY user_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL");
                        // refresh info
                        userIdIsNumeric = false;
                        userIdMaxLen = 50;
                    } catch (alterErr) {
                        // fall back to casting during reads; continue import but enforce max 50
                        userIdIsNumeric = false;
                        userIdMaxLen = 50;
                    }
                }
            }
        } else {
            // SQLite
            const pragma = await executeQuery(`PRAGMA table_info(event_participants)`);
            for (const r of pragma) {
                cols.set(r.name || r.Name || r.column_name || r.cid, r);
            }
            hasNameCol = cols.has('name');
            hasPhoneCol = cols.has('phone');
            statusColumn = cols.has('status') ? 'status' : (cols.has('attendance_status') ? 'attendance_status' : 'status');
            registeredAtColumn = cols.has('registered_at') ? 'registered_at' : (cols.has('registration_time') ? 'registration_time' : 'registered_at');
            // In sqlite schema we set VARCHAR(20) for user_id
            userIdMaxLen = 20;
            nameMaxLen = 255;
            phoneMaxLen = 50;
        }
    } catch (e) {
        // If schema introspection fails, fall back to safe defaults
        userIdMaxLen = userIdMaxLen ?? 20;
    }

    let inserted = 0, updated = 0, skipped = 0;
    const skippedReasons = { missingFields: 0, idTooLong: 0, idInvalid: 0 };

    // Helpers
    const normalizePhone = (s) => {
        if (!s) return '';
        const cleaned = s.replace(/[^+\d]/g, '');
        return cleaned;
    };

    for (const p of participants) {
        const uidRaw = (p.id ?? p.ID ?? '').toString().trim();
        let name = (p.name ?? p.Name ?? '').toString().trim();
        let phone = normalizePhone((p.phone ?? p.Phone ?? '').toString().trim());

        // Require at least ID; name is optional if table doesn't have it
        if (!uidRaw) { skipped++; skippedReasons.missingFields++; continue; }

        // Validate user_id per schema
        let uid = uidRaw;
        if (userIdIsNumeric) {
            if (!/^\d+$/.test(uidRaw)) { skipped++; skippedReasons.idInvalid++; continue; }
            uid = parseInt(uidRaw, 10);
        } else if (userIdMaxLen && uidRaw.length > userIdMaxLen) {
            // Do not truncate silently; skip and report
            skipped++; skippedReasons.idTooLong++; continue;
        }

        // Apply max length constraints for name/phone if present
        if (hasNameCol && nameMaxLen && name && name.length > nameMaxLen) {
            name = name.slice(0, nameMaxLen);
        }
        if (hasPhoneCol && phoneMaxLen && phone && phone.length > phoneMaxLen) {
            phone = phone.slice(0, phoneMaxLen);
        }

        // Check if participant already exists
        const rows = await executeQuery(
            'SELECT id FROM event_participants WHERE event_id = ? AND user_id = ? LIMIT 1',
            [resolvedEventId, uid]
        );

        if (rows && rows.length > 0) {
            // Build dynamic UPDATE set
            const updateFields = [];
            const params = [];
            if (hasNameCol && name) { updateFields.push('name = ?'); params.push(name); }
            if (hasPhoneCol && phone) { updateFields.push('phone = ?'); params.push(phone); }
            // Ensure status column exists before attempting to update
            if (statusColumn) { updateFields.push(`${statusColumn} = COALESCE(${statusColumn}, ?)`); params.push('registered'); }
            if (updateFields.length > 0) {
                params.push(resolvedEventId, uid);
                await executeQuery(
                    `UPDATE event_participants SET ${updateFields.join(', ')} WHERE event_id = ? AND user_id = ?`,
                    params
                );
            }
            updated++;
        } else {
            // Build dynamic INSERT
            const colsArr = ['event_id', 'user_id'];
            const placeholders = ['?', '?'];
            const values = [resolvedEventId, uid];
            if (hasNameCol) { colsArr.push('name'); placeholders.push('?'); values.push(name || null); }
            if (hasPhoneCol) { colsArr.push('phone'); placeholders.push('?'); values.push(phone || null); }
            if (statusColumn) { colsArr.push(statusColumn); placeholders.push('?'); values.push('registered'); }
            if (registeredAtColumn) {
                colsArr.push(registeredAtColumn);
                if (DB_TYPE === 'mysql') {
                    placeholders.push('NOW()');
                } else {
                    // SQLite CURRENT_TIMESTAMP
                    placeholders.push("datetime('now')");
                }
            }

            await executeQuery(
                `INSERT INTO event_participants (${colsArr.join(', ')}) VALUES (${placeholders.join(', ')})`,
                values
            );
            inserted++;
        }
    }

    return { ok: true, status: 200, body: { success: true, inserted, updated, skipped, details: skippedReasons } };
}

// Import participants (CSV parsed client-side)
router.post('/event-manager/import-participants', requireAuth, async (req, res) => {
    try {
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập' });
        }
        const result = await importParticipantsCore({
            event_name: req.body?.event_name,
            event_id: req.body?.event_id,
            participants: req.body?.participants
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('Import participants error:', error);
        res.status(500).json({ success: false, message: 'Lỗi import participants: ' + error.message });
    }
});

// Import participants via CSV file upload (server-side parsing)
// multipart/form-data fields: event_name or event_id, file field named "file"
router.post('/event-manager/import-participants-file', [requireAuth, upload.single('file')], async (req, res) => {
    try {
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập' });
        }
        const event_name = req.body?.event_name;
        const event_id = req.body?.event_id;
        const file = req.file;
        if (!file || !file.buffer) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file CSV (trường file)' });
        }

        // Detect and parse CSV or XLSX: expect columns ID, Name, Phone (all strings)
        const participants = [];
        const originalName = (file.originalname || '').toLowerCase();
        const ext = path.extname(originalName);
        const isExcel = ext === '.xlsx' || ext === '.xls' || /sheet|ms-excel/i.test(file.mimetype || '');

        if (isExcel) {
            // Read first worksheet into array of arrays
            const workbook = XLSX.read(file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] || [];
                // Flatten and trim values
                const parts = row.map(v => (v == null ? '' : String(v))).map(s => s.trim());
                if (parts.length === 0 || parts.every(v => v === '')) continue;
                // Skip header if first row looks like a header
                if (i === 0 && parts.length >= 2 && /id/i.test(parts[0]) && /name/i.test(parts[1])) continue;
                const [ID, Name, Phone] = parts;
                if (!ID || !Name) continue;
                participants.push({ id: String(ID), name: String(Name), phone: Phone !== undefined ? String(Phone) : '' });
            }
        } else {
            // CSV fallback
            const text = file.buffer.toString('utf8');
            const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(',').map(s => s.trim());
                if (i === 0 && parts.length >= 2 && /id/i.test(parts[0]) && /name/i.test(parts[1])) {
                    // header row -> skip
                    continue;
                }
                if (parts.length < 2) continue;
                const [ID, Name, Phone] = parts;
                if (!ID || !Name) continue;
                participants.push({ id: String(ID), name: String(Name), phone: Phone !== undefined ? String(Phone) : '' });
            }
        }

        if (participants.length === 0) {
            return res.status(400).json({ success: false, message: 'File không có dữ liệu hợp lệ (cần có cột ID, Name, Phone; hỗ trợ CSV/XLSX)' });
        }

        const result = await importParticipantsCore({ event_name, event_id, participants });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('Import participants (file) error:', error);
        res.status(500).json({ success: false, message: 'Lỗi import CSV: ' + error.message });
    }
});

// Search event customers (participants) for autocomplete in check page
// GET /api/event-manager/search-event-customers?query=...&event_name=...&event_id=...
router.get('/event-manager/search-event-customers', requireAuth, async (req, res) => {
    try {
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập' });
        }

        const { executeQuery, DB_TYPE } = require('../config/database');
        const query = (req.query.query || '').toString().trim();
        let { event_name, event_id } = req.query || {};
        let limit = parseInt(req.query.limit || '10', 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 10;
        if (limit > 50) limit = 50;

        if ((!event_name && !event_id) || query.length === 0) {
            return res.json({ success: true, employees: [] });
        }

        // Resolve event id from name if needed
        let resolvedEventId = event_id ? parseInt(event_id, 10) : null;
        if (!resolvedEventId && event_name) {
            const ev = await executeQuery('SELECT id FROM events WHERE name = ? LIMIT 1', [event_name]);
            if (ev && ev[0]) resolvedEventId = ev[0].id;
        }
        if (!resolvedEventId) {
            return res.json({ success: true, employees: [] });
        }

        // Build search with safe LIKE patterns
        const like = `%${query}%`;

        let rows;
        if (DB_TYPE === 'mysql') {
            // Use CAST for numeric user_id to allow LIKE
            const sql = `SELECT 
                    ep.user_id AS user_id,
                    COALESCE(ep.name, u.name, '') AS name,
                    COALESCE(ep.phone, '') AS phone
                 FROM event_participants ep
                 LEFT JOIN users u ON u.id = ep.user_id
                 WHERE ep.event_id = ?
                   AND (
                        CAST(ep.user_id AS CHAR) LIKE ?
                        OR COALESCE(ep.name, u.name, '') LIKE ?
                        OR COALESCE(ep.phone, '') LIKE ?
                   )
                 ORDER BY ep.user_id
                 LIMIT ${limit}`;
            rows = await executeQuery(sql, [resolvedEventId, like, like, like]);
        } else {
            // SQLite
            rows = await executeQuery(
                `SELECT 
                    ep.user_id AS user_id,
                    COALESCE(ep.name, u.name, '') AS name,
                    COALESCE(ep.phone, '') AS phone
                 FROM event_participants ep
                 LEFT JOIN users u ON u.id = ep.user_id
                 WHERE ep.event_id = ?
                   AND (
                        ep.user_id LIKE ?
                        OR COALESCE(ep.name, u.name, '') LIKE ?
                        OR COALESCE(ep.phone, '') LIKE ?
                   )
                 ORDER BY ep.user_id
                 LIMIT ?`,
                [resolvedEventId, like, like, like, limit]
            );
        }

        // Normalize to expected shape in UI
        const employees = (rows || []).map(r => ({
            id: String(r.user_id),
            name: r.name || '',
            phone: r.phone || ''
        }));

        return res.json({ success: true, employees });
    } catch (error) {
        console.error('Search event customers error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tìm kiếm người tham dự' });
    }
});

// List checkpoints of an event
router.post('/event-manager/list-checkpoints', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập' });
        }
        const { event_name, event_id } = req.body || {};
        let resolvedEventName = event_name;
        if (!resolvedEventName && event_id) {
            const ev = await executeQuery('SELECT name FROM events WHERE id = ?', [event_id]);
            if (ev && ev[0]) resolvedEventName = ev[0].name;
        }
        if (!resolvedEventName) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin sự kiện (event_name hoặc event_id)' });
        }
        await ensureEventCheckpointsTable(executeQuery);
        const rows = await executeQuery(
            'SELECT checkpoint_name, checkpoint_type, display_order FROM event_checkpoints WHERE event_name = ? AND is_active = 1 ORDER BY display_order ASC, checkpoint_name ASC',
            [resolvedEventName]
        );
        const columns = rows.map(r => ({ name: r.checkpoint_name, type: r.checkpoint_type, order: r.display_order }));
        res.json({ success: true, columns });
    } catch (error) {
        console.error('List checkpoints error:', error);
        res.status(500).json({ success: false, message: 'Không thể tải checkpoints' });
    }
});

// Add checkpoint
router.post('/event-manager/add-checkpoint', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập' });
        }
        const { event_name, event_id, checkpoint_name, checkpoint_type, display_order } = req.body || {};
        // Resolve event name from id if provided
        let resolvedEventName = event_name;
        if (!resolvedEventName && event_id) {
            const ev = await executeQuery('SELECT name FROM events WHERE id = ?', [event_id]);
            if (ev && ev[0]) resolvedEventName = ev[0].name;
        }
        // Only require event and checkpoint name; type can default to 'IN' if absent
        if (!resolvedEventName || !checkpoint_name) {
            console.warn('add-checkpoint missing fields:', { event_name, event_id, checkpoint_name, checkpoint_type });
            return res.status(400).json({ success: false, message: 'Thiếu trường bắt buộc (event_name/event_id, checkpoint_name)' });
        }
        // Pick type from multiple possible field names, default to IN if absent
        const rawType = (checkpoint_type ?? req.body?.type ?? req.body?.checkpointType ?? 'IN');
        const type = String(rawType).toUpperCase();
        if (!['IN', 'OUT'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Loại checkpoint phải là IN hoặc OUT' });
        }

        // Normalize checkpoint name: uppercase, convert spaces/dashes to underscore
        const name = String(checkpoint_name).trim().replace(/[\s-]+/g, '_').toUpperCase();
        if (!/^[A-Z0-9_]+$/.test(name)) {
            return res.status(400).json({ success: false, message: 'Tên checkpoint chỉ được chứa A-Z, 0-9 và _' });
        }
        const order = Number.isFinite(display_order) ? display_order : parseInt(display_order || '1', 10);
        await ensureEventCheckpointsTable(executeQuery);

        // Upsert-like: try insert; if duplicate, return conflict
        try {
            await executeQuery(
                'INSERT INTO event_checkpoints (event_name, checkpoint_name, checkpoint_type, display_order, is_active) VALUES (?, ?, ?, ?, 1)',
                [resolvedEventName, name, type, order]
            );
        } catch (e) {
            // If already exists but inactive, reactivate and update
            await executeQuery(
                'UPDATE event_checkpoints SET checkpoint_type = ?, display_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE event_name = ? AND checkpoint_name = ?',
                [type, order, resolvedEventName, name]
            );
        }

        res.json({ success: true, message: 'Thêm checkpoint thành công' });
    } catch (error) {
        console.error('Add checkpoint error:', error);
        res.status(500).json({ success: false, message: 'Không thể thêm checkpoint' });
    }
});

// Remove checkpoint (soft delete)
router.post('/event-manager/remove-checkpoint', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        if (!req.user || !['admin', 'event_manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập' });
        }
        const { event_name, event_id, checkpoint_name } = req.body || {};
        let resolvedEventName = event_name;
        if (!resolvedEventName && event_id) {
            const ev = await executeQuery('SELECT name FROM events WHERE id = ?', [event_id]);
            if (ev && ev[0]) resolvedEventName = ev[0].name;
        }
        if (!resolvedEventName || !checkpoint_name) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin sự kiện (event_name/event_id) hoặc checkpoint' });
        }
        await ensureEventCheckpointsTable(executeQuery);
        const result = await executeQuery(
            'UPDATE event_checkpoints SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE event_name = ? AND checkpoint_name = ?',
            [resolvedEventName, checkpoint_name]
        );
        res.json({ success: true, message: 'Xóa checkpoint thành công' });
    } catch (error) {
        console.error('Remove checkpoint error:', error);
        res.status(500).json({ success: false, message: 'Không thể xóa checkpoint' });
    }
});

// Get current events for attendance
router.get('/events/current', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const today = moment().format('YYYY-MM-DD');
        const now = moment().format('HH:mm:ss');

        const events = await executeQuery(`
            SELECT e.*, 
                   COUNT(ep.id) as participant_count,
                   (SELECT COUNT(*) FROM event_participants ep2 WHERE ep2.event_id = e.id AND ep2.user_id = ?) as user_registered
            FROM events e 
            LEFT JOIN event_participants ep ON e.id = ep.event_id
            WHERE e.status = 'active' 
              AND e.start_date <= ? 
              AND e.end_date >= ?
              AND e.start_time <= ?
              AND e.end_time >= ?
            GROUP BY e.id
            ORDER BY e.start_date ASC, e.start_time ASC
        `, [req.user.id, today, today, now, now]);

        res.json({
            success: true,
            data: events
        });

    } catch (error) {
        console.error('Get current events error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_CURRENT_EVENTS_ERROR',
            message: 'Không thể lấy danh sách sự kiện hiện tại'
        });
    }
});

// Get all active locations
router.get('/locations', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');

        const locations = await executeQuery(`
            SELECT id, name, description, address 
            FROM locations 
            WHERE is_active = true 
            ORDER BY name ASC
        `);

        res.json({
            success: true,
            locations: locations
        });
    } catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi tải danh sách vị trí',
            error: error.message
        });
    }
});

// Check-in attendance with location
router.post('/attendance/checkin', [requireAuth, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { rfid_card, location, method, force_action } = req.body;

        if (!rfid_card) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_RFID',
                message: 'Vui lòng quét thẻ RFID hoặc nhập mã nhân viên'
            });
        }

        if (!location) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_LOCATION',
                message: 'Vui lòng chọn vị trí'
            });
        }

        // Resolve target user by RFID card from users table
        let userId = req.user.id;
        try {
            console.log(`🔍 [CHECKIN] Looking up RFID card: ${rfid_card}`);
            const rfidOwner = await User.findByRfidCard(rfid_card);
            console.log(`🔍 [CHECKIN] RFID owner found:`, rfidOwner ? { id: rfidOwner.id, name: rfidOwner.name } : 'NULL');
            if (rfidOwner && rfidOwner.id) {
                userId = rfidOwner.id;
                console.log(`✅ [CHECKIN] Target user ID set to: ${userId}`);
            } else {
                console.log(`⚠️ [CHECKIN] No user found for RFID ${rfid_card}, using logged-in user: ${req.user.id}`);
            }
        } catch (e) {
            console.error(`❌ [CHECKIN] Error looking up RFID card:`, e.message);
            // Ignore lookup errors and keep fallback to logged-in user
        }
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

        // Determine action type
        let actionType = 'check_in'; // Default action

        // If force_action is specified (from frontend), use it directly
        if (force_action && (force_action === 'check_in' || force_action === 'check_out')) {
            actionType = force_action;
        } else {
            // Otherwise, use the old logic for backward compatibility
            const lastScan = await Attendance.getLastScanForUser(userId, today);

            if (lastScan) {
                // If last scan was check_in, next should be check_out
                actionType = lastScan.actionType === 'check_in' ? 'check_out' : 'check_in';
            }
        }

        // Get location name from database
        let locationName = location;
        if (location && !isNaN(location)) {
            const { executeQuery } = require('../config/database');
            const locationRecords = await executeQuery(
                'SELECT name FROM locations WHERE id = ? AND is_active = true',
                [location]
            );
            locationName = locationRecords.length > 0 ? locationRecords[0].name : 'Unknown Location';
        } else {
            // If location is a string (like from mock data), find it in database
            const { executeQuery } = require('../config/database');
            const locationRecords = await executeQuery(
                'SELECT id, name FROM locations WHERE (id = ? OR name = ?) AND is_active = true',
                [location, location]
            );
            if (locationRecords.length > 0) {
                locationName = locationRecords[0].name;
                location = locationRecords[0].id;
            }
        }

        // Record attendance
        const attendanceData = {
            userId,
            rfidCard: rfid_card,
            scanTime: currentTime,
            scanDate: today,
            actionType,
            eventId: null, // For work attendance, event_id is null
            clientIp: req.networkInfo?.clientIp || req.ip || null,
            gatewayIp: req.networkInfo?.gatewayIp || null,
            wifiName: req.networkInfo?.wifiName || null,
            location: locationName || null,
            notes: (req.user?.id && req.user.id !== userId) ? `scanned_by:${req.user.id}, method:${method || 'manual'}` : `method:${method || 'manual'}`, // Store both scanner and method
            status: 'valid'
        };

        const attendance = await Attendance.recordAttendance(attendanceData);

        // Emit real-time update
        if (req.io) {
            req.io.emit('attendance_update', {
                type: 'work_attendance',
                action: actionType,
                user: req.user.toJSON(),
                attendance: attendance,
                timestamp: currentTime,
                location: locationName
            });
        }

        console.log(`${req.user.name} (${req.user.id}) ${actionType} for user ${userId} at ${locationName} - ${currentTime}`);

        res.json({
            success: true,
            message: actionType === 'check_in' ? 'Chấm công vào thành công' : 'Chấm công ra thành công',
            data: {
                action: actionType,
                time: currentTime,
                location: locationName,
                method: method,
                user: req.user.toJSON(),
                attendance: attendance
            }
        });

    } catch (error) {
        console.error('Check-in attendance error:', error);
        res.status(500).json({
            success: false,
            error: 'CHECKIN_ERROR',
            message: 'Đã xảy ra lỗi khi chấm công. Vui lòng thử lại.'
        });
    }
});

// Search employees for manual input
router.get('/employees/search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim().length < 2) {
            return res.json({
                success: true,
                employees: []
            });
        }

        const { executeQuery } = require('../config/database');
        const searchQuery = `%${q.trim()}%`;

        const employees = await executeQuery(`
            SELECT id, name, email, department, status
            FROM users 
            WHERE (name LIKE ? OR email LIKE ? OR id LIKE ?) 
              AND status = 'active' 
              AND role IN ('staff', 'admin')
            ORDER BY name ASC 
            LIMIT 10
        `, [searchQuery, searchQuery, searchQuery]);

        res.json({
            success: true,
            employees: employees
        });

    } catch (error) {
        console.error('Search employees error:', error);
        res.status(500).json({
            success: false,
            error: 'SEARCH_ERROR',
            message: 'Không thể tìm kiếm nhân viên'
        });
    }
});

// Check-out attendance with location
router.post('/attendance/checkout', [requireAuth, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { rfid_card, location, method } = req.body;

        if (!rfid_card) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_RFID',
                message: 'Vui lòng quét thẻ RFID hoặc nhập mã nhân viên'
            });
        }

        if (!location) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_LOCATION',
                message: 'Vui lòng chọn vị trí'
            });
        }

        // Resolve target user by RFID card from users table
        let userId = req.user.id;
        try {
            console.log(`🔍 [CHECKOUT] Looking up RFID card: ${rfid_card}`);
            const rfidOwner = await User.findByRfidCard(rfid_card);
            console.log(`🔍 [CHECKOUT] RFID owner found:`, rfidOwner ? { id: rfidOwner.id, name: rfidOwner.name } : 'NULL');
            if (rfidOwner && rfidOwner.id) {
                userId = rfidOwner.id;
                console.log(`✅ [CHECKOUT] Target user ID set to: ${userId}`);
            } else {
                console.log(`⚠️ [CHECKOUT] No user found for RFID ${rfid_card}, using logged-in user: ${req.user.id}`);
            }
        } catch (e) {
            console.error(`❌ [CHECKOUT] Error looking up RFID card:`, e.message);
            // Ignore lookup errors and keep fallback to logged-in user
        }
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

        // Force check-out action
        const actionType = 'check_out';

        // Get location name from database
        let locationName = location;
        if (location && !isNaN(location)) {
            const { executeQuery } = require('../config/database');
            const locationRecords = await executeQuery(
                'SELECT name FROM locations WHERE id = ? AND is_active = true',
                [location]
            );
            locationName = locationRecords.length > 0 ? locationRecords[0].name : 'Unknown Location';
        } else {
            // If location is a string (like from mock data), find it in database
            const { executeQuery } = require('../config/database');
            const locationRecords = await executeQuery(
                'SELECT id, name FROM locations WHERE (id = ? OR name = ?) AND is_active = true',
                [location, location]
            );
            if (locationRecords.length > 0) {
                locationName = locationRecords[0].name;
                location = locationRecords[0].id;
            }
        }

        // Record attendance
        const attendanceData = {
            userId,
            rfidCard: rfid_card,
            scanTime: currentTime,
            scanDate: today,
            actionType,
            eventId: null, // For work attendance, event_id is null
            clientIp: req.networkInfo?.clientIp || req.ip || null,
            gatewayIp: req.networkInfo?.gatewayIp || null,
            wifiName: req.networkInfo?.wifiName || null,
            location: locationName || null,
            notes: (req.user?.id && req.user.id !== userId) ? `scanned_by:${req.user.id}, method:${method || 'manual'}` : `method:${method || 'manual'}`, // Store both scanner and method
            status: 'valid'
        };

        const attendance = await Attendance.recordAttendance(attendanceData);

        // Emit real-time update
        if (req.io) {
            req.io.emit('attendance_update', {
                type: 'work_attendance',
                action: actionType,
                user: req.user.toJSON(),
                attendance: attendance,
                timestamp: currentTime,
                location: locationName
            });
        }

        console.log(`${req.user.name} (${req.user.id}) ${actionType} for user ${userId} at ${locationName} - ${currentTime}`);

        res.json({
            success: true,
            message: actionType === 'check_in' ? 'Chấm công vào thành công' : 'Chấm công ra thành công',
            data: {
                action: actionType,
                time: currentTime,
                location: locationName,
                method: method,
                user: req.user.toJSON(),
                attendance: attendance
            }
        });

    } catch (error) {
        console.error('Check-out attendance error:', error);
        res.status(500).json({
            success: false,
            error: 'CHECKOUT_ERROR',
            message: 'Đã xảy ra lỗi khi chấm công. Vui lòng thử lại.'
        });
    }
});

// Get availability status for all employees
router.get('/availability-status', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const today = moment.tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');

        // Get active staff users only (exclude admin and event_manager from availability display)
        const usersQuery = `
            SELECT u.id, u.name, u.department, u.is_active, u.created_at
            FROM users u 
            WHERE u.is_active = 1 AND u.role = 'staff'
            ORDER BY u.department ASC, u.name ASC
        `;

        const users = await executeQuery(usersQuery);

        console.log('🔍 [Availability Status] Total users found:', users ? users.length : 0);
        console.log('🔍 [Availability Status] Sample user:', users && users[0] ? users[0] : 'N/A');

        if (!users || users.length === 0) {
            return res.json({
                success: true,
                employees: [],
                message: 'Không có nhân viên nào trong hệ thống'
            });
        }

        // Build maps from today's attendance:
        // 1) latest check-in per user today (to decide availability and show location/time)
        const latestCheckInQuery = `
            SELECT 
                a.user_id,
                a.scan_time,
                a.location,
                ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a.scan_time DESC) as rn
            FROM attendance a
            WHERE a.scan_date = ? AND a.status = 'valid' AND a.action_type = 'check_in'
        `;
        const latestCheckIns = await executeQuery(latestCheckInQuery, [today]);

        const latestCheckInMap = {};
        latestCheckIns.forEach(rec => {
            if (rec.rn === 1) {
                latestCheckInMap[rec.user_id] = rec;
            }
        });

        // 2) Optionally: latest action per user today for richer "last update" if needed later
        // Kept simple: we'll show last check-in time for available users; otherwise a default message

        // Build employee data with availability based on any check-in today
        const employees = users.map(user => {
            const latestCheckIn = latestCheckInMap[user.id];

            // Determine if employee has at least one check-in today
            const hasCheckedIn = !!latestCheckIn;

            // Format last update time (use last check-in time when available)
            let lastUpdate = 'Chưa check-in hôm nay';
            if (latestCheckIn && latestCheckIn.scan_time) {
                const updateTime = moment.tz(latestCheckIn.scan_time, 'Asia/Ho_Chi_Minh');
                lastUpdate = updateTime.format('HH:mm DD/MM');
            }

            return {
                id: user.id,
                name: user.name || 'N/A',
                cardId: user.id,
                department: user.department || 'N/A',
                isAvailable: hasCheckedIn,
                currentLocation: hasCheckedIn && latestCheckIn ? (latestCheckIn.location || 'Main Office') : null,
                lastUpdate: lastUpdate,
                lastAction: hasCheckedIn ? 'check_in' : null
            };
        });

        console.log('🔍 [Availability Status] Total employees in response:', employees.length);
        console.log('🔍 [Availability Status] Checked-in count:', employees.filter(e => e.isAvailable).length);

        res.json({
            success: true,
            employees: employees,
            total: employees.length,
            availableCount: employees.filter(emp => emp.isAvailable).length,
            date: today
        });

    } catch (error) {
        console.error('Get availability status error:', error);
        res.status(500).json({
            success: false,
            error: 'AVAILABILITY_ERROR',
            message: 'Đã xảy ra lỗi khi lấy trạng thái nhân viên'
        });
    }
});

// Get all events
router.get('/events', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const { status } = req.query;

        let query = `
            SELECT e.*, u.name as creator_name,
                   COUNT(ep.id) as current_participants
            FROM events e 
            LEFT JOIN users u ON e.created_by = u.id 
            LEFT JOIN event_participants ep ON e.id = ep.event_id
        `;

        const params = [];

        if (status) {
            query += ' WHERE e.status = ?';
            params.push(status);
        }

        query += ` 
            GROUP BY e.id, e.name, e.description, e.start_date, e.end_date, 
                     e.start_time, e.end_time, e.created_by, e.status, 
                     e.max_participants, e.created_at, e.updated_at, u.name
            ORDER BY e.start_date ASC, e.start_time ASC
        `;

        const events = await executeQuery(query, params);

        res.json({
            success: true,
            events: events || [],
            total: events ? events.length : 0
        });

    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({
            success: false,
            error: 'EVENTS_ERROR',
            message: 'Đã xảy ra lỗi khi lấy danh sách sự kiện'
        });
    }
});

// Create new event
router.post('/events', requireAuth, async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const { name, description, start_date, end_date, start_time, end_time, max_participants } = req.body;

        // Validation
        if (!name || !start_date || !end_date || !start_time || !end_time) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_FIELDS',
                message: 'Vui lòng điền đầy đủ thông tin bắt buộc'
            });
        }

        const eventData = {
            name: name.trim(),
            description: description ? description.trim() : null,
            start_date,
            end_date,
            start_time,
            end_time,
            created_by: req.user.id,
            max_participants: max_participants ? parseInt(max_participants) : null,
            status: 'active'
        };

        const insertQuery = `
            INSERT INTO events (name, description, start_date, end_date, start_time, end_time, created_by, max_participants, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const result = await executeQuery(insertQuery, [
            eventData.name,
            eventData.description,
            eventData.start_date,
            eventData.end_date,
            eventData.start_time,
            eventData.end_time,
            eventData.created_by,
            eventData.max_participants,
            eventData.status
        ]);

        res.json({
            success: true,
            message: 'Tạo sự kiện thành công',
            event: {
                id: result.insertId,
                ...eventData
            }
        });

    } catch (error) {
        console.error('Create event error:', error);
        res.status(500).json({
            success: false,
            error: 'CREATE_EVENT_ERROR',
            message: 'Đã xảy ra lỗi khi tạo sự kiện'
        });
    }
});

// Get event participants
router.get('/events/:id/participants', requireAuth, async (req, res) => {
    try {
        const { executeQuery, DB_TYPE } = require('../config/database');
        const { id } = req.params;

        // Introspect columns for portability (MySQL/SQLite differences)
        let cols = new Map();
        let hasNameCol = false;
        let hasPhoneCol = false;
        let hasCheckedIn = false;
        let hasCheckedOut = false;
        let statusColumn = 'status';
        let registeredAtColumn = 'registered_at';
        let userIdNeedsCast = false;

        try {
            if (DB_TYPE === 'mysql') {
                const colRows = await executeQuery(
                    `SELECT COLUMN_NAME as name, DATA_TYPE as dataType
                     FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_participants'`
                );
                for (const r of colRows) cols.set(r.name, r);
                hasNameCol = cols.has('name');
                hasPhoneCol = cols.has('phone');
                hasCheckedIn = cols.has('checked_in_at');
                hasCheckedOut = cols.has('checked_out_at');
                statusColumn = cols.has('status') ? 'status' : (cols.has('attendance_status') ? 'attendance_status' : 'status');
                registeredAtColumn = cols.has('registered_at') ? 'registered_at' : (cols.has('registration_time') ? 'registration_time' : 'registered_at');
                const uidCol = cols.get('user_id');
                if (uidCol) {
                    const dt = (uidCol.dataType || '').toLowerCase();
                    if (['blob', 'binary', 'varbinary'].includes(dt)) userIdNeedsCast = true;
                }
            } else {
                const pragma = await executeQuery(`PRAGMA table_info(event_participants)`);
                for (const r of pragma) cols.set(r.name || r.Name || r.column_name || r.cid, r);
                hasNameCol = cols.has('name');
                hasPhoneCol = cols.has('phone');
                hasCheckedIn = cols.has('checked_in_at');
                hasCheckedOut = cols.has('checked_out_at');
                statusColumn = cols.has('status') ? 'status' : (cols.has('attendance_status') ? 'attendance_status' : 'status');
                registeredAtColumn = cols.has('registered_at') ? 'registered_at' : (cols.has('registration_time') ? 'registration_time' : 'registered_at');
            }
        } catch (_) { /* ignore and use defaults */ }

        const userIdSelect = userIdNeedsCast ? 'CAST(ep.user_id AS CHAR) AS user_id' : 'ep.user_id AS user_id';
        const nameSelect = hasNameCol ? 'ep.name AS name' : 'u.name AS name';
        const phoneSelect = hasPhoneCol ? 'ep.phone AS phone' : 'NULL AS phone';
        const checkedInSelect = hasCheckedIn ? 'ep.checked_in_at' : 'NULL AS checked_in_at';
        const checkedOutSelect = hasCheckedOut ? 'ep.checked_out_at' : 'NULL AS checked_out_at';
        const statusSelect = `COALESCE(ep.${statusColumn}, 'registered') AS status`;
        const registeredAtSelect = `COALESCE(ep.${registeredAtColumn}, ep.registered_at, ep.registration_time) AS registered_at`;

        const participantsQuery = `
            SELECT ${userIdSelect},
                   ${nameSelect},
                   ${phoneSelect},
                   ${checkedInSelect},
                   ${checkedOutSelect},
                   ${statusSelect},
                   ${registeredAtSelect},
                   u.name AS user_name
            FROM event_participants ep
            LEFT JOIN users u ON ep.user_id = u.id
            WHERE ep.event_id = ?
            ORDER BY COALESCE(ep.${registeredAtColumn}, ep.registered_at, ep.registration_time) ASC
        `;

        const participants = await executeQuery(participantsQuery, [id]);

        res.json({
            success: true,
            participants: participants || [],
            total: participants ? participants.length : 0
        });

    } catch (error) {
        console.error('Get event participants error:', error);
        res.status(500).json({
            success: false,
            error: 'PARTICIPANTS_ERROR',
            message: 'Đã xảy ra lỗi khi lấy danh sách tham gia'
        });
    }
});

// Event attendance check-in/check-out
router.post('/attendance/event', [requireAuth, requireCompanyNetwork, rfidScanLimiter], async (req, res) => {
    try {
        const { event_id, rfid_card, method } = req.body;

        if (!event_id || !rfid_card) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_FIELDS',
                message: 'Vui lòng cung cấp đầy đủ thông tin'
            });
        }

        const userId = req.user.id;
        const now = moment.tz('Asia/Ho_Chi_Minh');
        const currentTime = now.format('YYYY-MM-DD HH:mm:ss');
        const today = now.format('YYYY-MM-DD');

        // Check for duplicate scan (anti-spam)
        const isDuplicate = await Attendance.checkDuplicateScan(userId, rfid_card, 5);
        if (isDuplicate) {
            return res.status(429).json({
                success: false,
                error: 'DUPLICATE_SCAN',
                message: 'Vui lòng chờ 5 giây trước khi quét lại'
            });
        }

        // Get last scan for this event
        const lastScan = await Attendance.getLastScanForUser(userId, today, event_id);
        let actionType = 'check_in';

        if (lastScan && lastScan.event_id == event_id) {
            actionType = lastScan.actionType === 'check_in' ? 'check_out' : 'check_in';
        }

        // Record attendance
        const attendanceData = {
            userId,
            rfidCard: rfid_card,
            scanTime: currentTime,
            scanDate: today,
            actionType,
            eventId: event_id,
            clientIp: req.networkInfo?.clientIp || req.ip || null,
            gatewayIp: req.networkInfo?.gatewayIp || null,
            wifiName: req.networkInfo?.wifiName || null,
            location: null,
            notes: `Method: ${method || 'manual'}, Event: ${event_id}`,
            status: 'valid'
        };

        const attendance = await Attendance.recordAttendance(attendanceData);

        // Update event participants table
        const { executeQuery } = require('../config/database');

        if (actionType === 'check_in') {
            // Check if participant exists
            const existingParticipant = await executeQuery(
                'SELECT id FROM event_participants WHERE event_id = ? AND user_id = ?',
                [event_id, userId]
            );

            if (existingParticipant.length === 0) {
                // Add new participant
                await executeQuery(
                    'INSERT INTO event_participants (event_id, user_id, status, checked_in_at) VALUES (?, ?, ?, ?)',
                    [event_id, userId, 'attended', currentTime]
                );
            } else {
                // Update existing participant
                await executeQuery(
                    'UPDATE event_participants SET status = ?, checked_in_at = ? WHERE event_id = ? AND user_id = ?',
                    ['attended', currentTime, event_id, userId]
                );
            }
        } else if (actionType === 'check_out') {
            // Update checkout time
            await executeQuery(
                'UPDATE event_participants SET checked_out_at = ? WHERE event_id = ? AND user_id = ?',
                [currentTime, event_id, userId]
            );
        }

        // Emit real-time update
        if (req.io) {
            req.io.emit('attendance_update', {
                type: 'event_attendance',
                action: actionType,
                event_id: event_id,
                user: req.user.toJSON(),
                attendance: attendance,
                timestamp: currentTime
            });
        }

        console.log(`${req.user.name} (${req.user.id}) ${actionType} for event ${event_id} at ${currentTime}`);

        res.json({
            success: true,
            message: actionType === 'check_in' ? 'Check-in sự kiện thành công' : 'Check-out sự kiện thành công',
            data: {
                action: actionType,
                time: currentTime,
                event_id: event_id,
                method: method,
                user: req.user.toJSON(),
                attendance: attendance
            }
        });

    } catch (error) {
        console.error('Event attendance error:', error);
        res.status(500).json({
            success: false,
            error: 'EVENT_ATTENDANCE_ERROR',
            message: 'Đã xảy ra lỗi khi chấm công sự kiện'
        });
    }
});

// Event Manager API Routes
// (removed duplicate '/event-manager/events' without auth)

router.post('/event-manager/list-checkpoints', async (req, res) => {
    console.log('=== List Checkpoints API Called ===');
    console.log('Request body:', req.body);

    try {
        const { executeQuery } = require('../config/database');
        const { event_name } = req.body;

        console.log('Event name from body:', event_name);

        if (!event_name) {
            console.log('Missing event_name in request');
            return res.status(400).json({
                success: false,
                error: 'MISSING_EVENT_NAME',
                message: 'Vui lòng chọn sự kiện'
            });
        }

        // Get checkpoints from event_checkpoints table
        const query = `
            SELECT checkpoint_name, checkpoint_type, display_order
            FROM event_checkpoints
            WHERE event_name = ? AND is_active = TRUE
            ORDER BY display_order
        `;
        console.log('Executing query:', query, 'with event_name:', event_name);

        const checkpoints = await executeQuery(query, [event_name]);
        console.log(`Found ${checkpoints.length} checkpoints for ${event_name}:`, checkpoints);

        const response = {
            success: true,
            columns: checkpoints.map(cp => ({
                name: cp.checkpoint_name,
                type: cp.checkpoint_type
            }))
        };

        console.log('Sending response:', response);
        res.json(response);
    } catch (error) {
        console.error('Error loading checkpoints:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Lỗi khi tải danh sách checkpoint',
            details: error.message
        });
    }
});

// Add checkpoint to event
router.post('/event-manager/add-checkpoint', [requireAuth], async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const { event_name, checkpoint_name, checkpoint_type, display_order } = req.body;

        if (!event_name || !checkpoint_name || !checkpoint_type) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'Vui lòng nhập đầy đủ thông tin checkpoint'
            });
        }

        // Validate checkpoint_type
        if (!['IN', 'OUT'].includes(checkpoint_type)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_CHECKPOINT_TYPE',
                message: 'Loại checkpoint phải là IN hoặc OUT'
            });
        }

        // Check if event table exists
        const tableExists = await executeQuery(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE() 
            AND table_name = ?
        `, [event_name]);

        if (tableExists[0].count === 0) {
            return res.status(404).json({
                success: false,
                error: 'EVENT_NOT_FOUND',
                message: 'Sự kiện không tồn tại'
            });
        }

        // Add column to event table if not exists
        const addColumnQuery = `
            ALTER TABLE \`${event_name}\` 
            ADD COLUMN IF NOT EXISTS \`${checkpoint_name}\` TIMESTAMP NULL
        `;
        await executeQuery(addColumnQuery);

        // Insert into event_checkpoints
        const order = display_order || 999;
        await executeQuery(`
            INSERT INTO event_checkpoints (event_name, checkpoint_name, checkpoint_type, display_order)
            VALUES (?, ?, ?, ?)
        `, [event_name, checkpoint_name, checkpoint_type, order]);

        res.json({
            success: true,
            message: `Checkpoint ${checkpoint_name} đã được thêm vào ${event_name}`
        });
    } catch (error) {
        console.error('Error adding checkpoint:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                error: 'CHECKPOINT_EXISTS',
                message: 'Checkpoint đã tồn tại'
            });
        }
        res.status(500).json({
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Lỗi khi thêm checkpoint'
        });
    }
});

// Remove checkpoint from event
router.post('/event-manager/remove-checkpoint', [requireAuth], async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const { event_name, checkpoint_name } = req.body;

        if (!event_name || !checkpoint_name) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_REQUIRED_FIELDS',
                message: 'Vui lòng chọn sự kiện và checkpoint'
            });
        }

        // Soft delete by setting is_active to FALSE
        const result = await executeQuery(`
            UPDATE event_checkpoints 
            SET is_active = FALSE 
            WHERE event_name = ? AND checkpoint_name = ?
        `, [event_name, checkpoint_name]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'CHECKPOINT_NOT_FOUND',
                message: 'Checkpoint không tồn tại'
            });
        }

        res.json({
            success: true,
            message: `Checkpoint ${checkpoint_name} đã được xóa khỏi ${event_name}`
        });
    } catch (error) {
        console.error('Error removing checkpoint:', error);
        res.status(500).json({
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Lỗi khi xóa checkpoint'
        });
    }
});

// Update checkpoint order
router.post('/event-manager/update-checkpoint-order', [requireAuth], async (req, res) => {
    try {
        const { executeQuery } = require('../config/database');
        const { event_name, checkpoints } = req.body;

        if (!event_name || !Array.isArray(checkpoints)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_REQUEST',
                message: 'Dữ liệu không hợp lệ'
            });
        }

        // Update display order for each checkpoint
        for (const cp of checkpoints) {
            await executeQuery(`
                UPDATE event_checkpoints 
                SET display_order = ? 
                WHERE event_name = ? AND checkpoint_name = ?
            `, [cp.order, event_name, cp.name]);
        }

        res.json({
            success: true,
            message: 'Đã cập nhật thứ tự checkpoint'
        });
    } catch (error) {
        console.error('Error updating checkpoint order:', error);
        res.status(500).json({
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Lỗi khi cập nhật thứ tự checkpoint'
        });
    }
});

router.post('/event-manager/check', [requireAuth, requireCompanyNetwork], async (req, res) => {
    try {
        const { executeQuery, DB_TYPE } = require('../config/database');
        const { event_name, event_id, column_type, card_id, qr_data, customer_id, customer_name, customer_phone } = req.body;

        if (!event_name && !event_id) {
            return res.status(400).json({ success: false, error: 'MISSING_EVENT', message: 'Vui lòng chọn sự kiện' });
        }
        if (!column_type) {
            return res.status(400).json({ success: false, error: 'MISSING_CHECKPOINT', message: 'Vui lòng chọn checkpoint' });
        }

        // Resolve event id from name if needed
        let resolvedEventId = event_id ? parseInt(event_id, 10) : null;
        if (!resolvedEventId && event_name) {
            const ev = await executeQuery('SELECT id FROM events WHERE name = ? LIMIT 1', [event_name]);
            if (ev && ev[0]) resolvedEventId = ev[0].id;
        }
        if (!resolvedEventId) {
            return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Không tìm thấy sự kiện' });
        }

        // Ensure checkpoint exists for this event
        await ensureEventCheckpointsTable(executeQuery);
        const cpRows = await executeQuery(
            'SELECT 1 FROM event_checkpoints WHERE event_name = ? AND checkpoint_name = ? AND is_active = 1 LIMIT 1',
            [event_name || '', column_type]
        );
        if (!cpRows || cpRows.length === 0) {
            return res.status(400).json({ success: false, error: 'CHECKPOINT_NOT_FOUND', message: 'Checkpoint không hợp lệ cho sự kiện này' });
        }

        // Determine identifier
        let identifier = '';
        if (card_id) identifier = String(card_id).trim();
        else if (qr_data) identifier = String(qr_data).trim();
        else if (customer_id) identifier = String(customer_id).trim();
        else return res.status(400).json({ success: false, error: 'NO_IDENTIFIER', message: 'Vui lòng cung cấp thông tin để check' });

        // Ensure participant exists in event_participants, upsert if manual info provided
        let userId = identifier;
        // If user_id column is numeric in MySQL, validate digits
        if (DB_TYPE === 'mysql') {
            try {
                const cols = await executeQuery(`SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_participants' AND COLUMN_NAME = 'user_id'`);
                if (cols && cols[0] && /int/i.test(cols[0].DATA_TYPE)) {
                    if (!/^\d+$/.test(userId)) {
                        return res.status(400).json({ success: false, error: 'INVALID_USER_ID', message: 'ID người dùng không hợp lệ cho schema hiện tại' });
                    }
                }
            } catch (_) { /* ignore */ }
        }

        // Insert participant if not exists and we have name/phone (manual)
        const existing = await executeQuery('SELECT id FROM event_participants WHERE event_id = ? AND user_id = ? LIMIT 1', [resolvedEventId, userId]);
        if (!existing || existing.length === 0) {
            if (customer_name) {
                // Ensure optional columns exist
                if (DB_TYPE === 'mysql') {
                    try { await executeQuery("ALTER TABLE event_participants ADD COLUMN name VARCHAR(255) NULL"); } catch (_) { }
                    try { await executeQuery("ALTER TABLE event_participants ADD COLUMN phone VARCHAR(50) NULL"); } catch (_) { }
                }
            }
            if (customer_name) {
                await executeQuery(
                    `INSERT INTO event_participants (event_id, user_id, name, phone, ${DB_TYPE === 'mysql' ? 'registered_at' : 'registration_time'}, ${DB_TYPE === 'mysql' ? 'status' : 'attendance_status'})
                     VALUES (?, ?, ?, ?, ${DB_TYPE === 'mysql' ? 'NOW()' : "datetime('now')"}, 'registered')`,
                    [resolvedEventId, userId, customer_name, customer_phone || '']
                );
            } else {
                return res.status(404).json({ success: false, error: 'PARTICIPANT_NOT_FOUND', message: 'Không tìm thấy người tham gia trong sự kiện' });
            }
        }

        // Ensure logs table exists and insert log
        await ensureEventCheckpointLogsTable(executeQuery);
        const now = moment.tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD HH:mm:ss');
        await executeQuery(
            'INSERT INTO event_checkpoint_logs (event_id, user_id, checkpoint_name, action_time, method) VALUES (?, ?, ?, ?, ?)',
            [resolvedEventId, userId, column_type, now, card_id ? 'rfid' : (qr_data ? 'qr' : 'manual')]
        );

        // Respond
        res.json({
            success: true,
            message: `Check-in/out thành công cho ${customer_name || userId} tại ${column_type}`,
            data: { user_id: userId, checkpoint: column_type, time: now, event_id: resolvedEventId }
        });
    } catch (error) {
        console.error('Error processing event check:', error);
        res.status(500).json({ success: false, error: 'EVENT_CHECK_ERROR', message: 'Lỗi khi thực hiện check: ' + error.message });
    }
});

// Note: Duplicate older implementation of search-event-customers removed to avoid conflicts.

module.exports = router;