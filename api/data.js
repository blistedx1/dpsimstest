const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('DATABASE_URL environment variable is not set. Ensure it is defined in .env or deployment settings.');
}

// Cache pool instance across serverless function invocations
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', (err) => {
      console.warn('Neon Cloud DB idle connection warning:', err.message);
    });
  }
  return pool;
}

// Auto-initialize table if not exists
let tableReady = false;
async function ensureTable(p) {
  if (tableReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS inventory_data (
      key VARCHAR(50) PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  tableReady = true;
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!connectionString) {
    return res.status(500).json({
      success: false,
      error: 'DATABASE_URL environment variable is missing. Please add DATABASE_URL in Vercel Project Settings (Settings > Environment Variables) or local .env file.'
    });
  }

  const p = getPool();

  try {
    await ensureTable(p);

    if (req.method === 'GET') {
      const result = await p.query('SELECT key, data, updated_at FROM inventory_data');
      const dataMap = {};
      let lastUpdated = null;
      
      result.rows.forEach(row => {
        dataMap[row.key] = row.data;
        if (!lastUpdated || new Date(row.updated_at) > new Date(lastUpdated)) {
          lastUpdated = row.updated_at;
        }
      });

      return res.status(200).json({
        success: true,
        items: dataMap['items'] || null,
        faculties: dataMap['faculties'] || null,
        updatedAt: lastUpdated
      });
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // Handle Reset
      if (body.reset) {
        await p.query('TRUNCATE TABLE inventory_data');
        return res.status(200).json({ success: true, message: 'All inventory data reset in cloud database' });
      }

      const client = await p.connect();
      try {
        await client.query('BEGIN');

        if (body.items !== undefined) {
          await client.query(`
            INSERT INTO inventory_data (key, data, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE
            SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP;
          `, ['items', JSON.stringify(body.items)]);
        }

        if (body.faculties !== undefined) {
          await client.query(`
            INSERT INTO inventory_data (key, data, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE
            SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP;
          `, ['faculties', JSON.stringify(body.faculties)]);
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Data synced successfully to Neon PostgreSQL' });
      } catch (saveErr) {
        await client.query('ROLLBACK');
        throw saveErr;
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
};
