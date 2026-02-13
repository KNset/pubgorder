import psycopg2
import sqlite3
import json
import db  # Import the db module to initialize schema
from datetime import datetime

# PostgreSQL Configuration
PG_HOST = "72.62.120.240"
PG_PORT = "5432"
PG_DB = "uc_shop_db"
PG_USER = "postgres"
PG_PASS = "1001"

# SQLite Configuration
SQLITE_DB = "uc_shop.db"

def migrate():
    print("🚀 Starting migration from PostgreSQL to SQLite...")
    
    # Initialize SQLite Schema first
    print("🛠 Initializing SQLite Schema...")
    db.init_db()
    
    try:
        # Connect to Postgres
        pg_conn = psycopg2.connect(
            host=PG_HOST,
            port=PG_PORT,
            dbname=PG_DB,
            user=PG_USER,
            password=PG_PASS
        )
        pg_cur = pg_conn.cursor()
        print("✅ Connected to PostgreSQL")
    except Exception as e:
        print(f"❌ Failed to connect to PostgreSQL: {e}")
        return

    try:
        # Connect to SQLite
        sqlite_conn = sqlite3.connect(SQLITE_DB)
        sqlite_cur = sqlite_conn.cursor()
        print("✅ Connected to SQLite")
        
        # Enable FK support just in case, though we are inserting raw data
        sqlite_cur.execute("PRAGMA foreign_keys = OFF;") 
        
    except Exception as e:
        print(f"❌ Failed to connect to SQLite: {e}")
        pg_conn.close()
        return

    # Tables to migrate in order (to minimize FK issues if we were enforcing them)
    tables = [
        "users",
        "games",
        "game_packages",
        "packages",
        "stocks",
        "history",
        "payment_methods",
        "admins",
        "api_config"
    ]

    try:
        for table in tables:
            print(f"📦 Migrating table: {table}...")
            
            # Fetch from Postgres
            pg_cur.execute(f"SELECT * FROM {table}")
            rows = pg_cur.fetchall()
            
            if not rows:
                print(f"   ⚠️ Table {table} is empty. Skipping.")
                continue
                
            # Get column names
            colnames = [desc[0] for desc in pg_cur.description]
            placeholders = ",".join(["?"] * len(colnames))
            columns = ",".join(colnames)
            
            # Special handling for boolean/json if needed
            # SQLite handles dynamic types well. Postgres JSONB -> SQLite TEXT/JSON is fine.
            # Postgres BOOLEAN -> SQLite INTEGER (0/1) or TEXT ('true'/'false'). 
            # SQLite usually stores booleans as 0/1 integers.
            
            formatted_rows = []
            for row in rows:
                new_row = list(row)
                for i, val in enumerate(new_row):
                    # Convert dict/list (JSON) to string for SQLite
                    if isinstance(val, (dict, list)):
                        new_row[i] = json.dumps(val)
                    # Convert datetime to string
                    elif isinstance(val, datetime):
                         new_row[i] = val.isoformat()
                formatted_rows.append(tuple(new_row))

            # Insert into SQLite
            # Use INSERT OR REPLACE to overwrite existing data (e.g. initial seeds)
            sqlite_cur.executemany(f"INSERT OR REPLACE INTO {table} ({columns}) VALUES ({placeholders})", formatted_rows)
            print(f"   ✅ Migrated {len(rows)} rows.")
            
        sqlite_conn.commit()
        print("\n🎉 Migration Completed Successfully!")
        
    except Exception as e:
        print(f"\n❌ Migration Failed: {e}")
        sqlite_conn.rollback()
    finally:
        pg_conn.close()
        sqlite_conn.close()

if __name__ == "__main__":
    migrate()
