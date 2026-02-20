// ═══════════════════════════════════════════════════════════
// DATABASE CONNECTION POOL
// ═══════════════════════════════════════════════════════════

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smksmartsis',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 10000, // 10 detik timeout koneksi
  // Timezone sekolah
  timezone: '+07:00',
});

// Test koneksi saat startup
export async function testConnection(): Promise<boolean> {
  try {
    const conn = await pool.getConnection();
    console.error('✅ Database MySQL terhubung ke:', process.env.DB_NAME);
    conn.release();
    return true;
  } catch (error) {
    console.error('❌ Gagal terhubung ke database:', error);
    return false;
  }
}

export default pool;