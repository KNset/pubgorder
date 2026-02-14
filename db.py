import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
import os
from datetime import datetime

# Database Configuration
DB_NAME = os.getenv("DB_NAME", "uc_shop_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS", "1001")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")

# Global Cache
_USER_CACHE = {} # {user_id: {'data': user_row, 'ts': timestamp}}
CACHE_TTL = 1800 # 30 minutes (Increased from 5 mins)

# Connection Pool
try:
    db_pool = psycopg2.pool.ThreadedConnectionPool(
        5,   # minconn: Keep 5 connections ready
        40,  # maxconn: Allow up to 40 concurrent DB operations
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        host=DB_HOST,
        port=DB_PORT,
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5
    )
    print("Database connection pool created with maxconn=40.")
except Exception as e:
    print(f"Error creating connection pool: {e}")
    db_pool = None

# Background Pinger to keep connections alive (application level)
import threading
import time

def keep_alive_monitor():
    while True:
        time.sleep(45) # Ping every 45 seconds
        if db_pool:
            try:
                conn = db_pool.getconn()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT 1")
                    cur.close()
                finally:
                    db_pool.putconn(conn)
            except Exception as e:
                print(f"Keep-alive ping failed: {e}")

# Start monitor thread
if db_pool:
    t = threading.Thread(target=keep_alive_monitor, daemon=True)
    t.start()


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
    release_connection(conn)
    print("Database initialized successfully.")

def get_user(user_id, username=None):
    # 1. Check Cache first
    import time
    now = time.time()
    if user_id in _USER_CACHE:
        cached = _USER_CACHE[user_id]
        if now - cached['ts'] < CACHE_TTL:
            # If username updated, update cache lazily?
            # For now, just return cached data to be super fast
            return cached['data']

    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
        user = cur.fetchone()
        
        if not user:
            # Create new user
            cur.execute("INSERT INTO users (user_id, username, balance) VALUES (%s, %s, 0) RETURNING *", (user_id, username))
            user = cur.fetchone()
            conn.commit()
        elif username and user['username'] != username:
            # Update username if changed (WRITE operation)
            cur.execute("UPDATE users SET username = %s WHERE user_id = %s", (username, user_id))
            conn.commit()
            user['username'] = username
            
        cur.close()
        
        # Update Cache
        _USER_CACHE[user_id] = {'data': user, 'ts': now}
        
    except Exception as e:
        print(f"DB Error get_user: {e}")
        if conn: conn.rollback()
        raise e
    finally:
        release_connection(conn)
    return user

def update_balance(user_id, amount):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET balance = balance + %s WHERE user_id = %s", (amount, user_id))
        conn.commit()
        cur.close()
        
        # Invalidate Cache for this user so next read fetches new balance
        if user_id in _USER_CACHE:
            del _USER_CACHE[user_id]
            
    except Exception as e:
        print(f"DB Error update_balance: {e}")
        if conn: conn.rollback()
        raise e
    finally:
        release_connection(conn)

def update_user_username(user_id, username):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET username = %s WHERE user_id = %s", (username, user_id))
        conn.commit()
        cur.close()
        
        # Invalidate Cache
        if user_id in _USER_CACHE:
             del _USER_CACHE[user_id]
             
    except Exception as e:
        print(f"DB Error update_user_username: {e}")
        if conn: conn.rollback()
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

def get_packages():
    # Cache packages (Legacy PUBG packages)
    import time
    now = time.time()
    if 'legacy_packages' in _USER_CACHE:
        cached = _USER_CACHE['legacy_packages']
        if now - cached['ts'] < CACHE_TTL:
            return cached['data']

    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM packages ORDER BY price ASC")
        packages = cur.fetchall()
        result = {}
        for p in packages:
            result[p['identifier']] = p
        cur.close()
        
        _USER_CACHE['legacy_packages'] = {'data': result, 'ts': now}
        
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
            
            if 'legacy_packages' in _USER_CACHE: del _USER_CACHE['legacy_packages']
            
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
        
        if 'legacy_packages' in _USER_CACHE: del _USER_CACHE['legacy_packages']
        
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
        
        if 'legacy_packages' in _USER_CACHE: del _USER_CACHE['legacy_packages']
        
    finally:
        release_connection(conn)
    return deleted

