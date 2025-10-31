require('dotenv').config();

// Determine database type
const DB_TYPE = process.env.DB_TYPE || 'mysql'; // 'mysql' or 'sqlite'

let database;

if (DB_TYPE === 'mysql') {
    const mysql = require('mysql2/promise');

    // MySQL configuration
    const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'rfid_attendance',
        charset: 'utf8mb4',
        connectionLimit: 10,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true,
        timezone: '+07:00' // Vietnam timezone
    };

    // Create connection pool
    const pool = mysql.createPool(dbConfig);
    database = { pool, type: 'mysql' };
} else {
    // Use SQLite for development/testing
    const sqlite = require('./sqlite');
    database = { sqlite, type: 'sqlite' };
}

// Test database connection
async function testConnection() {
    try {
        if (database.type === 'mysql') {
            const connection = await database.pool.getConnection();
            console.log('✅ MySQL Database connected successfully');
            connection.release();
        } else {
            const result = await database.sqlite.initializeDatabase();
            if (result) {
                console.log('✅ SQLite Database connected successfully');
            } else {
                throw new Error('SQLite initialization failed');
            }
        }
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

// Execute query with error handling
async function executeQuery(query, params = []) {
    try {
        if (database.type === 'mysql') {
            let connection;
            try {
                connection = await database.pool.getConnection();
                const [results] = await connection.execute(query, params);
                return results;
            } finally {
                if (connection) connection.release();
            }
        } else {
            return await database.sqlite.executeQuery(query, params);
        }
    } catch (error) {
        console.error('Database query error:', error.message);
        throw error;
    }
}

// Execute transaction
async function executeTransaction(queries) {
    try {
        if (database.type === 'mysql') {
            let connection;
            try {
                connection = await database.pool.getConnection();
                await connection.beginTransaction();

                const results = [];
                for (const { query, params } of queries) {
                    const [result] = await connection.execute(query, params || []);
                    results.push(result);
                }

                await connection.commit();
                return results;
            } catch (error) {
                if (connection) await connection.rollback();
                throw error;
            } finally {
                if (connection) connection.release();
            }
        } else {
            return await database.sqlite.executeTransaction(queries);
        }
    } catch (error) {
        console.error('Transaction error:', error.message);
        throw error;
    }
}

// Close all connections
async function closeConnections() {
    try {
        if (database.type === 'mysql') {
            await database.pool.end();
            console.log('MySQL connections closed');
        } else {
            await database.sqlite.database.close();
            console.log('SQLite connection closed');
        }
    } catch (error) {
        console.error('Error closing database connections:', error.message);
    }
}

module.exports = {
    database,
    testConnection,
    executeQuery,
    executeTransaction,
    closeConnections,
    DB_TYPE
};