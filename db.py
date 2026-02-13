import sqlite3
import os
from datetime import datetime

# Database Configuration
DB_NAME = "uc_shop.db"

def get_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    
    # Users Table (Stores Wallet Balance)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            balance INTEGER DEFAULT 0,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # History Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            package_name TEXT,
            code TEXT,
            purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );
    """)
    
    # Stock Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            package_id TEXT,
            code TEXT UNIQUE,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # Packages Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identifier TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            price INTEGER NOT NULL
        );
    """)

    # Seed Initial Packages if table is empty
    cur.execute("SELECT COUNT(*) FROM packages")
    if cur.fetchone()[0] == 0:
        initial_packages = [
            ("60", "60 UC", 3650),
            ("325", "325 UC", 17900),
            ("660", "660 UC", 35600),
            ("1800", "1800 UC", 89300),
            ("3850", "3850 UC", 178700),
            ("8100", "8100 UC", 357900)
        ]
        cur.executemany("INSERT INTO packages (identifier, name, price) VALUES (?, ?, ?)", initial_packages)
        print("Seeded initial packages.")

    # Payment Methods Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS payment_methods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            account_number TEXT,
            account_name TEXT,
            qr_photo_id TEXT,
            is_active BOOLEAN DEFAULT 1
        );
    """)

    # API Config Table (For Midasbuy Cookies)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS api_config (
            service_name TEXT PRIMARY KEY,
            config JSON
        );
    """)

    # Games Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            is_active BOOLEAN DEFAULT 1
        );
    """)

    # Game Packages Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS game_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
        );
    """)

    # Check if PUBG exists, if not create it
    cur.execute("SELECT id FROM games WHERE name = 'PUBG UC'")
    if not cur.fetchone():
        cur.execute("INSERT INTO games (name) VALUES ('PUBG UC')")
        
    # Admins Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            user_id INTEGER PRIMARY KEY,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    conn.commit()
    conn.close()
    print("Database initialized successfully.")

# --- Admin Functions ---

