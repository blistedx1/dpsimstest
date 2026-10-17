const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL environment variable is required. Please set it in your .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    console.log('Connecting to Neon PostgreSQL to initialize schema...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_data (
        key VARCHAR(50) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table "inventory_data" verified/created successfully.');
    
    // Check if data already exists
    const res = await pool.query('SELECT key, updated_at FROM inventory_data');
    console.log('Current keys in database:', res.rows);
  } catch (err) {
    console.error('Database initialization error:', err);
  } finally {
    await pool.end();
  }
}

initDB();
