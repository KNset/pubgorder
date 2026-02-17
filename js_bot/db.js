require('dotenv').config();
const { Pool } = require('pg');

// Database Configuration
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'uc_shop_db',
    password: process.env.DB_PASS || '1001',
    port: process.env.DB_PORT || 5432,
    max: 20, // Max clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Cache
const _USER_CACHE = new Map();
const CACHE_TTL = 1800 * 1000; // 30 minutes in ms

async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        // console.log('executed query', { text, duration: Date.now() - start, rows: res.rowCount });
        return res;
    } catch (err) {
        console.error('Query Error', err);
        throw err;
    }
}

async function init_db() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Users Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id BIGINT PRIMARY KEY,
                username TEXT,
                balance INTEGER DEFAULT 0,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // History Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(user_id),
                package_name TEXT,
                code TEXT,
                purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Stock Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS stocks (
                id SERIAL PRIMARY KEY,
                package_id TEXT,
                code TEXT UNIQUE,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Packages Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS packages (
                id SERIAL PRIMARY KEY,
                identifier TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                price INTEGER NOT NULL
            );
        `);

        // Payment Methods Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_methods (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                account_number TEXT,
                account_name TEXT,
                qr_photo_id TEXT,
                is_active BOOLEAN DEFAULT TRUE
            );
        `);

        // Games Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                is_active BOOLEAN DEFAULT TRUE,
                game_type TEXT DEFAULT 'token' -- 'token' or 'normal'
            );
        `);
        
        // Ensure column exists for existing dbs
        try {
            await client.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type TEXT DEFAULT 'token'");
        } catch (e) {
            // Ignore if column exists
        }

        // Game Packages Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS game_packages (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                price INTEGER NOT NULL
            );
        `);

        // Admins Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS admins (
                user_id BIGINT PRIMARY KEY,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // API Config Table (For Cookies etc)
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_config (
                service_name TEXT PRIMARY KEY,
                config JSONB
            );
        `);

        // Ensure PUBG exists
        await client.query("INSERT INTO games (name) VALUES ('PUBG UC') ON CONFLICT (name) DO NOTHING");

        await client.query('COMMIT');
        console.log("Database initialized successfully.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Database initialization failed:", e);
    } finally {
        client.release();
    }
}

async function get_user(user_id, username = null) {
    const uidStr = String(user_id);
    const now = Date.now();
    if (_USER_CACHE.has(uidStr)) {
        const cached = _USER_CACHE.get(uidStr);
        if (now - cached.ts < CACHE_TTL) {
            return cached.data;
        }
    }

    try {
        let res = await query("SELECT * FROM users WHERE user_id = $1", [uidStr]);
        let user = res.rows[0];

        if (!user) {
            res = await query("INSERT INTO users (user_id, username, balance) VALUES ($1, $2, 0) RETURNING *", [uidStr, username]);
            user = res.rows[0];
        } else if (username && user.username !== username) {
            // Update username asynchronously if needed
            query("UPDATE users SET username = $1 WHERE user_id = $2", [username, uidStr]).catch(console.error);
            user.username = username;
        }

        _USER_CACHE.set(uidStr, { data: user, ts: now });
        return user;
    } catch (e) {
        console.error("get_user error:", e);
        return null;
    }
}

async function update_balance(user_id, amount) {
    const uidStr = String(user_id);
    try {
        await query("UPDATE users SET balance = balance + $1 WHERE user_id = $2", [amount, uidStr]);
        _USER_CACHE.delete(uidStr); // Invalidate cache
        return true;
    } catch (e) {
        console.error("update_balance error:", e);
        return false;
    }
}

async function get_packages() {
    const now = Date.now();
    if (_USER_CACHE.has('legacy_packages')) {
        const cached = _USER_CACHE.get('legacy_packages');
        if (now - cached.ts < CACHE_TTL) return cached.data;
    }

    try {
        const res = await query("SELECT * FROM packages ORDER BY price ASC");
        const packages = {};
        res.rows.forEach(p => packages[p.identifier] = p);
        _USER_CACHE.set('legacy_packages', { data: packages, ts: now });
        return packages;
    } catch (e) {
        console.error("get_packages error:", e);
        return {};
    }
}

async function get_games() {
    const now = Date.now();
    if (_USER_CACHE.has('games_list')) {
        const cached = _USER_CACHE.get('games_list');
        if (now - cached.ts < CACHE_TTL) return cached.data;
    }

    try {
        const res = await query("SELECT * FROM games WHERE is_active = TRUE ORDER BY id ASC");
        _USER_CACHE.set('games_list', { data: res.rows, ts: now });
        return res.rows;
    } catch (e) {
        console.error("get_games error:", e);
        return [];
    }
}

async function get_game_packages(game_id) {
    const now = Date.now();
    const key = `packages_${game_id}`;
    if (_USER_CACHE.has(key)) {
        const cached = _USER_CACHE.get(key);
        if (now - cached.ts < CACHE_TTL) return cached.data;
    }

    try {
        const res = await query("SELECT * FROM game_packages WHERE game_id = $1 ORDER BY id ASC", [game_id]);
        _USER_CACHE.set(key, { data: res.rows, ts: now });
        return res.rows;
    } catch (e) {
        console.error("get_game_packages error:", e);
        return [];
    }
}

async function get_stock_count(package_id) {
    try {
        const res = await query("SELECT COUNT(*) FROM stocks WHERE package_id = $1", [package_id]);
        return parseInt(res.rows[0].count);
    } catch (e) {
        return 0;
    }
}

async function get_and_use_stock(package_id) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(`
            SELECT id, code FROM stocks 
            WHERE package_id = $1 
            LIMIT 1 
            FOR UPDATE SKIP LOCKED
        `, [package_id]);

        if (res.rows.length > 0) {
            const { id, code } = res.rows[0];
            await client.query("DELETE FROM stocks WHERE id = $1", [id]);
            await client.query('COMMIT');
            return code;
        } else {
            await client.query('ROLLBACK');
            return null;
        }
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("get_and_use_stock error:", e);
        return null;
    } finally {
        client.release();
    }
}

async function add_stock(package_id, code) {
    try {
        await query("INSERT INTO stocks (package_id, code) VALUES ($1, $2)", [package_id, code.trim()]);
        return true;
    } catch (e) {
        console.error("add_stock error:", e.message);
        return false; // Likely duplicate or error
    }
}

async function add_history(user_id, package_name, code) {
    try {
        await query("INSERT INTO history (user_id, package_name, code) VALUES ($1, $2, $3)", [user_id, package_name, code]);
    } catch (e) {
        console.error("add_history error:", e);
    }
}

async function get_history(user_id, limit = 5) {
    try {
        const res = await query("SELECT * FROM history WHERE user_id = $1 ORDER BY purchase_date DESC LIMIT $2", [user_id, limit]);
        return res.rows;
    } catch (e) {
        return [];
    }
}

async function is_admin(user_id) {
    const now = Date.now();
    const key = `admin_${user_id}`;
    if (_USER_CACHE.has(key)) {
        const cached = _USER_CACHE.get(key);
        if (now - cached.ts < CACHE_TTL) return cached.data;
    }

    try {
        const res = await query("SELECT 1 FROM admins WHERE user_id = $1", [user_id]);
        const exists = res.rowCount > 0;
        _USER_CACHE.set(key, { data: exists, ts: now });
        return exists;
    } catch (e) {
        return false;
    }
}

async function get_all_admins() {
    try {
        const res = await query("SELECT user_id FROM admins");
        return res.rows.map(r => r.user_id); 
    } catch (e) {
        return [];
    }
}

async function add_admin(user_id) {
    try {
        await query("INSERT INTO admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user_id]);
        _USER_CACHE.delete(`admin_${user_id}`);
        return true;
    } catch (e) {
        return false;
    }
}

async function remove_admin(user_id) {
    try {
        await query("DELETE FROM admins WHERE user_id = $1", [user_id]);
        _USER_CACHE.delete(`admin_${user_id}`);
        return true;
    } catch (e) {
        return false;
    }
}

async function get_payment_methods() {
    try {
        const res = await query("SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY id ASC");
        return res.rows;
    } catch (e) {
        return [];
    }
}

async function add_payment_method(name, acc, owner, qr_id) {
    try {
        await query("INSERT INTO payment_methods (name, account_number, account_name, qr_photo_id) VALUES ($1, $2, $3, $4)", [name, acc, owner, qr_id]);
        return true;
    } catch (e) {
        return false;
    }
}

async function delete_payment_method(id) {
    try {
        await query("DELETE FROM payment_methods WHERE id = $1", [id]);
        return true;
    } catch (e) {
        return false;
    }
}

// User Management Helpers
async function get_all_users(limit = 10, offset = 0) {
    try {
        const res = await query("SELECT * FROM users ORDER BY joined_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
        return res.rows;
    } catch (e) {
        return [];
    }
}

async function get_total_users_count() {
    try {
        const res = await query("SELECT COUNT(*) FROM users");
        return parseInt(res.rows[0].count);
    } catch (e) {
        return 0;
    }
}

async function update_user_username(user_id, username) {
    try {
        await query("UPDATE users SET username = $1 WHERE user_id = $2", [username, user_id]);
        return true;
    } catch (e) {
        return false;
    }
}

async function add_user(user_id) {
    try {
        await query("INSERT INTO users (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING", [user_id]);
        return true;
    } catch (e) {
        return false;
    }
}

// API Config (Cookies)
async function set_api_config(service, config) {
    try {
        await query("INSERT INTO api_config (service_name, config) VALUES ($1, $2) ON CONFLICT (service_name) DO UPDATE SET config = $2", [service, JSON.stringify(config)]);
        return true;
    } catch (e) {
        return false;
    }
}

async function get_api_config(service) {
    try {
        const res = await query("SELECT config FROM api_config WHERE service_name = $1", [service]);
        return res.rows[0] ? res.rows[0].config : null;
    } catch (e) {
        return null;
    }
}

// Game Management Helpers
async function add_game(name, type = 'token') {
    try {
        await query("INSERT INTO games (name, game_type) VALUES ($1, $2)", [name, type]);
        _USER_CACHE.delete('games_list');
        return true;
    } catch (e) {
        return false;
    }
}

async function delete_game(id) {
    try {
        await query("DELETE FROM games WHERE id = $1", [id]);
        _USER_CACHE.delete('games_list');
        return true;
    } catch (e) {
        return false;
    }
}

async function add_game_package(game_id, name, price) {
    try {
        await query("INSERT INTO game_packages (game_id, name, price) VALUES ($1, $2, $3)", [game_id, name, price]);
        _USER_CACHE.delete(`packages_${game_id}`);
        return true;
    } catch (e) {
        return false;
    }
}

async function delete_game_package(id) {
    try {
        // Need game_id to clear cache, fetch first
        const res = await query("SELECT game_id FROM game_packages WHERE id = $1", [id]);
        if (res.rows.length > 0) {
            const gid = res.rows[0].game_id;
            await query("DELETE FROM game_packages WHERE id = $1", [id]);
            await query("DELETE FROM stocks WHERE package_id = $1", [String(id)]);
            _USER_CACHE.delete(`packages_${gid}`);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Package Management Helpers (Legacy)
async function add_package(identifier, name, price) {
    try {
        await query("INSERT INTO packages (identifier, name, price) VALUES ($1, $2, $3)", [identifier, name, price]);
        _USER_CACHE.delete('legacy_packages');
        return true;
    } catch (e) {
        return false;
    }
}

async function update_package_price(identifier, price) {
    try {
        await query("UPDATE packages SET price = $1 WHERE identifier = $2", [price, identifier]);
        _USER_CACHE.delete('legacy_packages');
        return true;
    } catch (e) {
        return false;
    }
}

async function delete_package(identifier) {
    try {
        await query("DELETE FROM packages WHERE identifier = $1", [identifier]);
        await query("DELETE FROM stocks WHERE package_id = $1", [identifier]);
        _USER_CACHE.delete('legacy_packages');
        return true;
    } catch (e) {
        return false;
    }
}

async function get_game_package_by_id(package_id) {
    try {
        const res = await query(`
            SELECT gp.*, g.name as game_name, g.game_type 
            FROM game_packages gp 
            JOIN games g ON gp.game_id = g.id 
            WHERE gp.id = $1
        `, [package_id]);
        return res.rows[0];
    } catch (e) {
        console.error("get_game_package_by_id error:", e);
        return null;
    }
}

async function get_stock_codes(package_id) {
    try {
        const res = await query("SELECT code FROM stocks WHERE package_id = $1 ORDER BY added_at ASC", [package_id]);
        return res.rows.map(r => r.code);
    } catch (e) {
        return [];
    }
}

async function clear_stock(package_id) {
    try {
        await query("DELETE FROM stocks WHERE package_id = $1", [package_id]);
        return true;
    } catch (e) {
        return false;
    }
}

// Export functions
module.exports = {
    init_db,
    get_user,
    update_balance,
    get_packages,
    get_games,
    get_game_packages,
    get_game_package_by_id,
    get_stock_count,
    get_stock_codes,
    clear_stock, // Added this
    get_and_use_stock,
    add_stock,
    add_history,
    get_history,
    is_admin,
    get_all_admins,
    add_admin,
    remove_admin,
    get_payment_methods,
    add_payment_method,
    delete_payment_method,
    get_all_users,
    get_total_users_count,
    update_user_username,
    add_user,
    set_api_config,
    get_api_config,
    add_game,
    delete_game,
    add_game_package,
    delete_game_package,
    add_package,
    update_package_price,
    delete_package,
    query,
    pool
};
