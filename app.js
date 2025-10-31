const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

// Import configurations
const config = require('./src/config/config');
const { testConnection } = require('./src/config/database');

// Import middleware
const { generalLimiter } = require('./src/middleware/rateLimiter');
const { loadUser } = require('./src/middleware/auth');
const { optionalNetworkCheck } = require('./src/middleware/networkSecurity');

// Import routes
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const staffRoutes = require('./src/routes/staff');
const eventRoutes = require('./src/routes/events');
const apiRoutes = require('./src/routes/api');

// Import services
const RFIDService = require('./src/services/RFIDService');

// Create Express app
const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = socketIo(server, {
    cors: {
        origin: config.cors.origin,
        credentials: true
    }
});

// Trust proxy configuration - more secure for development
// For production, should specify exact proxy IPs
app.set('trust proxy', 1); // Trust first proxy only

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Allow external styles and Google Fonts
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net",
                "https://fonts.googleapis.com"
            ],
            // Allow inline scripts and external CDNs
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net",
                "https://socket.io"
            ],
            // Permit inline script attributes like onclick/onsubmit
            scriptSrcAttr: ["'self'", "'unsafe-inline'"],
            // Images and fonts
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: [
                "'self'",
                "data:",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net"
            ],
            // Allow connecting to CDN for source maps, websockets, etc.
            connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"]
        }
    }
}));

app.use(cors(config.cors));
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Session configuration
app.use(session({
    secret: config.session.secret,
    resave: config.session.resave,
    saveUninitialized: config.session.saveUninitialized,
    rolling: config.session.rolling,
    cookie: config.session.cookie
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Global middleware
app.use(generalLimiter);
app.use(loadUser);
app.use(optionalNetworkCheck);

// Make io and socketHandlers available in requests
app.use((req, res, next) => {
    req.io = io;
    req.socketHandlers = socketHandlers;
    next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/staff', staffRoutes);
app.use('/event', eventRoutes);
app.use('/api', apiRoutes);

// Root route
app.get('/', (req, res) => {
    res.redirect('/staff');
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const dbConnected = await testConnection();
        const rfidStatus = rfidService.getStatus();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: dbConnected ? 'connected' : 'disconnected',
                rfid: rfidStatus.connected ? 'connected' : 'disconnected',
                socketio: io.engine.clientsCount > 0 ? 'active' : 'idle'
            },
            version: require('./package.json').version
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Trang không tìm thấy',
        message: 'Trang bạn đang tìm kiếm không tồn tại.',
        error: { status: 404 }
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);

    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.'
        });
    } else {
        res.status(500).render('error', {
            title: 'Lỗi hệ thống',
            message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
            error: { status: 500 }
        });
    }
});

// Initialize RFID service
const rfidService = new RFIDService();

// Initialize Socket.IO handlers
const SocketIOHandlers = require('./src/services/SocketIOHandlers');
const socketHandlers = new SocketIOHandlers(io, rfidService);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\\nShutting down gracefully...');

    try {
        await rfidService.disconnect();
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

// Start server
async function startServer() {
    try {
        // Test database connection
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('Failed to connect to database');
            process.exit(1);
        }

        // Initialize RFID service
        await rfidService.connect();
        rfidService.startCleanupTimer();

        // Start HTTP server
        server.listen(config.server.port, config.server.host, () => {
            console.log(`\\n🚀 RFID Attendance System started successfully!`);
            console.log(`📡 Server running on http://${config.server.host}:${config.server.port}`);
            console.log(`🌍 Environment: ${config.server.env}`);
            console.log(`⏰ Timezone: ${config.timezone}`);
            console.log(`\\n📊 Services Status:`);
            console.log(`   ✅ Database: Connected`);
            console.log(`   ${rfidService.getStatus().connected ? '✅' : '❌'} RFID: ${rfidService.getStatus().connected ? 'Connected' : 'Disconnected'}`);
            console.log(`   ✅ Socket.IO: Ready`);
            console.log(`\\n🔐 Security Features:`);
            console.log(`   ✅ Rate Limiting: Enabled`);
            console.log(`   ✅ Network Restriction: ${config.security.enableNetworkRestriction ? 'Enabled' : 'Disabled'}`);
            console.log(`   ✅ Session Security: Enabled`);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

module.exports = { app, server, io, rfidService };