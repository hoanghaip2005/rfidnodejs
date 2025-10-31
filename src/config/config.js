require('dotenv').config();

const config = {
    // Server configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development'
    },

    // Session configuration
    session: {
        secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
        resave: false,
        saveUninitialized: false,
        // If rolling is true, reset the cookie Max-Age on every response to keep the session alive during activity
        rolling: process.env.SESSION_ROLLING ? process.env.SESSION_ROLLING === 'true' : true,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    },

    // Security configuration
    security: {
        jwtSecret: process.env.JWT_SECRET || 'jwt-secret-key',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
        enableNetworkRestriction: process.env.ENABLE_NETWORK_RESTRICTION === 'true'
    },

    // RFID configuration
    rfid: {
        timeout: parseInt(process.env.RFID_TIMEOUT) || 5000,
        minScanInterval: parseInt(process.env.MIN_SCAN_INTERVAL) || 5,
        baudRate: 9600
    },

    // Timezone configuration
    timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',

    // Rate limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },

    // CORS configuration
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true
    },

    // Logging configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || 'logs/app.log'
    },

    // Default network settings
    network: {
        defaultWifiNames: process.env.DEFAULT_WIFI_NAMES ?
            process.env.DEFAULT_WIFI_NAMES.split(',') : ['B408']
    }
};

module.exports = config;