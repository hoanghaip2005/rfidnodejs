const User = require('../models/User');

// Check if user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        // Check if this is an API request or AJAX request
        const isApiRequest = req.path.startsWith('/api/') ||
            req.path.startsWith('/admin/api/') ||
            req.xhr ||
            req.headers.accept?.indexOf('json') > -1 ||
            req.headers['content-type']?.indexOf('json') > -1;

        if (isApiRequest) {
            return res.status(401).json({
                success: false,
                error: 'AUTH_REQUIRED',
                message: 'Vui lòng đăng nhập để tiếp tục'
            });
        }

        // For regular page requests, redirect to login
        return res.redirect('/auth/login');
    }
    next();
};

// Check user role permissions
const requireRole = (allowedRoles) => {
    return async (req, res, next) => {
        try {
            if (!req.session || !req.session.userId) {
                // Check if this is an API request or AJAX request
                const isApiRequest = req.path.startsWith('/api/') ||
                    req.path.startsWith('/admin/api/') ||
                    req.xhr ||
                    req.headers.accept?.indexOf('json') > -1 ||
                    req.headers['content-type']?.indexOf('json') > -1;

                if (isApiRequest) {
                    return res.status(401).json({
                        success: false,
                        error: 'AUTH_REQUIRED',
                        message: 'Vui lòng đăng nhập để tiếp tục'
                    });
                }

                // For regular page requests, redirect to login
                return res.redirect('/auth/login');
            }

            const user = await User.findById(req.session.userId);
            if (!user) {
                // Check if this is an API request or AJAX request
                const isApiRequest = req.path.startsWith('/api/') ||
                    req.path.startsWith('/admin/api/') ||
                    req.xhr ||
                    req.headers.accept?.indexOf('json') > -1 ||
                    req.headers['content-type']?.indexOf('json') > -1;

                if (isApiRequest) {
                    return res.status(401).json({
                        success: false,
                        error: 'USER_NOT_FOUND',
                        message: 'Người dùng không tồn tại'
                    });
                }

                // For regular page requests, redirect to login
                return res.redirect('/auth/login');
            }

            // Check if user role is in allowed roles
            if (!allowedRoles.includes(user.role)) {
                // Check if this is an API request or AJAX request
                const isApiRequest = req.path.startsWith('/api/') ||
                    req.path.startsWith('/admin/api/') ||
                    req.xhr ||
                    req.headers.accept?.indexOf('json') > -1 ||
                    req.headers['content-type']?.indexOf('json') > -1;

                if (isApiRequest) {
                    return res.status(403).json({
                        success: false,
                        error: 'INSUFFICIENT_PERMISSIONS',
                        message: 'Bạn không có quyền truy cập chức năng này'
                    });
                }

                // For regular page requests, redirect to appropriate dashboard
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
                return res.redirect(redirectUrl);
            }

            // Store user in request for use in controllers
            req.user = user;
            next();
        } catch (error) {
            console.error('Role check error:', error);
            return res.status(500).json({
                success: false,
                error: 'AUTH_CHECK_ERROR',
                message: 'Lỗi kiểm tra quyền truy cập'
            });
        }
    };
};

// Admin only access
const requireAdmin = requireRole(['admin']);

// Event manager or admin access
const requireEventManager = requireRole(['admin', 'event_manager']);

// Staff or higher access
const requireStaff = requireRole(['admin', 'event_manager', 'staff']);

// Any authenticated user
const requireUser = requireRole(['admin', 'event_manager', 'staff', 'at_work']);

// Load user data into session
const loadUser = async (req, res, next) => {
    try {
        if (req.session && req.session.userId) {
            const user = await User.findById(req.session.userId);
            if (user) {
                req.user = user;
                res.locals.user = user.toJSON(); // Make user available in templates
            }
        }
        next();
    } catch (error) {
        console.error('Load user error:', error);
        next(); // Continue without user data
    }
};

// Check specific permission
const requirePermission = (permission) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                // Check if this is an API request or AJAX request
                const isApiRequest = req.path.startsWith('/api/') ||
                    req.path.startsWith('/admin/api/') ||
                    req.xhr ||
                    req.headers.accept?.indexOf('json') > -1 ||
                    req.headers['content-type']?.indexOf('json') > -1;

                if (isApiRequest) {
                    return res.status(401).json({
                        success: false,
                        error: 'AUTH_REQUIRED',
                        message: 'Vui lòng đăng nhập để tiếp tục'
                    });
                }

                // For regular page requests, redirect to login
                return res.redirect('/auth/login');
            }

            if (!req.user.hasPermission(permission)) {
                // Check if this is an API request or AJAX request
                const isApiRequest = req.path.startsWith('/api/') ||
                    req.path.startsWith('/admin/api/') ||
                    req.xhr ||
                    req.headers.accept?.indexOf('json') > -1 ||
                    req.headers['content-type']?.indexOf('json') > -1;

                if (isApiRequest) {
                    return res.status(403).json({
                        success: false,
                        error: 'INSUFFICIENT_PERMISSIONS',
                        message: `Bạn không có quyền ${permission}`
                    });
                }

                // For regular page requests, redirect to appropriate dashboard
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
                return res.redirect(redirectUrl);
            }

            next();
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                success: false,
                error: 'PERMISSION_CHECK_ERROR',
                message: 'Lỗi kiểm tra quyền truy cập'
            });
        }
    };
};

// Optional auth (doesn't redirect, just loads user if available)
const optionalAuth = async (req, res, next) => {
    try {
        if (req.session && req.session.userId) {
            const user = await User.findById(req.session.userId);
            if (user) {
                req.user = user;
                res.locals.user = user.toJSON();
            }
        }
        next();
    } catch (error) {
        console.error('Optional auth error:', error);
        next(); // Continue without user data
    }
};

module.exports = {
    requireAuth,
    requireRole,
    requireAdmin,
    requireEventManager,
    requireStaff,
    requireUser,
    requirePermission,
    loadUser,
    optionalAuth
};