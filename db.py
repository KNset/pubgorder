import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
import os
from datetime import datetime

# Database Configuration
# You can set these in your environment variables or change them here directly
DB_NAME = os.getenv("DB_NAME", "uc_shop_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS", "1001")
DB_HOST = os.getenv("DB_HOST", "72.62.120.240")
DB_PORT = os.getenv("DB_PORT", "5432")

# Connection Pool
try:
    db_pool = psycopg2.pool.SimpleConnectionPool(
        1,  # minconn
        5,  # maxconn (Reduced from 20 for lightweight)
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        host=DB_HOST,
        port=DB_PORT
    )
    print("Database connection pool created.")
except Exception as e:
    print(f"Error creating connection pool: {e}")
    db_pool = None

def get_connection():
    if db_pool:
        return db_pool.getconn()
    else:
        return psycopg2.connect(
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASS,
            host=DB_HOST,
            port=DB_PORT
        )

def release_connection(conn):
    if db_pool:
        db_pool.putconn(conn)
    else:
        conn.close()

def init_db():
    conn = get_connection()
    cur = conn.cursor()
    
    # Users Table (Stores Wallet Balance)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            username TEXT,
            balance INTEGER DEFAULT 0,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # Migration: Add username column if not exists (for existing databases)
    try:
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;")
        conn.commit()
    except Exception as e:
        print(f"Migration warning: {e}")
        conn.rollback()

    # History Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id SERIAL PRIMARY KEY,
            user_id BIGINT REFERENCES users(user_id),
            package_name TEXT,
            code TEXT,
            purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # Stock Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stocks (
            id SERIAL PRIMARY KEY,
            package_id TEXT,
            code TEXT UNIQUE,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # Packages Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS packages (
            id SERIAL PRIMARY KEY,
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
        cur.executemany("INSERT INTO packages (identifier, name, price) VALUES (%s, %s, %s)", initial_packages)
        print("Seeded initial packages.")

    # Payment Methods Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS payment_methods (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            account_number TEXT,
            account_name TEXT,
            qr_photo_id TEXT,
            is_active BOOLEAN DEFAULT TRUE
        );
    """)

    # API Config Table (For Midasbuy Cookies)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS api_config (
            service_name TEXT PRIMARY KEY,
            config JSONB
        );
    """)

    # Games Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            is_active BOOLEAN DEFAULT TRUE
        );
    """)

    # Game Packages Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS game_packages (
            id SERIAL PRIMARY KEY,
            game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            price INTEGER NOT NULL
        );
    """)

    # Check if PUBG exists, if not create it
    cur.execute("SELECT id FROM games WHERE name = 'PUBG UC'")
    if not cur.fetchone():
        cur.execute("INSERT INTO games (name) VALUES ('PUBG UC') RETURNING id")
        
    # Admins Table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            user_id BIGINT PRIMARY KEY,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    conn.commit()
    cur.close()
    conn.close()
    print("Database initialized successfully.")

# --- Admin Functions ---

