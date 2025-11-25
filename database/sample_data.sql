-- Sample Data for RFID Attendance System
USE rfid_attendance;

-- Insert sample users (password: 123456 - hashed with bcrypt, 10 rounds)
-- Note: You should change these passwords in production
INSERT INTO users (id, name, username, password, role, is_active) VALUES
('ADMIN001', 'Admin User', 'admin', '$2b$10$rZ5qH3qH5qH3qH5qH3qH3e7KqH3qH5qH3qH5qH3qH5qH3qH5qH3qH', 'admin', 1),
('STAFF001', 'Nguyễn Văn A', 'staff001', '$2b$10$rZ5qH3qH5qH3qH5qH3qH3e7KqH3qH5qH3qH5qH3qH5qH3qH5qH3qH', 'at_work', 1),
('STAFF002', 'Trần Thị B', 'staff002', '$2b$10$rZ5qH3qH5qH3qH5qH3qH3e7KqH3qH5qH3qH5qH3qH5qH3qH5qH3qH', 'at_work', 1),
('STAFF003', 'Lê Văn C', 'staff003', '$2b$10$rZ5qH3qH5qH3qH5qH3qH3e7KqH3qH5qH3qH5qH3qH5qH3qH5qH3qH', 'at_work', 1),
('EVENT001', 'Phạm Thị D', 'event001', '$2b$10$rZ5qH3qH5qH3qH5qH3qH3e7KqH3qH5qH3qH5qH3qH5qH3qH5qH3qH', 'event', 1);

-- Insert sample locations
INSERT INTO locations (name, description, is_active) VALUES
('Văn phòng chính', 'Tầng 4, Tòa nhà B', 1),
('Khu sản xuất', 'Nhà máy A', 1),
('Hội trường', 'Phòng họp lớn', 1);

-- Insert sample WiFi configs
INSERT INTO wifi_configs (wifi_name, is_allowed, description) VALUES
('B408', 1, 'WiFi văn phòng chính'),
('Company_Guest', 1, 'WiFi khách'),
('Production_Area', 1, 'WiFi khu sản xuất');

-- Insert sample network config
INSERT INTO network_configs (config_name, allowed_ips, allowed_gateways, is_active) VALUES
('Main Office', '192.168.1.0/24,10.0.0.0/24', '192.168.1.1,10.0.0.1', 1);

-- Insert sample events
INSERT INTO events (name, description, start_date, end_date, start_time, end_time, created_by, status, max_participants) VALUES
('Đào tạo nhân viên mới 2025', 'Khóa đào tạo nhân viên mới tháng 11', '2025-11-26', '2025-11-30', '08:00:00', '17:00:00', 'ADMIN001', 'active', 50),
('Hội nghị cuối năm', 'Hội nghị tổng kết năm 2025', '2025-12-15', '2025-12-15', '13:00:00', '18:00:00', 'ADMIN001', 'active', 100),
('Workshop công nghệ', 'Workshop về AI và Machine Learning', '2025-12-01', '2025-12-01', '09:00:00', '12:00:00', 'ADMIN001', 'active', 30);

-- Insert sample event participants
INSERT INTO event_participants (event_id, user_id, name, phone, attendance_status) VALUES
(1, 'STAFF001', 'Nguyễn Văn A', '0901234567', 'registered'),
(1, 'STAFF002', 'Trần Thị B', '0902234567', 'registered'),
(1, 'STAFF003', 'Lê Văn C', '0903234567', 'registered'),
(2, 'STAFF001', 'Nguyễn Văn A', '0901234567', 'registered'),
(2, 'EVENT001', 'Phạm Thị D', '0904234567', 'registered'),
(3, 'STAFF002', 'Trần Thị B', '0902234567', 'registered');

-- Insert sample event checkpoints
INSERT INTO event_checkpoints (event_id, checkpoint_name, checkpoint_type, description, sequence_order, is_active) VALUES
(1, 'Điểm danh sáng', 'check_in', 'Điểm danh buổi sáng', 1, 1),
(1, 'Điểm danh chiều', 'check_out', 'Điểm danh buổi chiều', 2, 1),
(2, 'Check-in hội nghị', 'check_in', 'Đăng ký tham dự hội nghị', 1, 1),
(3, 'Điểm danh Workshop', 'check_in', 'Điểm danh tham gia workshop', 1, 1);

-- Insert sample work sessions for today
INSERT INTO work_sessions (user_id, work_date, check_in_time, status) VALUES
('STAFF001', CURDATE(), NOW() - INTERVAL 2 HOUR, 'in_progress'),
('STAFF002', CURDATE(), NOW() - INTERVAL 3 HOUR, 'in_progress');

-- Insert sample attendance records
INSERT INTO attendance (user_id, rfid_card, scan_time, scan_date, action_type, client_ip, wifi_name, status) VALUES
('STAFF001', 'RFID001', NOW() - INTERVAL 2 HOUR, CURDATE(), 'check_in', '192.168.1.100', 'B408', 'valid'),
('STAFF002', 'RFID002', NOW() - INTERVAL 3 HOUR, CURDATE(), 'check_in', '192.168.1.101', 'B408', 'valid'),
('STAFF003', 'RFID003', NOW() - INTERVAL 1 DAY, CURDATE() - INTERVAL 1 DAY, 'check_in', '192.168.1.102', 'B408', 'valid'),
('STAFF003', 'RFID003', NOW() - INTERVAL 1 DAY + INTERVAL 8 HOUR, CURDATE() - INTERVAL 1 DAY, 'check_out', '192.168.1.102', 'B408', 'valid');

-- Insert sample system logs
INSERT INTO system_logs (log_level, category, message, user_id, ip_address) VALUES
('info', 'authentication', 'User logged in successfully', 'ADMIN001', '192.168.1.100'),
('info', 'attendance', 'Check-in recorded', 'STAFF001', '192.168.1.100'),
('info', 'attendance', 'Check-in recorded', 'STAFF002', '192.168.1.101'),
('info', 'system', 'Database initialized successfully', NULL, '127.0.0.1');

-- Show summary
SELECT 'Database initialized successfully!' as Status;
SELECT COUNT(*) as TotalUsers FROM users;
SELECT COUNT(*) as TotalEvents FROM events;
SELECT COUNT(*) as TotalAttendance FROM attendance;
SELECT COUNT(*) as TotalWorkSessions FROM work_sessions;
