const { executeQuery, executeTransaction } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
    constructor(userData) {
        this.id = userData.id;
        this.name = userData.name;
        this.username = userData.username;
        this.password = userData.password;
        this.role = userData.role;
        this.isActive = userData.is_active;
        this.createdAt = userData.created_at;
        this.updatedAt = userData.updated_at;
    }

    // Find user by RFID card
    static async findByRfidCard(rfidCard) {
        try {
            const query = 'SELECT * FROM users WHERE rfid_card = ? AND is_active = true LIMIT 1';
            const results = await executeQuery(query, [rfidCard]);
            return results.length > 0 ? new User(results[0]) : null;
        } catch (error) {
            console.error('Error finding user by RFID card:', error);
            throw error;
        }
    }

    // Find user by username
    static async findByUsername(username) {
        try {
            const query = 'SELECT * FROM users WHERE username = ? AND is_active = true';
            const results = await executeQuery(query, [username]);
            return results.length > 0 ? new User(results[0]) : null;
        } catch (error) {
            console.error('Error finding user by username:', error);
            throw error;
        }
    }

    // Find user by ID
    static async findById(id) {
        try {
            const query = 'SELECT * FROM users WHERE id = ? AND is_active = true';
            const results = await executeQuery(query, [id]);
            return results.length > 0 ? new User(results[0]) : null;
        } catch (error) {
            console.error('Error finding user by ID:', error);
            throw error;
        }
    }

    // Get all users
    static async findAll(role = null) {
        try {
            let query = 'SELECT * FROM users WHERE is_active = true';
            const params = [];

            if (role) {
                query += ' AND role = ?';
                params.push(role);
            }

            query += ' ORDER BY name ASC';
            const results = await executeQuery(query, params);
            return results.map(user => new User(user));
        } catch (error) {
            console.error('Error finding all users:', error);
            throw error;
        }
    }

    // Create new user
    static async create(userData) {
        try {
            const hashedPassword = await bcrypt.hash(userData.password, 10);
            const query = `
                INSERT INTO users (id, name, username, password, role, is_active) 
                VALUES (?, ?, ?, ?, ?, true)
            `;
            const params = [
                userData.id,
                userData.name,
                userData.username,
                hashedPassword,
                userData.role || 'at_work'
            ];

            await executeQuery(query, params);
            return await User.findById(userData.id);
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }

    // Update user
    static async update(id, userData) {
        try {
            const updates = [];
            const params = [];

            if (userData.name) {
                updates.push('name = ?');
                params.push(userData.name);
            }

            if (userData.username) {
                updates.push('username = ?');
                params.push(userData.username);
            }

            if (userData.password) {
                const hashedPassword = await bcrypt.hash(userData.password, 10);
                updates.push('password = ?');
                params.push(hashedPassword);
            }

            if (userData.role) {
                updates.push('role = ?');
                params.push(userData.role);
            }

            if (userData.isActive !== undefined) {
                updates.push('is_active = ?');
                params.push(userData.isActive);
            }

            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(id);

            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            await executeQuery(query, params);
            return await User.findById(id);
        } catch (error) {
            console.error('Error updating user:', error);
            throw error;
        }
    }

    // Delete user (soft delete)
    static async delete(id) {
        try {
            const query = 'UPDATE users SET is_active = false WHERE id = ?';
            await executeQuery(query, [id]);
            return true;
        } catch (error) {
            console.error('Error deleting user:', error);
            throw error;
        }
    }

    // Verify password
    async verifyPassword(password) {
        try {
            return await bcrypt.compare(password, this.password);
        } catch (error) {
            console.error('Error verifying password:', error);
            return false;
        }
    }

    // Get user role permissions
    getRolePermissions() {
        const permissions = {
            admin: ['read', 'write', 'delete', 'manage_users', 'manage_events', 'view_reports'],
            event_manager: ['read', 'write', 'manage_events', 'view_reports'],
            staff: ['read', 'check_in', 'check_out'],
            at_work: ['read', 'check_in', 'check_out']
        };

        return permissions[this.role] || permissions.at_work;
    }

    // Check if user has permission
    hasPermission(permission) {
        return this.getRolePermissions().includes(permission);
    }

    // Convert to JSON (exclude password)
    toJSON() {
        const { password, ...userWithoutPassword } = this;
        return userWithoutPassword;
    }
}

module.exports = User;