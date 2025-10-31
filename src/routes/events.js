const express = require('express');
const router = express.Router();
const { executeQuery } = require('../config/database');
const { requireEventManager } = require('../middleware/auth');
const moment = require('moment-timezone');

// Event Dashboard
router.get('/', requireEventManager, (req, res) => {
    res.render('events/index', {
        title: 'Event Dashboard - Hệ thống chấm công RFID',
        user: req.user
    });
});

// View & Create Events page
router.get('/viewcreate', requireEventManager, (req, res) => {
    res.render('events/viewcreate', {
        title: 'Quản Lý Sự Kiện - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Event Check page
router.get('/check', requireEventManager, (req, res) => {
    res.render('events/check', {
        title: 'Event Check - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Event Results/Available page
router.get('/available', requireEventManager, (req, res) => {
    res.render('events/available', {
        title: 'Event Results - Hệ thống chấm công RFID',
        user: req.user
    });
});

// Create event page
router.get('/create', requireEventManager, (req, res) => {
    res.render('events/create', {
        title: 'Tạo sự kiện mới',
        user: req.user
    });
});

// NOTE: API routes must be declared BEFORE parameterized routes like '/:id'

// Get all events API
router.get('/api/list', requireEventManager, async (req, res) => {
    try {
        const { status = 'active', upcoming = 'false' } = req.query;

        let query = `
            SELECT e.*, u.name as creator_name,
                   COUNT(ep.id) as participant_count
            FROM events e 
            LEFT JOIN users u ON e.created_by = u.id 
            LEFT JOIN event_participants ep ON e.id = ep.event_id
            WHERE 1=1
        `;
        const params = [];

        if (status !== 'all') {
            query += ' AND e.status = ?';
            params.push(status);
        }

        if (upcoming === 'true') {
            const today = moment().format('YYYY-MM-DD');
            query += ' AND e.end_date >= ?';
            params.push(today);
        }

        query += ' GROUP BY e.id ORDER BY e.start_date DESC';

        const events = await executeQuery(query, params);

        res.json({
            success: true,
            data: events
        });

    } catch (error) {
        console.error('Get events API error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_EVENTS_ERROR',
            message: 'Không thể lấy danh sách sự kiện'
        });
    }
});

// Create event API
router.post('/api/create', requireEventManager, async (req, res) => {
    try {
        const { name, description, start_date, end_date, start_time, end_time, max_participants } = req.body;

        if (!name || !start_date || !end_date || !start_time || !end_time) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_FIELDS',
                message: 'Vui lòng điền đầy đủ thông tin sự kiện'
            });
        }

        // Validate dates
        const startDate = moment(start_date);
        const endDate = moment(end_date);

        if (!startDate.isValid() || !endDate.isValid()) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_DATE',
                message: 'Ngày không hợp lệ'
            });
        }

        if (endDate.isBefore(startDate)) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_DATE_RANGE',
                message: 'Ngày kết thúc phải sau ngày bắt đầu'
            });
        }

        const query = `
            INSERT INTO events (name, description, start_date, end_date, start_time, end_time, max_participants, created_by, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `;

        const params = [
            name,
            description || '',
            start_date,
            end_date,
            start_time,
            end_time,
            max_participants || null,
            req.user.id
        ];

        const result = await executeQuery(query, params);

        console.log(`Event manager ${req.user.username} created event: ${name}`);

        // Emit real-time update
        req.io.emit('event_created', {
            id: result.insertId,
            name,
            creator: req.user.name,
            start_date,
            end_date
        });

        res.json({
            success: true,
            message: 'Tạo sự kiện thành công',
            data: { id: result.insertId }
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

// Update event API
router.put('/api/events/:id', requireEventManager, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, start_date, end_date, start_time, end_time, max_participants, status } = req.body;

        // Check if event exists
        const existingEvent = await executeQuery('SELECT * FROM events WHERE id = ?', [id]);
        if (existingEvent.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'EVENT_NOT_FOUND',
                message: 'Sự kiện không tồn tại'
            });
        }

        const updates = [];
        const params = [];

        if (name) {
            updates.push('name = ?');
            params.push(name);
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }

        if (start_date) {
            updates.push('start_date = ?');
            params.push(start_date);
        }

        if (end_date) {
            updates.push('end_date = ?');
            params.push(end_date);
        }

        if (start_time) {
            updates.push('start_time = ?');
            params.push(start_time);
        }

        if (end_time) {
            updates.push('end_time = ?');
            params.push(end_time);
        }

        if (max_participants !== undefined) {
            updates.push('max_participants = ?');
            params.push(max_participants);
        }

        if (status) {
            updates.push('status = ?');
            params.push(status);
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        const query = `UPDATE events SET ${updates.join(', ')} WHERE id = ?`;
        await executeQuery(query, params);

        console.log(`Event manager ${req.user.username} updated event: ${id}`);

        res.json({
            success: true,
            message: 'Cập nhật sự kiện thành công'
        });

    } catch (error) {
        console.error('Update event error:', error);
        res.status(500).json({
            success: false,
            error: 'UPDATE_EVENT_ERROR',
            message: 'Đã xảy ra lỗi khi cập nhật sự kiện'
        });
    }
});

