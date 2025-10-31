const ip = require('ip');
const { executeQuery } = require('../config/database');

// Check if IP is in company network (TEMPORARILY DISABLED)
async function isCompanyNetwork(clientIp) {
    try {
        // TEMPORARILY ALLOW ALL IPs - Network security disabled
        console.log(`Network security disabled - allowing IP: ${clientIp}`);
        return true;

        /* COMMENTED OUT - Network table not created yet
        if (!clientIp) return false;

        // Get network configurations from database
        const query = 'SELECT network_ip, network_mask FROM network_configs WHERE is_active = true';
        const networks = await executeQuery(query);

        for (const network of networks) {
            if (ip.cidrSubnet(`${network.network_ip}/${ip.fromLong(parseInt(network.network_mask))}`).contains(clientIp)) {
                return true;
            }
        }

        return false;
        */
    } catch (error) {
        console.error('Error checking company network:', error);
        return true; // Allow access on error
    }
}

// Check if WiFi name is company WiFi (TEMPORARILY DISABLED)
async function isCompanyWifi(wifiName) {
    try {
        // TEMPORARILY ALLOW ALL WiFi - Network security disabled
        console.log(`Network security disabled - allowing WiFi: ${wifiName}`);
        return true;

        /* COMMENTED OUT - WiFi table not created yet
        if (!wifiName) return false;

        const query = 'SELECT wifi_name FROM wifi_configs WHERE is_active = true AND wifi_name = ?';
        const results = await executeQuery(query, [wifiName.trim()]);

        return results.length > 0;
        */
    } catch (error) {
        console.error('Error checking company wifi:', error);
        return true; // Allow access on error
    }
}

// Get client IP address (handling proxies)
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.ip;
}

// Get gateway IP from headers
function getGatewayIp(req) {
    return req.headers['x-gateway-ip'] || req.body?.gateway_ip || req.query?.gateway_ip;
}

// Get WiFi name from headers or body
function getWifiName(req) {
    return req.headers['x-wifi-name'] || req.body?.wifi_name || req.query?.wifi_name;
}

// Network restriction middleware
const requireCompanyNetwork = async (req, res, next) => {
    try {
        const clientIp = getClientIp(req);
        const gatewayIp = getGatewayIp(req);
        const wifiName = getWifiName(req);

        // Check gateway IP first (primary method)
        const gatewayAllowed = gatewayIp ? await isCompanyNetwork(gatewayIp) : false;

        // Check client IP (secondary method)
        const clientIpAllowed = await isCompanyNetwork(clientIp);

        // Check WiFi name (tertiary method)
        const wifiAllowed = wifiName ? await isCompanyWifi(wifiName) : false;

        // Allow access if any method passes
        const accessAllowed = gatewayAllowed || clientIpAllowed || wifiAllowed;

        if (!accessAllowed) {
            let errorMessage = 'Bạn cần kết nối mạng Wi-Fi của công ty để thực hiện chấm công';

            if (wifiName) {
                errorMessage += ` (WiFi hiện tại: ${wifiName})`;
            }

            if (gatewayIp) {
                errorMessage += ` (Gateway: ${gatewayIp})`;
            }

            return res.status(403).json({
                success: false,
                error: 'NETWORK_ACCESS_DENIED',
                message: errorMessage,
                debug: {
                    clientIp,
                    gatewayIp,
                    wifiName,
                    gatewayAllowed,
                    clientIpAllowed,
                    wifiAllowed
                }
            });
        }

        // Store network info in request for logging
        req.networkInfo = {
            clientIp,
            gatewayIp,
            wifiName,
            accessMethod: gatewayAllowed ? 'gateway' : clientIpAllowed ? 'client_ip' : 'wifi'
        };

        next();
    } catch (error) {
        console.error('Network restriction middleware error:', error);
        return res.status(500).json({
            success: false,
            error: 'NETWORK_CHECK_ERROR',
            message: 'Lỗi kiểm tra mạng. Vui lòng thử lại.'
        });
    }
};

// Optional network restriction (for non-critical endpoints)
const optionalNetworkCheck = async (req, res, next) => {
    try {
        const clientIp = getClientIp(req);
        const gatewayIp = getGatewayIp(req);
        const wifiName = getWifiName(req);

        req.networkInfo = {
            clientIp,
            gatewayIp,
            wifiName,
            isCompanyNetwork: await isCompanyNetwork(clientIp),
            isCompanyWifi: wifiName ? await isCompanyWifi(wifiName) : false
        };

        next();
    } catch (error) {
        console.error('Optional network check error:', error);
        req.networkInfo = { error: error.message };
        next();
    }
};

module.exports = {
    requireCompanyNetwork,
    optionalNetworkCheck,
    isCompanyNetwork,
    isCompanyWifi,
    getClientIp,
    getGatewayIp,
    getWifiName
};