const rateLimit = require('express-rate-limit');
const config = require('../config/config');

// General rate limiting
const generalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use safe key generator for development
    keyGenerator: (req) => {
        return req.ip || req.socket.remoteAddress || 'unknown';
    },
    // Skip rate limiting in development for localhost
    skip: (req) => {
        const ip = req.ip || req.socket.remoteAddress;
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }
});

// Login rate limiting (stricter)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: {
        success: false,
        error: 'LOGIN_RATE_LIMIT_EXCEEDED',
        message: 'Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau 15 phút.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests
    skipSuccessfulRequests: true,
    // Use safe key generator
    keyGenerator: (req) => {
        return req.ip || req.socket.remoteAddress || 'unknown';
    },
    // Skip rate limiting for localhost in development
    skip: (req) => {
        const ip = req.ip || req.socket.remoteAddress;
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }
});

// RFID scan rate limiting
const rfidScanLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 scans per minute
    message: {
        success: false,
        error: 'RFID_SCAN_RATE_LIMIT',
        message: 'Quá nhiều lần quét thẻ. Vui lòng chờ một chút.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.socket.remoteAddress || 'unknown';
    },
    skip: (req) => {
        const ip = req.ip || req.socket.remoteAddress;
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }
});

// API rate limiting (for API endpoints)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Higher limit for API
    message: {
        success: false,
        error: 'API_RATE_LIMIT_EXCEEDED',
        message: 'API rate limit exceeded. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.socket.remoteAddress || 'unknown';
    },
    skip: (req) => {
        const ip = req.ip || req.socket.remoteAddress;
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }
});

// Admin operations rate limiting
const adminLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 50, // 50 admin operations per 5 minutes
    message: {
        success: false,
        error: 'ADMIN_RATE_LIMIT_EXCEEDED',
        message: 'Quá nhiều thao tác quản trị. Vui lòng chờ một chút.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.socket.remoteAddress || 'unknown';
    },
    skip: (req) => {
        const ip = req.ip || req.socket.remoteAddress;
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    }
});

module.exports = {
    generalLimiter,
    loginLimiter,
    rfidScanLimiter,
    apiLimiter,
    adminLimiter
};