const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');
const moment = require('moment-timezone');

class RFIDService extends EventEmitter {
    constructor() {
        super();
        this.port = null;
        this.parser = null;
        this.isConnected = false;
        this.lastScans = new Map(); // For anti-spam
        this.minScanInterval = 5000; // 5 seconds
        this.deviceInfo = null;
    }

    // Find RFID reader port
    async findRFIDPort() {
        try {
            const { SerialPort } = require('serialport');
            const ports = await SerialPort.list();

            // Look for R65D RFID reader
            for (const port of ports) {
                if (port.vendorId && port.productId) {
                    // R65D Hardware ID: VID_FFFF&PID_0035
                    if (port.vendorId.toUpperCase() === 'FFFF' &&
                        port.productId.toUpperCase() === '0035') {

                        console.log('🎯 R65D RFID Reader detected!');
                        console.log(`   Port: ${port.path}`);
                        console.log(`   Vendor ID: ${port.vendorId}`);
                        console.log(`   Product ID: ${port.productId}`);
                        console.log(`   Connector: Type-C USB OTG`);
                        console.log(`   Mode: 125KHz Keyboard Emulator`);

                        this.deviceInfo = {
                            port: port.path,
                            type: 'R65D-125KHz-TypeC',
                            vendorId: port.vendorId,
                            productId: port.productId,
                            connector: 'Type-C',
                            frequency: '125KHz',
                            mode: 'Keyboard Emulator'
                        };

                        return port.path;
                    }
                }

                // Try other common RFID readers
                if (port.manufacturer && port.manufacturer.toLowerCase().includes('rfid')) {
                    return port.path;
                }
            }

            // Fallback: try common COM ports
            const commonPorts = ['COM3', 'COM4', 'COM5', '/dev/ttyUSB0', '/dev/ttyACM0'];
            for (const portPath of commonPorts) {
                const portExists = ports.some(p => p.path === portPath);
                if (portExists) {
                    return portPath;
                }
            }

            return null;
        } catch (error) {
            console.error('Error finding RFID port:', error);
            return null;
        }
    }

    // Connect to RFID reader
    async connect() {
        try {
            const portPath = await this.findRFIDPort();
            if (!portPath) {
                throw new Error('RFID reader not found');
            }

            // For R65D, we don't need serial communication as it's a keyboard emulator
            if (this.deviceInfo && this.deviceInfo.type === 'R65D-125KHz-TypeC') {
                console.log('✅ R65D ready for keyboard input mode');
                this.isConnected = true;
                this.emit('connected', this.deviceInfo);
                return true;
            }

            // For traditional USB RFID readers
            this.port = new SerialPort({
                path: portPath,
                baudRate: 9600,
                autoOpen: false
            });

            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            // Setup event handlers
            this.port.on('open', () => {
                console.log(`RFID reader connected on ${portPath}`);
                this.isConnected = true;
                this.emit('connected', { port: portPath, type: 'USB-RFID' });
            });

            this.port.on('error', (error) => {
                console.error('RFID port error:', error);
                this.isConnected = false;
                this.emit('error', error);
            });

            this.port.on('close', () => {
                console.log('RFID port closed');
                this.isConnected = false;
                this.emit('disconnected');
            });

            this.parser.on('data', (data) => {
                this.handleRFIDData(data);
            });

            // Open the port
            await new Promise((resolve, reject) => {
                this.port.open((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });

            return true;
        } catch (error) {
            console.error('Error connecting to RFID reader:', error);
            this.isConnected = false;
            this.emit('error', error);
            return false;
        }
    }

    // Handle RFID data from serial port
    handleRFIDData(data) {
        try {
            const cardId = this.normalizeCardId(data.toString().trim());
            if (cardId && this.isValidCardId(cardId)) {
                this.processRFIDScan(cardId);
            }
        } catch (error) {
            console.error('Error handling RFID data:', error);
        }
    }

    // Process manual RFID scan (for R65D keyboard input)
    processManualScan(cardId) {
        try {
            const normalizedId = this.normalizeCardId(cardId);
            if (normalizedId && this.isValidCardId(normalizedId)) {
                this.processRFIDScan(normalizedId);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error processing manual scan:', error);
            return false;
        }
    }

    // Process RFID scan with anti-spam protection
    processRFIDScan(cardId) {
        try {
            const now = Date.now();
            const lastScanTime = this.lastScans.get(cardId);

            // Check for spam (same card scanned too quickly)
            if (lastScanTime && (now - lastScanTime) < this.minScanInterval) {
                console.log(`Spam detection: Card ${cardId} scanned too quickly`);
                this.emit('spam', { cardId, timeSinceLastScan: now - lastScanTime });
                return;
            }

            // Update last scan time
            this.lastScans.set(cardId, now);

            // Emit scan event
            const scanData = {
                cardId,
                timestamp: moment().tz('Asia/Ho_Chi_Minh').format(),
                device: this.deviceInfo || { type: 'Unknown' }
            };

            console.log(`RFID Scan: ${cardId} at ${scanData.timestamp}`);
            this.emit('scan', scanData);

        } catch (error) {
            console.error('Error processing RFID scan:', error);
            this.emit('error', error);
        }
    }

    // Normalize card ID (remove leading zeros, ensure consistent format)
    normalizeCardId(cardId) {
        if (!cardId) return null;

        // Remove any non-numeric characters and leading zeros
        const cleaned = cardId.toString().replace(/\D/g, '');

        // Ensure minimum length and pad with zeros if needed
        return cleaned.padStart(10, '0');
    }

    // Validate card ID format
    isValidCardId(cardId) {
        if (!cardId) return false;

        // Check if it's a valid numeric string
        if (!/^\d+$/.test(cardId)) return false;

        // Check length (typically 8-12 digits for RFID cards)
        if (cardId.length < 8 || cardId.length > 12) return false;

        return true;
    }

    // Disconnect from RFID reader
    async disconnect() {
        try {
            if (this.port && this.port.isOpen) {
                await new Promise((resolve, reject) => {
                    this.port.close((error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                });
            }
            this.isConnected = false;
            this.port = null;
            this.parser = null;
            console.log('RFID reader disconnected');
            this.emit('disconnected');
        } catch (error) {
            console.error('Error disconnecting RFID reader:', error);
            this.emit('error', error);
        }
    }

    // Get connection status
    getStatus() {
        return {
            connected: this.isConnected,
            device: this.deviceInfo,
            port: this.port ? this.port.path : null
        };
    }

    // Clean up old scan records (prevent memory leak)
    cleanupOldScans() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [cardId, timestamp] of this.lastScans.entries()) {
            if (now - timestamp > maxAge) {
                this.lastScans.delete(cardId);
            }
        }
    }

    // Start cleanup timer
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupOldScans();
        }, 60 * 60 * 1000); // Run every hour
    }
}

module.exports = RFIDService;