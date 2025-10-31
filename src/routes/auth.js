const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { loginLimiter } = require('../middleware/rateLimiter');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// Login page
router.get('/login', optionalAuth, (req, res) => {
    if (req.user) {
        // User already logged in, redirect based on role
        switch (req.user.role) {
            case 'admin':
                return res.redirect('/admin');
            case 'event_manager':
                return res.redirect('/events');
            case 'staff':
                return res.redirect('/staff');
            default:
                return res.redirect('/staff');
        }
    }

    res.render('auth/login', {
        title: 'Đăng nhập - Hệ thống chấm công RFID',
        error: null
    });
});

// Login processing
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password, remember_me } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_CREDENTIALS',
                message: 'Vui lòng nhập tên đăng nhập và mật khẩu'
            });
        }

        // Find user by username
        const user = await User.findByUsername(username.trim());
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'INVALID_CREDENTIALS',
                message: 'Tên đăng nhập hoặc mật khẩu không đúng'
            });
        }

        // Verify password
        const isValidPassword = await user.verifyPassword(password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'INVALID_CREDENTIALS',
                message: 'Tên đăng nhập hoặc mật khẩu không đúng'
            });
        }

        // Create session
        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.userName = user.name;

        // Handle "remember me" to persist login across restarts
        // If remember_me is truthy, extend cookie maxAge (e.g., 30 days)
        // Else, make it a session cookie (cleared when browser closes)
        try {
            const remember = !!remember_me;
            if (remember) {
                // 30 days
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
            } else {
                // Session cookie (no persistent expiration)
                req.session.cookie.expires = false;
            }
        } catch (e) {
            // Non-fatal; proceed with defaults
            console.warn('Remember-me handling failed:', e.message);
        }

        // Determine redirect URL based on role
        let redirectUrl = '/staff';
        switch (user.role) {
            case 'admin':
                redirectUrl = '/admin';
                break;
            case 'event_manager':
                redirectUrl = '/events';
                break;
            case 'staff':
                redirectUrl = '/staff';
                break;
            default:
                redirectUrl = '/staff';
        }

        console.log(`User ${user.username} (${user.role}) logged in successfully`);

        res.json({
            success: true,
            message: 'Đăng nhập thành công',
            user: user.toJSON(),
            redirectUrl
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'LOGIN_ERROR',
            message: 'Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại.'
        });
    }
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
    const username = req.user?.username || 'Unknown';

    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({
                success: false,
                error: 'LOGOUT_ERROR',
                message: 'Đã xảy ra lỗi khi đăng xuất'
            });
        }

        console.log(`User ${username} logged out`);
        res.json({
            success: true,
            message: 'Đăng xuất thành công',
            redirectUrl: '/auth/login'
        });
    });
});

// Get current user info
router.get('/me', requireAuth, (req, res) => {
    res.json({
        success: true,
        user: req.user.toJSON()
    });
});

// Simple auth check for auto-login on the login page
router.get('/check', optionalAuth, (req, res) => {
    if (!req.user) {
        return res.json({ success: false, authenticated: false });
    }

    // Determine redirect URL based on role
    let redirectUrl = '/staff';
    switch (req.user.role) {
        case 'admin':
            redirectUrl = '/admin';
            break;
        case 'event_manager':
            redirectUrl = '/events';
            break;
        case 'staff':
            redirectUrl = '/staff';
            break;
        default:
            redirectUrl = '/staff';
    }

    res.json({
        success: true,
        authenticated: true,
        user: req.user.toJSON(),
        redirectUrl
    });
});

// Change password
router.post('/change-password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_FIELDS',
                message: 'Vui lòng điền đầy đủ thông tin'
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                error: 'PASSWORD_MISMATCH',
                message: 'Mật khẩu mới và xác nhận mật khẩu không khớp'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'PASSWORD_TOO_SHORT',
                message: 'Mật khẩu mới phải có ít nhất 6 ký tự'
            });
        }

        // Verify current password
        const isValidPassword = await req.user.verifyPassword(currentPassword);
        if (!isValidPassword) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_CURRENT_PASSWORD',
                message: 'Mật khẩu hiện tại không đúng'
            });
        }

        // Update password
        await User.update(req.user.id, { password: newPassword });

        console.log(`User ${req.user.username} changed password`);

        res.json({
            success: true,
            message: 'Đổi mật khẩu thành công'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            error: 'CHANGE_PASSWORD_ERROR',
            message: 'Đã xảy ra lỗi khi đổi mật khẩu. Vui lòng thử lại.'
        });
    }
});

module.exports = router;