def is_admin(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM admins WHERE user_id = %s", (user_id,))
        exists = cur.fetchone() is not None
        cur.close()
    finally:
        release_connection(conn)
    return exists

def add_admin(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO admins (user_id) VALUES (%s) ON CONFLICT DO NOTHING", (user_id,))
            conn.commit()
            success = True
        except:
            success = False
        cur.close()
    finally:
        release_connection(conn)
    return success

def remove_admin(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM admins WHERE user_id = %s", (user_id,))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

def get_all_admins():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM admins")
        admins = [row[0] for row in cur.fetchall()]
        cur.close()
    finally:
        release_connection(conn)
    return admins

# --- Game Functions ---

def get_games():
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM games WHERE is_active = TRUE ORDER BY id ASC")
        games = cur.fetchall()
        cur.close()
    finally:
        release_connection(conn)
    return games

def add_game(name):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO games (name) VALUES (%s) RETURNING id", (name,))
            game_id = cur.fetchone()[0]
            conn.commit()
            success = True
        except psycopg2.IntegrityError:
            conn.rollback()
            game_id = None
            success = False
        cur.close()
    finally:
        release_connection(conn)
    return success

def delete_game(game_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM games WHERE id = %s", (game_id,))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

# --- Game Package Functions ---

def get_game_packages(game_id):
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM game_packages WHERE game_id = %s ORDER BY price ASC", (game_id,))
        packages = cur.fetchall()
        cur.close()
    finally:
        release_connection(conn)
    return packages

def add_game_package(game_id, name, price):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO game_packages (game_id, name, price) VALUES (%s, %s, %s)", (game_id, name, price))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

def delete_game_package(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM game_packages WHERE id = %s", (package_id,))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

def get_game_package_by_id(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT gp.*, g.name as game_name 
            FROM game_packages gp 
            JOIN games g ON gp.game_id = g.id 
            WHERE gp.id = %s
        """, (package_id,))
        pkg = cur.fetchone()
        cur.close()
    finally:
        release_connection(conn)
    return pkg

# --- API Config Functions ---

def get_api_config(service_name):
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT config FROM api_config WHERE service_name = %s", (service_name,))
        row = cur.fetchone()
        cur.close()
    finally:
        release_connection(conn)
    return row['config'] if row else None

def set_api_config(service_name, config_data):
    conn = get_connection()
    try:
        cur = conn.cursor()
        import json
        cur.execute("""
            INSERT INTO api_config (service_name, config) 
            VALUES (%s, %s) 
            ON CONFLICT (service_name) 
            DO UPDATE SET config = EXCLUDED.config
        """, (service_name, json.dumps(config_data)))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

# --- Package Functions ---

def get_packages():
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM packages ORDER BY price ASC")
        packages = cur.fetchall()
        result = {}
        for p in packages:
            result[p['identifier']] = p
        cur.close()
    finally:
        release_connection(conn)
    return result

def add_package(identifier, name, price):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO packages (identifier, name, price) VALUES (%s, %s, %s)", (identifier, name, price))
            conn.commit()
            success = True
        except psycopg2.IntegrityError:
            conn.rollback()
            success = False
        cur.close()
    finally:
        release_connection(conn)
    return success

def update_package_price(identifier, new_price):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE packages SET price = %s WHERE identifier = %s", (new_price, identifier))
        updated = cur.rowcount > 0
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)
    return updated

def delete_package(identifier):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM packages WHERE identifier = %s", (identifier,))
        deleted = cur.rowcount > 0
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)
    return deleted

# --- Payment Method Functions ---

def get_payment_methods():
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY id ASC")
        methods = cur.fetchall()
        cur.close()
    finally:
        release_connection(conn)
    return methods

def add_payment_method(name, account_number, account_name, qr_photo_id=None):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO payment_methods (name, account_number, account_name, qr_photo_id) 
            VALUES (%s, %s, %s, %s)
        """, (name, account_number, account_name, qr_photo_id))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)
    return True

def delete_payment_method(method_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM payment_methods WHERE id = %s", (method_id,))
        deleted = cur.rowcount > 0
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)
    return deleted

# --- User Functions ---

def get_user(user_id, username=None):
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # Optimized: Only fetch what is needed, and handle creation only if missing
        cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
        user = cur.fetchone()
        
        if not user:
            # Create new user
            cur.execute("INSERT INTO users (user_id, username, balance) VALUES (%s, %s, 0) RETURNING *", (user_id, username))
            user = cur.fetchone()
            conn.commit()
        elif username and user['username'] != username:
            # Update username asynchronously? No, do it here but maybe less frequently?
            # For now, keep it but ensure index exists on user_id
            cur.execute("UPDATE users SET username = %s WHERE user_id = %s", (username, user_id))
            conn.commit()
            user['username'] = username
            
        cur.close()
    except Exception as e:
        # Fallback if connection fails
        print(f"DB Error get_user: {e}")
        if conn: conn.rollback()
        raise e
    finally:
        release_connection(conn)
    return user

def update_balance(user_id, amount):
    """
    amount can be positive (add funds) or negative (spend funds).
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET balance = balance + %s WHERE user_id = %s", (amount, user_id))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

def update_user_username(user_id, username):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET username = %s WHERE user_id = %s", (username, user_id))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

def get_all_users(limit=20, offset=0):
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM users ORDER BY joined_at DESC LIMIT %s OFFSET %s", (limit, offset))
        users = cur.fetchall()
        cur.close()
    finally:
        release_connection(conn)
    return users

def get_total_users_count():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM users")
        count = cur.fetchone()[0]
        cur.close()
    finally:
        release_connection(conn)
    return count

def add_user(user_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO users (user_id, balance) VALUES (%s, 0) ON CONFLICT (user_id) DO NOTHING", (user_id,))
        conn.commit()
        success = cur.rowcount > 0
        cur.close()
    finally:
        release_connection(conn)
    return success

# --- History Functions ---

def add_history(user_id, package_name, code):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO history (user_id, package_name, code)
            VALUES (%s, %s, %s)
        """, (user_id, package_name, code))
        conn.commit()
        cur.close()
    finally:
        release_connection(conn)

def get_history(user_id, limit=5):
    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT * FROM history 
            WHERE user_id = %s 
            ORDER BY purchase_date DESC 
            LIMIT %s
        """, (user_id, limit))
        history = cur.fetchall()
        cur.close()
    finally:
        release_connection(conn)
    return history

# --- Stock Functions ---

def add_stock(package_id, code):
    conn = get_connection()
    try:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO stocks (package_id, code) VALUES (%s, %s)", (package_id, code))
            conn.commit()
            success = True
        except psycopg2.IntegrityError:
            conn.rollback()
            success = False
        cur.close()
    finally:
        release_connection(conn)
    return success

def get_stock_count(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM stocks WHERE package_id = %s", (package_id,))
        count = cur.fetchone()[0]
        cur.close()
    finally:
        release_connection(conn)
    return count

def get_and_use_stock(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        # Select a code and lock the row to prevent race conditions
        cur.execute("""
            SELECT id, code FROM stocks 
            WHERE package_id = %s 
            LIMIT 1 
            FOR UPDATE SKIP LOCKED
        """, (package_id,))
        
        row = cur.fetchone()
        if row:
            stock_id, code = row
            # Delete the stock after retrieving it (or you could move it to a 'used_stocks' table)
            cur.execute("DELETE FROM stocks WHERE id = %s", (stock_id,))
            conn.commit()
            cur.close()
            return code
        
        conn.rollback()
        cur.close()
    finally:
        release_connection(conn)
    return None

