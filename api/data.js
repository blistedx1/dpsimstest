const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('DATABASE_URL environment variable is not set. Ensure it is defined in .env or deployment settings.');
}

// Global cached pool across serverless function invocations
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    });
    pool.on('error', (err) => {
      console.warn('Neon Cloud DB pool warning:', err.message);
    });
  }
  return pool;
}

// Auto-initialize tables if not exists
let tablesReady = false;
async function ensureTables(p) {
  if (tablesReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS inventory_data (
      key VARCHAR(50) PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id BIGSERIAL PRIMARY KEY,
      key VARCHAR(50) NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_key_id ON inventory_snapshots (key, id DESC);
  `);
  tablesReady = true;
}

// Helper to retry queries on transient cold-starts or socket timeouts
async function withRetry(fn, retries = 2, delayMs = 300) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise(r => setTimeout(r, delayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
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
      error: 'DATABASE_URL environment variable is missing. Please configure DATABASE_URL in Vercel settings or .env file.'
    });
  }

  const p = getPool();

  try {
    await withRetry(() => ensureTables(p));

    // Health check endpoint
    const urlStr = req.url || '';
    const isHealthCheck = (req.query && req.query.health === 'true') || urlStr.includes('health=true') || urlStr.includes('/health');
    if (isHealthCheck) {
      const pingStart = Date.now();
      const ping = await withRetry(() => p.query('SELECT NOW() as now, version() as version, current_database() as db'));
      const latencyMs = Date.now() - pingStart;

      const stats = await p.query('SELECT key, pg_size_pretty(pg_column_size(data)::bigint) as size, updated_at FROM inventory_data');
      let itemCount = 0;
      let logsCount = 0;
      let facultyCount = 0;
      let lastUpdated = null;

      const itemsRow = await p.query("SELECT data, updated_at FROM inventory_data WHERE key = 'items'");
      if (itemsRow.rows.length > 0 && Array.isArray(itemsRow.rows[0].data)) {
        itemCount = itemsRow.rows[0].data.length;
        lastUpdated = itemsRow.rows[0].updated_at;
        itemsRow.rows[0].data.forEach(it => {
          (it.variants || []).forEach(v => {
            if (v.logs && Array.isArray(v.logs)) logsCount += v.logs.length;
          });
        });
      }

      const facRow = await p.query("SELECT data, updated_at FROM inventory_data WHERE key = 'faculties'");
      if (facRow.rows.length > 0 && Array.isArray(facRow.rows[0].data)) {
        facultyCount = facRow.rows[0].data.length;
        if (!lastUpdated || new Date(facRow.rows[0].updated_at) > new Date(lastUpdated)) {
          lastUpdated = facRow.rows[0].updated_at;
        }
      }

      const snapshotCountRes = await p.query('SELECT COUNT(*) as count FROM inventory_snapshots');
      const snapshotCount = parseInt(snapshotCountRes.rows[0].count) || 0;

      return res.status(200).json({
        success: true,
        healthy: true,
        latencyMs,
        db: ping.rows[0].db,
        serverTime: ping.rows[0].now,
        pgVersion: ping.rows[0].version.split(' on ')[0],
        itemCount,
        logsCount,
        facultyCount,
        snapshotCount,
        lastUpdated,
        tables: stats.rows
      });
    }

    if (req.method === 'GET') {
      const result = await withRetry(() => p.query('SELECT key, data, updated_at FROM inventory_data'));
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
          const itemsJson = JSON.stringify(body.items);
          await client.query(`
            INSERT INTO inventory_data (key, data, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE
            SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP;
          `, ['items', itemsJson]);

          // Keep snapshot for safety and rollback protection
          await client.query(`
            INSERT INTO inventory_snapshots (key, data, created_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP);
          `, ['items', itemsJson]);

          // Keep latest 50 snapshots
          await client.query(`
            DELETE FROM inventory_snapshots
            WHERE key = 'items' AND id NOT IN (
              SELECT id FROM inventory_snapshots WHERE key = 'items' ORDER BY id DESC LIMIT 50
            );
          `);
        }

        if (body.faculties !== undefined) {
          const facJson = JSON.stringify(body.faculties);
          await client.query(`
            INSERT INTO inventory_data (key, data, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE
            SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP;
          `, ['faculties', facJson]);

          await client.query(`
            INSERT INTO inventory_snapshots (key, data, created_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP);
          `, ['faculties', facJson]);

          await client.query(`
            DELETE FROM inventory_snapshots
            WHERE key = 'faculties' AND id NOT IN (
              SELECT id FROM inventory_snapshots WHERE key = 'faculties' ORDER BY id DESC LIMIT 50
            );
          `);
        }

        await client.query('COMMIT');
        return res.status(200).json({
          success: true,
          message: 'Data synced successfully to Neon PostgreSQL',
          updatedAt: new Date().toISOString()
        });
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