// Get event participants API
router.get('/api/events/:id/participants', requireEventManager, async (req, res) => {
    try {
        const { id } = req.params;

        const participants = await executeQuery(
            `SELECT ep.*, u.name as user_name, u.username
             FROM event_participants ep 
             LEFT JOIN users u ON ep.user_id = u.id 
             WHERE ep.event_id = ?
             ORDER BY ep.registered_at DESC`,
            [id]
        );

        res.json({
            success: true,
            data: participants
        });

    } catch (error) {
        console.error('Get event participants error:', error);
        res.status(500).json({
            success: false,
            error: 'GET_PARTICIPANTS_ERROR',
            message: 'Không thể lấy danh sách người tham gia'
        });
    }
});

// Register user for event API
router.post('/api/events/:id/register', requireEventManager, async (req, res) => {
    try {
        const { id } = req.params;
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_USER_ID',
                message: 'Vui lòng chọn người dùng'
            });
        }

        // Check if event exists
        const event = await executeQuery('SELECT * FROM events WHERE id = ? AND status = "active"', [id]);
        if (event.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'EVENT_NOT_FOUND',
                message: 'Sự kiện không tồn tại hoặc không hoạt động'
            });
        }

        // Check if user already registered
        const existingRegistration = await executeQuery(
            'SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?',
            [id, user_id]
        );

        if (existingRegistration.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'ALREADY_REGISTERED',
                message: 'Người dùng đã đăng ký sự kiện này'
            });
        }

        // Check participant limit
        if (event[0].max_participants) {
            const currentParticipants = await executeQuery(
                'SELECT COUNT(*) as count FROM event_participants WHERE event_id = ?',
                [id]
            );

            if (currentParticipants[0].count >= event[0].max_participants) {
                return res.status(400).json({
                    success: false,
                    error: 'EVENT_FULL',
                    message: 'Sự kiện đã đầy'
                });
            }
        }

        // Register user
        await executeQuery(
            'INSERT INTO event_participants (event_id, user_id, status) VALUES (?, ?, "registered")',
            [id, user_id]
        );

        // Update current participants count
        await executeQuery(
            'UPDATE events SET current_participants = (SELECT COUNT(*) FROM event_participants WHERE event_id = ?) WHERE id = ?',
            [id, id]
        );

        console.log(`User ${user_id} registered for event ${id} by ${req.user.username}`);

        res.json({
            success: true,
            message: 'Đăng ký sự kiện thành công'
        });

    } catch (error) {
        console.error('Register for event error:', error);
        res.status(500).json({
            success: false,
            error: 'REGISTER_EVENT_ERROR',
            message: 'Đã xảy ra lỗi khi đăng ký sự kiện'
        });
    }
});

// Delete (soft-delete) event API
router.delete('/api/events/:id', requireEventManager, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if event exists
        const existing = await executeQuery('SELECT * FROM events WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'EVENT_NOT_FOUND',
                message: 'Sự kiện không tồn tại'
            });
        }

        // Soft delete by setting status to inactive
        await executeQuery(
            'UPDATE events SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
            'inactive', id
        ]
        );

        console.log(`Event manager ${req.user.username} deleted (soft) event: ${id}`);

        return res.json({
            success: true,
            message: 'Xóa sự kiện thành công'
        });
    } catch (error) {
        console.error('Delete event error:', error);
        return res.status(500).json({
            success: false,
            error: 'DELETE_EVENT_ERROR',
            message: 'Đã xảy ra lỗi khi xóa sự kiện'
        });
    }
});

// Event details page (placed AFTER API routes to avoid route conflicts)
router.get('/:id', requireEventManager, async (req, res) => {
    try {
        const { id } = req.params;

        const [eventResults, participantsResults] = await Promise.all([
            executeQuery(
                `SELECT e.*, u.name as creator_name 
                 FROM events e 
                 LEFT JOIN users u ON e.created_by = u.id 
                 WHERE e.id = ?`,
                [id]
            ),
            executeQuery(
                `SELECT ep.*, u.name as user_name 
                 FROM event_participants ep 
                 LEFT JOIN users u ON ep.user_id = u.id 
                 WHERE ep.event_id = ?
                 ORDER BY ep.registered_at DESC`,
                [id]
            )
        ]);

        if (eventResults.length === 0) {
            return res.status(404).render('error', {
                title: 'Sự kiện không tìm thấy',
                message: 'Sự kiện bạn đang tìm kiếm không tồn tại.',
                error: { status: 404 }
            });
        }

        const event = eventResults[0];
        const participants = participantsResults;

        res.render('events/details', {
            title: `Sự kiện: ${event.name}`,
            user: req.user,
            event,
            participants
        });

    } catch (error) {
        console.error('Event details error:', error);
        res.status(500).render('error', {
            title: 'Lỗi hệ thống',
            message: 'Đã xảy ra lỗi khi tải thông tin sự kiện.',
            error: { status: 500 }
        });
    }
});

module.exports = router;