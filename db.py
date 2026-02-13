import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
import os
from datetime import datetime

# Database Configuration
DB_NAME = os.getenv("DB_NAME", "uc_shop_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS", "1001")
DB_HOST = os.getenv("DB_HOST", "72.62.120.240")
DB_PORT = os.getenv("DB_PORT", "5432")

# Global Cache
_USER_CACHE = {} # {user_id: {'data': user_row, 'ts': timestamp}}
CACHE_TTL = 300 # 5 minutes

# Connection Pool
try:
    db_pool = psycopg2.pool.ThreadedConnectionPool(
        1,  # minconn
        10, # maxconn (Increased slightly for threaded)
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

# ... (init_db and other functions remain similar, but let's optimize get_user)

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