def is_admin(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM admins WHERE user_id = ?", (user_id,))
        exists = cur.fetchone() is not None
    finally:
        conn.close()
    return exists

def add_admin(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT OR IGNORE INTO admins (user_id) VALUES (?)", (user_id,))
            conn.commit()
            success = True
        except:
            success = False
    finally:
        conn.close()
    return success

def remove_admin(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM admins WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()

def get_all_admins():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM admins")
        admins = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()
    return admins

# --- Game Functions ---

def get_games():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM games WHERE is_active = 1 ORDER BY id ASC")
        games = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return games

def add_game(name):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO games (name) VALUES (?)", (name,))
            conn.commit()
            success = True
        except sqlite3.IntegrityError:
            success = False
    finally:
        conn.close()
    return success

def delete_game(game_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()
    finally:
        conn.close()

# --- Game Package Functions ---

def get_game_packages(game_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM game_packages WHERE game_id = ? ORDER BY price ASC", (game_id,))
        packages = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return packages

def add_game_package(game_id, name, price):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO game_packages (game_id, name, price) VALUES (?, ?, ?)", (game_id, name, price))
        conn.commit()
    finally:
        conn.close()

def delete_game_package(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM game_packages WHERE id = ?", (package_id,))
        conn.commit()
    finally:
        conn.close()

def get_game_package_by_id(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT gp.*, g.name as game_name 
            FROM game_packages gp 
            JOIN games g ON gp.game_id = g.id 
            WHERE gp.id = ?
        """, (package_id,))
        row = cur.fetchone()
        pkg = dict(row) if row else None
    finally:
        conn.close()
    return pkg

# --- API Config Functions ---

def get_api_config(service_name):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT config FROM api_config WHERE service_name = ?", (service_name,))
        row = cur.fetchone()
        import json
        return json.loads(row[0]) if row else None
    finally:
        conn.close()

def set_api_config(service_name, config_data):
    conn = get_connection()
    try:
        cur = conn.cursor()
        import json
        cur.execute("""
            INSERT OR REPLACE INTO api_config (service_name, config) 
            VALUES (?, ?) 
        """, (service_name, json.dumps(config_data)))
        conn.commit()
    finally:
        conn.close()

# --- Package Functions ---

def get_packages():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM packages ORDER BY price ASC")
        packages = cur.fetchall()
        result = {}
        for row in packages:
            p = dict(row)
            result[p['identifier']] = p
    finally:
        conn.close()
    return result

def add_package(identifier, name, price):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO packages (identifier, name, price) VALUES (?, ?, ?)", (identifier, name, price))
            conn.commit()
            success = True
        except sqlite3.IntegrityError:
            success = False
    finally:
        conn.close()
    return success

def update_package_price(identifier, new_price):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE packages SET price = ? WHERE identifier = ?", (new_price, identifier))
        updated = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()
    return updated

def delete_package(identifier):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM packages WHERE identifier = ?", (identifier,))
        deleted = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()
    return deleted

# --- Payment Method Functions ---

def get_payment_methods():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY id ASC")
        methods = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return methods

def add_payment_method(name, account_number, account_name, qr_photo_id=None):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO payment_methods (name, account_number, account_name, qr_photo_id) 
            VALUES (?, ?, ?, ?)
        """, (name, account_number, account_name, qr_photo_id))
        conn.commit()
    finally:
        conn.close()
    return True

def delete_payment_method(method_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM payment_methods WHERE id = ?", (method_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()
    return deleted

# --- User Functions ---

def get_user(user_id, username=None):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = cur.fetchone()
        
        if not row:
            # Create new user
            cur.execute("INSERT INTO users (user_id, username, balance) VALUES (?, ?, 0)", (user_id, username))
            conn.commit()
            cur.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
            row = cur.fetchone()
            user = dict(row)
        else:
            user = dict(row)
            if username and user['username'] != username:
                # Update username if changed
                cur.execute("UPDATE users SET username = ? WHERE user_id = ?", (username, user_id))
                conn.commit()
                user['username'] = username
            
    finally:
        conn.close()
    return user

def update_balance(user_id, amount):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
        conn.commit()
    finally:
        conn.close()

def update_user_username(user_id, username):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET username = ? WHERE user_id = ?", (username, user_id))
        conn.commit()
    finally:
        conn.close()

def get_all_users(limit=20, offset=0):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?", (limit, offset))
        users = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return users

def get_total_users_count():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM users")
        count = cur.fetchone()[0]
    finally:
        conn.close()
    return count

def add_user(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT OR IGNORE INTO users (user_id, balance) VALUES (?, 0)", (user_id,))
            conn.commit()
            success = cur.rowcount > 0
        except:
            success = False
    finally:
        conn.close()
    return success

# --- History Functions ---

def add_history(user_id, package_name, code):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO history (user_id, package_name, code)
            VALUES (?, ?, ?)
        """, (user_id, package_name, code))
        conn.commit()
    finally:
        conn.close()

def get_history(user_id, limit=5):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM history 
            WHERE user_id = ? 
            ORDER BY purchase_date DESC 
            LIMIT ?
        """, (user_id, limit))
        history = [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return history

# --- Stock Functions ---

def add_stock(package_id, code):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO stocks (package_id, code) VALUES (?, ?)", (package_id, code))
            conn.commit()
            success = True
        except sqlite3.IntegrityError:
            success = False
    finally:
        conn.close()
    return success

def get_stock_count(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM stocks WHERE package_id = ?", (package_id,))
        count = cur.fetchone()[0]
    finally:
        conn.close()
    return count

def get_and_use_stock(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        # SQLite doesn't have FOR UPDATE SKIP LOCKED, so we just select one
        # and delete it in a transaction
        cur.execute("BEGIN IMMEDIATE")
        
        cur.execute("""
            SELECT id, code FROM stocks 
            WHERE package_id = ? 
            LIMIT 1 
        """, (package_id,))
        
        row = cur.fetchone()
        if row:
            stock_id, code = row
            # Delete the stock after retrieving it
            cur.execute("DELETE FROM stocks WHERE id = ?", (stock_id,))
            conn.commit()
            return code
        
        conn.rollback()
    finally:
        conn.close()
    return None