def get_payment_methods():
    # Cache payment methods
    import time
    now = time.time()
    if 'payment_methods' in _USER_CACHE:
        cached = _USER_CACHE['payment_methods']
        if now - cached['ts'] < CACHE_TTL:
            return cached['data']

    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY id ASC")
        methods = cur.fetchall()
        cur.close()
        
        _USER_CACHE['payment_methods'] = {'data': methods, 'ts': now}
        
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
        
        if 'payment_methods' in _USER_CACHE: del _USER_CACHE['payment_methods']
        
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
        
        if 'payment_methods' in _USER_CACHE: del _USER_CACHE['payment_methods']
        
    finally:
        release_connection(conn)
    return deleted

def is_admin(user_id):
    # 1. Check Cache first
    import time
    now = time.time()
    cache_key = f"admin_{user_id}"
    if cache_key in _USER_CACHE:
        cached = _USER_CACHE[cache_key]
        if now - cached['ts'] < CACHE_TTL:
            return cached['data']

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM admins WHERE user_id = %s", (user_id,))
        exists = cur.fetchone() is not None
        cur.close()
        
        # Cache the result
        _USER_CACHE[cache_key] = {'data': exists, 'ts': now}
        
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
            
            # Invalidate Cache
            cache_key = f"admin_{user_id}"
            if cache_key in _USER_CACHE:
                del _USER_CACHE[cache_key]
                
        except Exception:
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
        
        # Invalidate Cache
        cache_key = f"admin_{user_id}"
        if cache_key in _USER_CACHE:
            del _USER_CACHE[cache_key]
            
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
    # Cache all games as they rarely change
    import time
    now = time.time()
    if 'games_list' in _USER_CACHE:
        cached = _USER_CACHE['games_list']
        if now - cached['ts'] < CACHE_TTL:
            return cached['data']

    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM games WHERE is_active = TRUE ORDER BY id ASC")
        games = cur.fetchall()
        cur.close()
        
        _USER_CACHE['games_list'] = {'data': games, 'ts': now}
        
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
            
            # Invalidate cache
            if 'games_list' in _USER_CACHE: del _USER_CACHE['games_list']
            
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
        
        # Invalidate cache
        if 'games_list' in _USER_CACHE: del _USER_CACHE['games_list']
        
    finally:
        release_connection(conn)

# --- Game Package Functions ---

def get_game_packages(game_id):
    # Cache packages by game_id
    import time
    now = time.time()
    cache_key = f"packages_{game_id}"
    if cache_key in _USER_CACHE:
        cached = _USER_CACHE[cache_key]
        if now - cached['ts'] < CACHE_TTL:
            return cached['data']

    conn = get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT * FROM game_packages WHERE game_id = %s ORDER BY price ASC", (game_id,))
        packages = cur.fetchall()
        cur.close()
        
        _USER_CACHE[cache_key] = {'data': packages, 'ts': now}
        
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
        
        # Invalidate cache
        cache_key = f"packages_{game_id}"
        if cache_key in _USER_CACHE: del _USER_CACHE[cache_key]
        
    finally:
        release_connection(conn)

def delete_game_package(package_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        # Need game_id to invalidate cache, so fetch it first or invalidate all?
        # Let's just invalidate all packages for simplicity or do a subquery
        cur.execute("DELETE FROM game_packages WHERE id = %s RETURNING game_id", (package_id,))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        
        if row:
            cache_key = f"packages_{row[0]}"
            if cache_key in _USER_CACHE: del _USER_CACHE[cache_key]
            
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

if __name__ == "__main__":
    init_db()

