const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

class SQLiteDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, '../../data/rfid_attendance.db');
        this.db = null;
    }

    async connect() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            await fs.mkdir(dataDir, { recursive: true });

            return new Promise((resolve, reject) => {
                this.db = new sqlite3.Database(this.dbPath, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log('Connected to SQLite database');
                        resolve();
                    }
                });
            });
        } catch (error) {
            console.error('Error connecting to SQLite:', error);
            throw error;
        }
    }

    async executeQuery(query, params = []) {
        return new Promise((resolve, reject) => {
            if (query.toLowerCase().includes('select')) {
                this.db.all(query, params, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            } else {
                this.db.run(query, params, function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ insertId: this.lastID, affectedRows: this.changes });
                    }
                });
            }
        });
    }

    async executeTransaction(queries) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("BEGIN TRANSACTION");

                const results = [];
                let error = null;

                const executeNext = (index) => {
                    if (index >= queries.length) {
                        if (error) {
                            this.db.run("ROLLBACK", () => reject(error));
                        } else {
                            this.db.run("COMMIT", () => resolve(results));
                        }
                        return;
                    }

                    const { query, params } = queries[index];
                    this.db.run(query, params, function (err) {
                        if (err) {
                            error = err;
                        } else {
                            results.push({ insertId: this.lastID, affectedRows: this.changes });
                        }
                        executeNext(index + 1);
                    });
                };

                executeNext(0);
            });
        });
    }

    async setupTables() {
        const tables = [
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(20) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'at_work',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )`,

            // Events table
            `CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                created_by VARCHAR(20) NOT NULL,
                status VARCHAR(20) DEFAULT 'active',
                max_participants INTEGER,
                current_participants INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )`,

            // Attendance table
            `CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id VARCHAR(20) NOT NULL,
                rfid_card VARCHAR(50) NOT NULL,
                scan_time DATETIME NOT NULL,
                scan_date DATE NOT NULL,
                action_type VARCHAR(20) NOT NULL,
                event_id INTEGER NULL,
                client_ip VARCHAR(45),
                gateway_ip VARCHAR(45),
                wifi_name VARCHAR(100),
                location VARCHAR(255),
                notes TEXT,
                status VARCHAR(20) DEFAULT 'valid',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (event_id) REFERENCES events(id)
            )`,

            // Event participants table
            `CREATE TABLE IF NOT EXISTS event_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                name VARCHAR(255) NULL,
                phone VARCHAR(50) NULL,
                registration_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                attendance_status VARCHAR(20) DEFAULT 'registered',
                notes TEXT,
                FOREIGN KEY (event_id) REFERENCES events(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(event_id, user_id)
            )`,

            // Work sessions table
            `CREATE TABLE IF NOT EXISTS work_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id VARCHAR(20) NOT NULL,
                work_date DATE NOT NULL,
                check_in_time DATETIME NULL,
                check_out_time DATETIME NULL,
                total_hours DECIMAL(4,2) DEFAULT 0,
                break_time DECIMAL(4,2) DEFAULT 0,
                overtime_hours DECIMAL(4,2) DEFAULT 0,
                status VARCHAR(20) DEFAULT 'in_progress',
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, work_date)
            )`,

            // Network configs table
            `CREATE TABLE IF NOT EXISTS network_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                config_name VARCHAR(100) NOT NULL,
                allowed_ips TEXT,
                allowed_gateways TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // WiFi configs table
            `CREATE TABLE IF NOT EXISTS wifi_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wifi_name VARCHAR(100) NOT NULL,
                is_allowed BOOLEAN DEFAULT 1,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Locations table
            `CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // System logs table
            `CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_level VARCHAR(20) DEFAULT 'info',
                category VARCHAR(50),
                message TEXT NOT NULL,
                user_id VARCHAR(20) NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                additional_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`
        ];

        for (const table of tables) {
            await this.executeQuery(table);
        }

        // Ensure optional columns exist for legacy databases
        const epCols = await this.executeQuery(`PRAGMA table_info(event_participants)`);
        const epColNames = new Set(epCols.map(c => c.name));
        if (!epColNames.has('name')) {
            await this.executeQuery(`ALTER TABLE event_participants ADD COLUMN name VARCHAR(255) NULL`);
        }
        if (!epColNames.has('phone')) {
            await this.executeQuery(`ALTER TABLE event_participants ADD COLUMN phone VARCHAR(50) NULL`);
        }

        // Create indexes
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
            'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
            'CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, scan_date)',
            'CREATE INDEX IF NOT EXISTS idx_attendance_rfid ON attendance(rfid_card)',
            'CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)',
            'CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date)'
        ];

        for (const index of indexes) {
            await this.executeQuery(index);
        }
    }

    async seedInitialData() {
        // Check if admin user exists (both old and new format)
        const adminExists = await this.executeQuery(
            'SELECT COUNT(*) as count FROM users WHERE username IN (?, ?)',
            ['admin', 'admin@company.com']
        );

        if (adminExists[0].count === 0) {
            // Insert default admin user with new email format
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('123456', 10);

            await this.executeQuery(`
                INSERT INTO users (id, name, username, password, role) VALUES 
                (?, ?, ?, ?, ?)
            `, [
                'ADMIN001',
                'System Administrator',
                'admin@company.com',
                hashedPassword,
                'admin'
            ]);

            // Insert default staff user
            await this.executeQuery(`
                INSERT INTO users (id, name, username, password, role) VALUES 
                (?, ?, ?, ?, ?)
            `, [
                'STAFF001',
                'Staff User',
                'staff@company.com',
                hashedPassword,
                'staff'
            ]);

            console.log('✅ Default admin user created');
        }

        // Insert default network config
        const networkExists = await this.executeQuery(
            'SELECT COUNT(*) as count FROM network_configs WHERE config_name = ?',
            ['Default Office Network']
        );

        if (networkExists[0].count === 0) {
            await this.executeQuery(`
                INSERT INTO network_configs (config_name, allowed_ips, allowed_gateways, is_active) VALUES 
                (?, ?, ?, ?)
            `, [
                'Default Office Network',
                JSON.stringify(['192.168.1.0/24', '10.0.0.0/24']),
                JSON.stringify(['192.168.1.1', '10.0.0.1']),
                1
            ]);

            console.log('✅ Default network config created');
        }

        // Insert default WiFi configs
        const wifiExists = await this.executeQuery(
            'SELECT COUNT(*) as count FROM wifi_configs WHERE wifi_name = ?',
            ['OfficeWiFi']
        );

        if (wifiExists[0].count === 0) {
            await this.executeQuery(`
                INSERT INTO wifi_configs (wifi_name, is_allowed, description) VALUES 
                (?, ?, ?)
            `, ['OfficeWiFi', 1, 'Main office WiFi network']);

            await this.executeQuery(`
                INSERT INTO wifi_configs (wifi_name, is_allowed, description) VALUES 
                (?, ?, ?)
            `, ['GuestWiFi', 0, 'Guest WiFi network - restricted']);

            console.log('✅ Default WiFi configs created');
        }
    }

    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    } else {
                        console.log('Database connection closed');
                    }
                    resolve();
                });
            });
        }
    }
}

// Create singleton instance
const database = new SQLiteDatabase();

// Export functions for compatibility with MySQL version
async function executeQuery(query, params = []) {
    if (!database.db) {
        await database.connect();
    }
    return database.executeQuery(query, params);
}

async function executeTransaction(queries) {
    if (!database.db) {
        await database.connect();
    }
    return database.executeTransaction(queries);
}

async function initializeDatabase() {
    try {
        await database.connect();
        await database.setupTables();
        await database.seedInitialData();
        console.log('✅ SQLite database initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        return false;
    }
}

module.exports = {
    executeQuery,
    executeTransaction,
    initializeDatabase,
    database
};