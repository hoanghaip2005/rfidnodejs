const { executeQuery, executeTransaction } = require('../config/database');
const moment = require('moment-timezone');

// Helper function to sanitize parameters for MySQL
function sanitizeParams(params) {
    return params.map(param => {
        if (param === undefined) return null;
        if (param === '') return null;
        return param;
    });
}

class Attendance {
    constructor(attendanceData) {
        this.id = attendanceData.id;
        this.userId = attendanceData.user_id;
        this.rfidCard = attendanceData.rfid_card;
        this.scanTime = attendanceData.scan_time;
        this.scanDate = attendanceData.scan_date;
        this.actionType = attendanceData.action_type;
        this.eventId = attendanceData.event_id;
        this.clientIp = attendanceData.client_ip;
        this.gatewayIp = attendanceData.gateway_ip;
        this.wifiName = attendanceData.wifi_name;
        this.location = attendanceData.location;
        this.notes = attendanceData.notes;
        this.status = attendanceData.status;
        this.createdAt = attendanceData.created_at;
    }

    // Record new attendance
    static async recordAttendance(attendanceData) {
        try {
            const query = `
                INSERT INTO attendance (
                    user_id, rfid_card, scan_time, scan_date, action_type, 
                    event_id, client_ip, gateway_ip, wifi_name, location, notes, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = sanitizeParams([
                attendanceData.userId,
                attendanceData.rfidCard,
                attendanceData.scanTime,
                attendanceData.scanDate,
                attendanceData.actionType,
                attendanceData.eventId,
                attendanceData.clientIp,
                attendanceData.gatewayIp,
                attendanceData.wifiName,
                attendanceData.location,
                attendanceData.notes,
                attendanceData.status || 'valid'
            ]);

            const result = await executeQuery(query, params);
            return await Attendance.findById(result.insertId);
        } catch (error) {
            console.error('Error recording attendance:', error);
            throw error;
        }
    }

    // Find attendance by ID
    static async findById(id) {
        try {
            const query = `
                SELECT a.*, u.name as user_name, e.name as event_name 
                FROM attendance a 
                LEFT JOIN users u ON a.user_id = u.id 
                LEFT JOIN events e ON a.event_id = e.id 
                WHERE a.id = ?
            `;
            const results = await executeQuery(query, [id]);
            return results.length > 0 ? new Attendance(results[0]) : null;
        } catch (error) {
            console.error('Error finding attendance by ID:', error);
            throw error;
        }
    }

    // Get attendance records by user and date
    static async findByUserAndDate(userId, date) {
        try {
            const query = `
                SELECT a.*, u.name as user_name, e.name as event_name 
                FROM attendance a 
                LEFT JOIN users u ON a.user_id = u.id 
                LEFT JOIN events e ON a.event_id = e.id 
                WHERE a.user_id = ? AND a.scan_date = ? 
                ORDER BY a.scan_time ASC
            `;
            const results = await executeQuery(query, [userId, date]);
            return results.map(record => new Attendance(record));
        } catch (error) {
            console.error('Error finding attendance by user and date:', error);
            throw error;
        }
    }

    // Get attendance records by date range
    static async findByDateRange(startDate, endDate, userId = null) {
        try {
            let query = `
                SELECT a.*, u.name as user_name, e.name as event_name 
                FROM attendance a 
                LEFT JOIN users u ON a.user_id = u.id 
                LEFT JOIN events e ON a.event_id = e.id 
                WHERE a.scan_date BETWEEN ? AND ?
            `;
            const params = [startDate, endDate];

            if (userId) {
                query += ' AND a.user_id = ?';
                params.push(userId);
            }

            query += ' ORDER BY a.scan_time DESC';
            const results = await executeQuery(query, params);
            return results.map(record => new Attendance(record));
        } catch (error) {
            console.error('Error finding attendance by date range:', error);
            throw error;
        }
    }

    // Get last scan for user (to determine next action)
    static async getLastScanForUser(userId, date = null) {
        try {
            let query = `
                SELECT * FROM attendance 
                WHERE user_id = ? AND status = 'valid'
            `;
            const params = [userId];

            if (date) {
                query += ' AND scan_date = ?';
                params.push(date);
            }

            query += ' ORDER BY scan_time DESC LIMIT 1';
            const results = await executeQuery(query, params);
            return results.length > 0 ? new Attendance(results[0]) : null;
        } catch (error) {
            console.error('Error getting last scan for user:', error);
            throw error;
        }
    }

    // Check for duplicate scans (anti-spam)
    static async checkDuplicateScan(userId, rfidCard, minInterval = 5) {
        try {
            const cutoffTime = moment().subtract(minInterval, 'seconds').format('YYYY-MM-DD HH:mm:ss');
            const query = `
                SELECT * FROM attendance 
                WHERE user_id = ? AND rfid_card = ? AND scan_time > ? 
                ORDER BY scan_time DESC LIMIT 1
            `;
            const results = await executeQuery(query, [userId, rfidCard, cutoffTime]);
            return results.length > 0;
        } catch (error) {
            console.error('Error checking duplicate scan:', error);
            return false;
        }
    }

    // Get attendance statistics
    static async getAttendanceStats(startDate, endDate) {
        try {
            const queries = [
                // Total attendance records
                `SELECT COUNT(*) as total_records FROM attendance 
                 WHERE scan_date BETWEEN ? AND ? AND status = 'valid'`,

                // Unique users
                `SELECT COUNT(DISTINCT user_id) as unique_users FROM attendance 
                 WHERE scan_date BETWEEN ? AND ? AND status = 'valid'`,

                // Check-ins vs Check-outs
                `SELECT action_type, COUNT(*) as count FROM attendance 
                 WHERE scan_date BETWEEN ? AND ? AND status = 'valid' 
                 GROUP BY action_type`,

                // Daily attendance count
                `SELECT scan_date, COUNT(*) as daily_count FROM attendance 
                 WHERE scan_date BETWEEN ? AND ? AND status = 'valid' 
                 GROUP BY scan_date ORDER BY scan_date`
            ];

            const results = [];
            for (const query of queries) {
                const result = await executeQuery(query, [startDate, endDate]);
                results.push(result);
            }

            return {
                totalRecords: results[0][0].total_records,
                uniqueUsers: results[1][0].unique_users,
                actionTypeStats: results[2],
                dailyStats: results[3]
            };
        } catch (error) {
            console.error('Error getting attendance stats:', error);
            throw error;
        }
    }

    // Update attendance status
    static async updateStatus(id, status, notes = null) {
        try {
            const query = `
                UPDATE attendance 
                SET status = ?, notes = COALESCE(?, notes) 
                WHERE id = ?
            `;
            await executeQuery(query, sanitizeParams([status, notes, id]));
            return await Attendance.findById(id);
        } catch (error) {
            console.error('Error updating attendance status:', error);
            throw error;
        }
    }

    // Delete attendance record
    static async delete(id) {
        try {
            const query = 'DELETE FROM attendance WHERE id = ?';
            await executeQuery(query, [id]);
            return true;
        } catch (error) {
            console.error('Error deleting attendance:', error);
            throw error;
        }
    }

    // Get attendance report for a user
    static async getUserAttendanceReport(userId, startDate, endDate) {
        try {
            const query = `
                SELECT 
                    scan_date,
                    MIN(CASE WHEN action_type = 'check_in' THEN scan_time END) as first_check_in,
                    MAX(CASE WHEN action_type = 'check_out' THEN scan_time END) as last_check_out,
                    COUNT(CASE WHEN action_type = 'check_in' THEN 1 END) as check_ins,
                    COUNT(CASE WHEN action_type = 'check_out' THEN 1 END) as check_outs
                FROM attendance 
                WHERE user_id = ? AND scan_date BETWEEN ? AND ? AND status = 'valid'
                GROUP BY scan_date 
                ORDER BY scan_date
            `;
            const results = await executeQuery(query, [userId, startDate, endDate]);
            return results;
        } catch (error) {
            console.error('Error getting user attendance report:', error);
            throw error;
        }
    }
}

module.exports = Attendance;