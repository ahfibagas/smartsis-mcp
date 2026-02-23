// ═══════════════════════════════════════════════════════════
//  MCP SERVER — SMK SMART SIS
//  Semua query laporan dikonversi menjadi MCP Tools
// ═══════════════════════════════════════════════════════════

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pool, { testConnection } from "./db";
import type { ToolResponse } from "./types";

const server = new McpServer({
  name: "smksmartsis",
  version: "1.0.0",
  description: "Sistem Informasi SMK — Chatbot AI dengan akses database MySQL",
});

// ═══════════════════════════════════════════════════════════
// HELPER: Format response tool secara konsisten
// ═══════════════════════════════════════════════════════════
function formatResponse(label: string, data: any, summary?: Record<string, any>): ToolResponse {
  const result: any = {
    laporan: label,
    waktu_query: new Date().toISOString(),
    jumlah_data: Array.isArray(data) ? data.length : 1,
  };

  if (summary) result.ringkasan = summary;
  result.data = data;

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

function errorResponse(message: string): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: true, pesan: message }) }],
  };
}


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 1: REKAP KEHADIRAN PER SISWA PER BULAN (Query 1.1) ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "rekap_kehadiran_siswa",
  "Menampilkan rekap kehadiran/absensi setiap siswa dalam bulan dan tahun tertentu. " +
  "Termasuk jumlah hadir, sakit, izin, alpa, dan persentase kehadiran. " +
  "Gunakan tool ini ketika user bertanya tentang absensi, kehadiran, atau presensi siswa.",
  {
    bulan: z.number().min(1).max(12).describe("Bulan (1-12)"),
    tahun: z.number().min(2020).max(2030).describe("Tahun (misal: 2026)"),
    nama_siswa: z.string().optional().describe("Filter berdasarkan nama siswa (opsional)"),
    kelas: z.string().optional().describe("Filter berdasarkan nama kelas (opsional)"),
  },
  async ({ bulan, tahun, nama_siswa, kelas }) => {
    try {
      let query = `
        SELECT 
          s.nis,
          s.nama AS nama_siswa,
          k.nama AS kelas,
          MONTHNAME(MIN(a.tanggal)) AS bulan,
          YEAR(MIN(a.tanggal)) AS tahun,
          SUM(CASE WHEN a.status = 'Hadir' THEN 1 ELSE 0 END) AS total_hadir,
          SUM(CASE WHEN a.status = 'Sakit' THEN 1 ELSE 0 END) AS total_sakit,
          SUM(CASE WHEN a.status = 'Izin' THEN 1 ELSE 0 END) AS total_izin,
          SUM(CASE WHEN a.status = 'Alfa' THEN 1 ELSE 0 END) AS total_alpa,
          COUNT(*) AS total_hari,
          ROUND(SUM(CASE WHEN a.status = 'Hadir' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS persentase_kehadiran
        FROM absensi a
        JOIN siswa s ON a.siswa_id = s.id
        JOIN kelas k ON a.kelas_id = k.id
        WHERE MONTH(a.tanggal) = ? AND YEAR(a.tanggal) = ?
          AND a.deleted_at IS NULL
          AND s.deleted_at IS NULL
          AND k.deleted_at IS NULL
      `;
      const params: any[] = [bulan, tahun];

      if (nama_siswa) {
        query += ` AND s.nama LIKE ?`;
        params.push(`%${nama_siswa}%`);
      }
      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }

      query += ` GROUP BY s.id, s.nis, s.nama, k.id, k.nama, MONTH(a.tanggal), YEAR(a.tanggal)
                 ORDER BY k.nama, s.nama`;

      const [rows] = await pool.execute(query, params) as [any[], any];

      // Hitung ringkasan
      const totalSiswa = rows.length;
      const avgKehadiran = totalSiswa > 0
        ? (rows.reduce((sum: number, r: any) => sum + parseFloat(r.persentase_kehadiran), 0) / totalSiswa).toFixed(2)
        : 0;
      const totalAlpa = rows.reduce((sum: number, r: any) => sum + parseInt(r.total_alpa), 0);

      return formatResponse("Rekap Kehadiran Per Siswa Per Bulan", rows, {
        total_siswa: totalSiswa,
        rata_rata_kehadiran: `${avgKehadiran}%`,
        total_alpa_semua_siswa: totalAlpa,
        periode: `${bulan}/${tahun}`,
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data kehadiran: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 2: REKAP KEHADIRAN PER KELAS (Query 1.2)           ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "rekap_kehadiran_kelas",
  "Menampilkan rekap kehadiran per kelas (dashboard wali kelas). " +
  "Termasuk rata-rata kehadiran, total alpa, dan total sakit per kelas. " +
  "Gunakan ketika user bertanya tentang performa kehadiran kelas atau laporan wali kelas.",
  {
    tanggal_awal: z.string().describe("Tanggal awal periode (format: YYYY-MM-DD)"),
    tanggal_akhir: z.string().describe("Tanggal akhir periode (format: YYYY-MM-DD)"),
    kelas: z.string().optional().describe("Filter nama kelas tertentu (opsional)"),
    jurusan: z.string().optional().describe("Filter jurusan tertentu (opsional)"),
  },
  async ({ tanggal_awal, tanggal_akhir, kelas, jurusan }) => {
    try {
      let query = `
        SELECT
          k.nama AS kelas,
          k.jurusan,
          k.wali_kelas,
          COUNT(DISTINCT a.siswa_id) AS jumlah_siswa,
          ROUND(AVG(CASE WHEN a.status = 'Hadir' THEN 100.0 ELSE 0 END), 2) AS rata_rata_kehadiran,
          SUM(CASE WHEN a.status = 'Alfa' THEN 1 ELSE 0 END) AS total_alpa_kelas,
          SUM(CASE WHEN a.status = 'Sakit' THEN 1 ELSE 0 END) AS total_sakit_kelas
        FROM absensi a
        JOIN kelas k ON a.kelas_id = k.id
        WHERE a.tanggal BETWEEN ? AND ?
          AND a.deleted_at IS NULL
          AND k.deleted_at IS NULL
      `;
      const params: any[] = [tanggal_awal, tanggal_akhir];

      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }
      if (jurusan) {
        query += ` AND k.jurusan LIKE ?`;
        params.push(`%${jurusan}%`);
      }

      query += ` GROUP BY k.id, k.nama, k.jurusan, k.wali_kelas
                 ORDER BY rata_rata_kehadiran DESC`;

      const [rows] = await pool.execute(query, params) as [any[], any];

      return formatResponse("Rekap Kehadiran Per Kelas", rows, {
        total_kelas: rows.length,
        periode: `${tanggal_awal} s/d ${tanggal_akhir}`,
        kelas_terbaik: rows.length > 0 ? rows[0].kelas : '-',
        kelas_terendah: rows.length > 0 ? rows[rows.length - 1].kelas : '-',
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data kehadiran kelas: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 3: DAFTAR SISWA RAWAN KEHADIRAN < 75% (Query 1.3)  ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "siswa_rawan_kehadiran",
  "Menampilkan daftar siswa yang kehadirannya di bawah 75% (siswa rawan). " +
  "Termasuk nomor WhatsApp orang tua untuk tindak lanjut. " +
  "Gunakan ketika user bertanya tentang siswa bermasalah, sering bolos, atau kehadiran rendah.",
  {
    tahun: z.number().min(2020).max(2030).describe("Tahun ajaran"),
    batas_persen: z.number().default(75).describe("Batas persentase kehadiran (default 75%)"),
    kelas: z.string().optional().describe("Filter kelas tertentu (opsional)"),
  },
  async ({ tahun, batas_persen, kelas }) => {
    try {
      let query = `
        SELECT
          s.nis,
          s.nama,
          k.nama AS kelas,
          s.whatsapp_orang_tua,
          s.nama_orang_tua,
          COUNT(*) AS total_hari,
          SUM(CASE WHEN a.status = 'Hadir' THEN 1 ELSE 0 END) AS hadir,
          SUM(CASE WHEN a.status = 'Alfa' THEN 1 ELSE 0 END) AS alpa,
          ROUND(SUM(CASE WHEN a.status = 'Hadir' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS persen_hadir
        FROM absensi a
        JOIN siswa s ON a.siswa_id = s.id
        JOIN kelas k ON a.kelas_id = k.id
        WHERE a.tanggal BETWEEN CONCAT(?, '-01-01') AND CONCAT(?, '-12-31')
          AND a.deleted_at IS NULL
          AND s.deleted_at IS NULL
          AND k.deleted_at IS NULL
      `;
      const params: any[] = [tahun, tahun];

      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }

      query += `
        GROUP BY s.id, s.nis, s.nama, s.whatsapp_orang_tua, s.nama_orang_tua, k.id, k.nama
        HAVING persen_hadir < ?
        ORDER BY persen_hadir ASC
      `;
      params.push(batas_persen);

      const [rows] = await pool.execute(query, params) as [any[], any];

      return formatResponse("Daftar Siswa Rawan Kehadiran", rows, {
        total_siswa_rawan: rows.length,
        batas_kehadiran: `< ${batas_persen}%`,
        tahun: tahun,
        siswa_paling_rawan: rows.length > 0 ? `${rows[0].nama} (${rows[0].persen_hadir}%)` : '-',
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data siswa rawan: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 4: REKAP TAGIHAN & PEMBAYARAN SPP (Query 2.1)      ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "rekap_tagihan_spp",
  "Menampilkan rekap tagihan dan pembayaran SPP per siswa. " +
  "Termasuk jumlah tagihan, sisa tagihan, status (LUNAS/MENUNGGAK/BELUM LUNAS). " +
  "Gunakan ketika user bertanya tentang SPP, tagihan, atau pembayaran siswa tertentu.",
  {
    tahun: z.number().min(2020).max(2030).describe("Tahun tagihan"),
    nama_siswa: z.string().optional().describe("Filter nama siswa (opsional)"),
    nis: z.string().optional().describe("Filter NIS siswa (opsional)"),
    kelas: z.string().optional().describe("Filter kelas (opsional)"),
    status: z.enum(["lunas", "belum_lunas", "menunggak"]).optional().describe("Filter status tagihan"),
  },
  async ({ tahun, nama_siswa, nis, kelas, status }) => {
    try {
      let query = `
        SELECT 
          s.nis, s.nama AS nama_siswa,
          k.nama AS kelas,
          t.bulan, t.tahun,
          t.jumlah AS tagihan,
          t.sisa_tagihan,
          t.status AS status_tagihan,
          t.tanggal_jatuh_tempo,
          COALESCE(SUM(p.jumlah_bayar), 0) AS total_dibayar,
          CASE 
            WHEN t.sisa_tagihan = 0 THEN 'LUNAS'
            WHEN t.tanggal_jatuh_tempo < CURDATE() THEN 'MENUNGGAK'
            ELSE 'BELUM LUNAS'
          END AS keterangan
        FROM tagihan_spps t
        JOIN siswa s ON t.siswa_id = s.id
        JOIN kelas k ON t.kelas_id = k.id
        LEFT JOIN pembayaran_spps p ON p.tagihan_spp_id = t.id
        WHERE t.tahun = ?
          AND t.deleted_at IS NULL
          AND s.deleted_at IS NULL
          AND k.deleted_at IS NULL
      `;
      const params: any[] = [tahun];

      if (nama_siswa) {
        query += ` AND s.nama LIKE ?`;
        params.push(`%${nama_siswa}%`);
      }
      if (nis) {
        query += ` AND s.nis = ?`;
        params.push(nis);
      }
      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }

      query += `
        GROUP BY t.id, s.nis, s.nama, k.nama, t.bulan, t.tahun, 
                 t.jumlah, t.sisa_tagihan, t.status, t.tanggal_jatuh_tempo
      `;

      // Filter status setelah GROUP BY karena keterangan dihitung dari CASE
      if (status === 'lunas') {
        query += ` HAVING keterangan = 'LUNAS'`;
      } else if (status === 'menunggak') {
        query += ` HAVING keterangan = 'MENUNGGAK'`;
      } else if (status === 'belum_lunas') {
        query += ` HAVING keterangan = 'BELUM LUNAS'`;
      }

      query += ` ORDER BY k.nama, s.nama, t.bulan`;

      const [rows] = await pool.execute(query, params) as [any[], any];

      // Ringkasan keuangan
      const totalTagihan = rows.reduce((s: number, r: any) => s + parseFloat(r.tagihan), 0);
      const totalDibayar = rows.reduce((s: number, r: any) => s + parseFloat(r.total_dibayar), 0);
      const totalSisa = rows.reduce((s: number, r: any) => s + parseFloat(r.sisa_tagihan), 0);

      return formatResponse("Rekap Tagihan & Pembayaran SPP", rows, {
        tahun: tahun,
        total_record: rows.length,
        total_tagihan: `Rp ${totalTagihan.toLocaleString('id-ID')}`,
        total_dibayar: `Rp ${totalDibayar.toLocaleString('id-ID')}`,
        total_sisa: `Rp ${totalSisa.toLocaleString('id-ID')}`,
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data tagihan SPP: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 5: LAPORAN TUNGGAKAN SPP / PIUTANG (Query 2.2)     ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "laporan_tunggakan_spp",
  "Menampilkan laporan siswa yang menunggak SPP (piutang). " +
  "Termasuk jumlah bulan tunggakan, total nominal, data orang tua, dan WhatsApp. " +
  "Gunakan ketika user bertanya tentang tunggakan, piutang, atau siswa yang belum bayar SPP.",
  {
    kelas: z.string().optional().describe("Filter kelas tertentu"),
    nama_siswa: z.string().optional().describe("Filter nama siswa"),
    min_tunggakan: z.number().optional().describe("Minimal jumlah tunggakan (dalam Rupiah)"),
  },
  async ({ kelas, nama_siswa, min_tunggakan }) => {
    try {
      let query = `
        SELECT 
          s.nis, s.nama, 
          s.nama_orang_tua, s.whatsapp_orang_tua,
          k.nama AS kelas,
          COUNT(t.id) AS jumlah_bulan_tunggak,
          SUM(t.sisa_tagihan) AS total_tunggakan,
          MIN(CONCAT(t.bulan, '/', t.tahun)) AS tunggakan_sejak,
          MAX(CONCAT(t.bulan, '/', t.tahun)) AS tunggakan_sampai
        FROM tagihan_spps t
        JOIN siswa s ON t.siswa_id = s.id
        JOIN kelas k ON t.kelas_id = k.id
        WHERE t.sisa_tagihan > 0 
          AND t.tanggal_jatuh_tempo < CURDATE()
          AND t.deleted_at IS NULL
          AND s.deleted_at IS NULL
          AND k.deleted_at IS NULL
      `;
      const params: any[] = [];

      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }
      if (nama_siswa) {
        query += ` AND s.nama LIKE ?`;
        params.push(`%${nama_siswa}%`);
      }

      query += `
        GROUP BY s.id, s.nis, s.nama, s.nama_orang_tua, s.whatsapp_orang_tua, k.id, k.nama
      `;

      if (min_tunggakan) {
        query += ` HAVING total_tunggakan >= ?`;
        params.push(min_tunggakan);
      }

      query += ` ORDER BY total_tunggakan DESC`;

      const [rows] = await pool.execute(query, params) as [any[], any];

      const grandTotal = rows.reduce((s: number, r: any) => s + parseFloat(r.total_tunggakan), 0);

      return formatResponse("Laporan Tunggakan SPP (Piutang)", rows, {
        total_siswa_menunggak: rows.length,
        grand_total_tunggakan: `Rp ${grandTotal.toLocaleString('id-ID')}`,
        tunggakan_tertinggi: rows.length > 0
          ? `${rows[0].nama} — Rp ${parseFloat(rows[0].total_tunggakan).toLocaleString('id-ID')}`
          : '-',
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data tunggakan: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 6: LAPORAN PENDAPATAN SPP HARIAN/BULANAN (Query 2.3)║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "laporan_pendapatan_spp",
  "Menampilkan laporan pendapatan/penerimaan pembayaran SPP per hari. " +
  "Termasuk metode pembayaran, jumlah transaksi, total pendapatan, dan kasir. " +
  "Gunakan ketika user bertanya tentang pendapatan, pemasukan, atau laporan kas SPP.",
  {
    tanggal_awal: z.string().describe("Tanggal awal (format: YYYY-MM-DD)"),
    tanggal_akhir: z.string().describe("Tanggal akhir (format: YYYY-MM-DD)"),
    metode_bayar: z.string().optional().describe("Filter metode bayar: tunai/transfer/cicil (opsional)"),
  },
  async ({ tanggal_awal, tanggal_akhir, metode_bayar }) => {
    try {
      let query = `
        SELECT 
          DATE(p.tanggal_bayar) AS tanggal,
          p.metode_pembayaran AS metode_bayar,
          COUNT(p.id) AS jumlah_transaksi,
          SUM(p.jumlah_bayar) AS total_pendapatan,
          u.name AS kasir
        FROM pembayaran_spps p
        JOIN users u ON p.user_id = u.id
        WHERE p.tanggal_bayar BETWEEN ? AND ?
          AND p.deleted_at IS NULL
      `;
      const params: any[] = [tanggal_awal, tanggal_akhir];

      if (metode_bayar) {
        query += ` AND p.metode_pembayaran LIKE ?`;
        params.push(`%${metode_bayar}%`);
      }

      query += `
        GROUP BY DATE(p.tanggal_bayar), p.metode_pembayaran, u.id, u.name
        ORDER BY tanggal DESC
      `;

      const [rows] = await pool.execute(query, params) as [any[], any];

      const totalPendapatan = rows.reduce((s: number, r: any) => s + parseFloat(r.total_pendapatan), 0);
      const totalTransaksi = rows.reduce((s: number, r: any) => s + parseInt(r.jumlah_transaksi), 0);

      return formatResponse("Laporan Pendapatan SPP", rows, {
        periode: `${tanggal_awal} s/d ${tanggal_akhir}`,
        total_pendapatan: `Rp ${totalPendapatan.toLocaleString('id-ID')}`,
        total_transaksi: totalTransaksi,
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data pendapatan: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 7: RINGKASAN KEUANGAN PER KELAS (Query 2.4)        ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "ringkasan_keuangan_kelas",
  "Menampilkan ringkasan keuangan (tagihan SPP) per kelas. " +
  "Termasuk total tagihan, total terbayar, sisa, dan persentase terbayar. " +
  "Gunakan ketika user bertanya tentang performa pembayaran per kelas atau ranking kelas.",
  {
    tahun: z.number().min(2020).max(2030).describe("Tahun tagihan"),
    jurusan: z.string().optional().describe("Filter jurusan (opsional)"),
    tingkat: z.number().optional().describe("Filter tingkat kelas: 10, 11, atau 12 (opsional)"),
  },
  async ({ tahun, jurusan, tingkat }) => {
    try {
      let query = `
        SELECT 
          k.nama AS kelas, k.jurusan, k.tingkat,
          COUNT(DISTINCT t.siswa_id) AS jumlah_siswa,
          SUM(t.jumlah) AS total_tagihan,
          SUM(t.jumlah - t.sisa_tagihan) AS total_terbayar,
          SUM(t.sisa_tagihan) AS total_sisa,
          ROUND(SUM(t.jumlah - t.sisa_tagihan) / SUM(t.jumlah) * 100, 2) AS persen_terbayar
        FROM tagihan_spps t
        JOIN kelas k ON t.kelas_id = k.id
        WHERE t.tahun = ?
          AND t.deleted_at IS NULL
          AND k.deleted_at IS NULL
      `;
      const params: any[] = [tahun];

      if (jurusan) {
        query += ` AND k.jurusan LIKE ?`;
        params.push(`%${jurusan}%`);
      }
      if (tingkat) {
        query += ` AND k.tingkat = ?`;
        params.push(tingkat);
      }

      query += `
        GROUP BY k.id, k.nama, k.jurusan, k.tingkat
        ORDER BY persen_terbayar DESC
      `;

      const [rows] = await pool.execute(query, params) as [any[], any];

      const totalSemuaTagihan = rows.reduce((s: number, r: any) => s + parseFloat(r.total_tagihan), 0);
      const totalSemuaTerbayar = rows.reduce((s: number, r: any) => s + parseFloat(r.total_terbayar), 0);

      return formatResponse("Ringkasan Keuangan Per Kelas", rows, {
        tahun: tahun,
        total_kelas: rows.length,
        grand_total_tagihan: `Rp ${totalSemuaTagihan.toLocaleString('id-ID')}`,
        grand_total_terbayar: `Rp ${totalSemuaTerbayar.toLocaleString('id-ID')}`,
        persen_keseluruhan: totalSemuaTagihan > 0 ? `${(totalSemuaTerbayar / totalSemuaTagihan * 100).toFixed(2)}%` : '0%',
        kelas_terbaik: rows.length > 0 ? `${rows[0].kelas} (${rows[0].persen_terbayar}%)` : '-',
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil ringkasan keuangan: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 8: LAPORAN SISWA PER KELAS & JURUSAN (Query 3.1)   ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "laporan_siswa_per_kelas",
  "Menampilkan jumlah siswa per kelas dan jurusan pada tahun ajaran aktif. " +
  "Termasuk wali kelas, jumlah siswa aktif dan tidak aktif. " +
  "Gunakan ketika user bertanya tentang data kelas, jumlah siswa, atau komposisi kelas.",
  {
    jurusan: z.string().optional().describe("Filter jurusan (opsional)"),
    tingkat: z.number().optional().describe("Filter tingkat: 10, 11, 12 (opsional)"),
    kelas: z.string().optional().describe("Filter nama kelas (opsional)"),
  },
  async ({ jurusan, tingkat, kelas }) => {
    try {
      let query = `
        SELECT 
          k.nama AS kelas, k.tingkat, k.jurusan, k.wali_kelas,
          ta.tahun AS tahun_ajaran,
          COUNT(pk.siswa_id) AS jumlah_siswa,
          SUM(CASE WHEN s.status = 'aktif' THEN 1 ELSE 0 END) AS siswa_aktif,
          SUM(CASE WHEN s.status != 'aktif' THEN 1 ELSE 0 END) AS siswa_tidak_aktif
        FROM penempatan_kelas pk
        JOIN kelas k ON pk.kelas_id = k.id
        JOIN tahun_ajaran ta ON pk.tahun_ajaran_id = ta.id
        JOIN siswa s ON pk.siswa_id = s.id
        WHERE ta.status = 'aktif'
          AND s.deleted_at IS NULL
          AND k.deleted_at IS NULL
          AND pk.deleted_at IS NULL
      `;
      const params: any[] = [];

      if (jurusan) {
        query += ` AND k.jurusan LIKE ?`;
        params.push(`%${jurusan}%`);
      }
      if (tingkat) {
        query += ` AND k.tingkat = ?`;
        params.push(tingkat);
      }
      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }

      query += `
        GROUP BY k.id, k.nama, k.tingkat, k.jurusan, k.wali_kelas, ta.id, ta.tahun
        ORDER BY k.tingkat, k.jurusan, k.nama
      `;

      const [rows] = await pool.execute(query, params) as [any[], any];

      const totalSiswa = rows.reduce((s: number, r: any) => s + parseInt(r.jumlah_siswa), 0);

      return formatResponse("Laporan Siswa Per Kelas & Jurusan", rows, {
        total_kelas: rows.length,
        total_seluruh_siswa: totalSiswa,
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data kelas: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 9: PROFIL LENGKAP SISWA (Query 3.2)                ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "profil_siswa",
  "Menampilkan profil lengkap siswa termasuk data pribadi, kelas, jurusan, wali kelas, " +
  "email, alamat, nama orang tua, nomor WhatsApp siswa (whatsapp_siswa), dan nomor WhatsApp orang tua (whatsapp_orang_tua). " +
  "Gunakan ketika user bertanya tentang data siswa, biodata, profil, kontak, nomor HP, WhatsApp, daftar orang tua, atau mencari siswa tertentu. " +
  "Tool ini mengembalikan nomor telepon/WhatsApp — gunakan untuk membuat link wa.me.",
  {
    nama: z.string().optional().describe("Cari berdasarkan nama siswa"),
    nis: z.string().optional().describe("Cari berdasarkan NIS"),
    kelas: z.string().optional().describe("Filter kelas (opsional)"),
    status: z.enum(["aktif", "tidak aktif", "lulus"]).optional().describe("Filter status siswa"),
    limit: z.number().default(50).describe("Batas jumlah data (default 50)"),
  },
  async ({ nama, nis, kelas, status, limit }) => {
    try {
      let query = `
        SELECT 
          s.nis, s.nama, s.email, s.tanggal_lahir, s.alamat,
          s.nama_orang_tua, s.whatsapp_siswa, s.whatsapp_orang_tua,
          s.status, s.foto_profil,
          k.nama AS kelas, k.jurusan, k.tingkat,
          k.wali_kelas, ta.tahun AS tahun_ajaran
        FROM siswa s
        JOIN penempatan_kelas pk ON pk.siswa_id = s.id
        JOIN kelas k ON pk.kelas_id = k.id
        JOIN tahun_ajaran ta ON pk.tahun_ajaran_id = ta.id
        WHERE ta.status = 'aktif' AND s.deleted_at IS NULL
          AND k.deleted_at IS NULL AND pk.deleted_at IS NULL
      `;
      const params: any[] = [];

      if (nama) {
        query += ` AND s.nama LIKE ?`;
        params.push(`%${nama}%`);
      }
      if (nis) {
        query += ` AND s.nis = ?`;
        params.push(nis);
      }
      if (kelas) {
        query += ` AND k.nama LIKE ?`;
        params.push(`%${kelas}%`);
      }
      if (status) {
        query += ` AND s.status = ?`;
        params.push(status);
      }

      query += ` ORDER BY k.nama, s.nama LIMIT ${Number(limit)}`;

      const [rows] = await pool.execute(query, params) as [any[], any];

      return formatResponse("Profil Siswa", rows, {
        total_ditemukan: rows.length,
        filter: { nama, nis, kelas, status },
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil profil siswa: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 10: REKAP TAGIHAN LAIN PER SISWA (Query 4.1)        ║
// ╚═══════════════════════════════════════════════════════════╝
server.tool(
  "rekap_tagihan_lain",
  "Menampilkan rekap tagihan lain (non-SPP) per siswa. " +
  "Termasuk nama tagihan, jumlah tagihan, sisa tagihan, dan status pembayaran. " +
  "Gunakan ketika user bertanya tentang tagihan selain SPP, iuran lain, atau biaya tambahan.",
  {
    nama_siswa: z.string().optional().describe("Filter nama siswa (opsional)"),
    nis: z.string().optional().describe("Filter NIS siswa (opsional)"),
    status: z.enum(["lunas", "belum_lunas"]).optional().describe("Filter status tagihan"),
  },
  async ({ nama_siswa, nis, status }) => {
    try {
      let query = `
        SELECT 
          s.nis, s.nama AS nama_siswa,
          jt.nama AS nama_tagihan,
          tl.jumlah AS total_tagihan,
          tl.sisa_tagihan,
          CASE 
            WHEN tl.sisa_tagihan = 0 THEN 'LUNAS'
            ELSE 'BELUM LUNAS'
          END AS status_bayar
        FROM tagihan_lains tl
        JOIN siswa s ON tl.siswa_id = s.id
        JOIN jenis_tagihans jt ON tl.jenis_tagihan_id = jt.id
        WHERE tl.deleted_at IS NULL AND s.deleted_at IS NULL
      `;
      const params: any[] = [];

      if (nama_siswa) {
        query += ` AND s.nama LIKE ?`;
        params.push(`%${nama_siswa}%`);
      }
      if (nis) {
        query += ` AND s.nis = ?`;
        params.push(nis);
      }
      if (status === 'lunas') {
        query += ` AND tl.sisa_tagihan = 0`;
      } else if (status === 'belum_lunas') {
        query += ` AND tl.sisa_tagihan > 0`;
      }

      query += ` ORDER BY s.nama`;

      const [rows] = await pool.execute(query, params) as [any[], any];

      const totalTagihan = rows.reduce((s: number, r: any) => s + parseFloat(r.total_tagihan), 0);
      const totalSisa = rows.reduce((s: number, r: any) => s + parseFloat(r.sisa_tagihan), 0);

      return formatResponse("Rekap Tagihan Lain (Non-SPP)", rows, {
        total_record: rows.length,
        total_tagihan: `Rp ${totalTagihan.toLocaleString('id-ID')}`,
        total_sisa_belum_bayar: `Rp ${totalSisa.toLocaleString('id-ID')}`,
      });
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data tagihan lain: ${error.message}`);
    }
  }
);


// ╔═══════════════════════════════════════════════════════════╗
// ║  TOOL 11: DASHBOARD EKSEKUTIF (Query 5.1)                 ║
// ╚═══════════════════════════════════════════════════════════╝

server.tool(
  "dashboard_eksekutif",
  "Menampilkan ringkasan dashboard eksekutif sekolah. " +
  "Termasuk: total siswa aktif, rata-rata kehadiran bulan ini, " +
  "pendapatan SPP bulan ini, dan total tunggakan seluruh siswa. " +
  "Gunakan ketika user bertanya tentang ringkasan, overview, dashboard, " +
  "atau kondisi umum sekolah saat ini.",
  {
    // Tidak perlu parameter — otomatis ambil data terkini
  },
  async () => {
    try {
      // Query 1: Total siswa aktif
      const [siswaRows] = await pool.execute(`
        SELECT COUNT(*) AS total_siswa_aktif 
        FROM siswa 
        WHERE status = 'aktif' AND deleted_at IS NULL
      `) as [any[], any];

      // Query 2: Rata-rata kehadiran bulan ini
      const [kehadiranRows] = await pool.execute(`
        SELECT 
          ROUND(AVG(CASE WHEN status = 'Hadir' THEN 100.0 ELSE 0 END), 2) AS rata_kehadiran,
          COUNT(*) AS total_record_absensi,
          SUM(CASE WHEN status = 'Hadir' THEN 1 ELSE 0 END) AS total_hadir,
          SUM(CASE WHEN status = 'Alfa' THEN 1 ELSE 0 END) AS total_alpa,
          SUM(CASE WHEN status = 'Sakit' THEN 1 ELSE 0 END) AS total_sakit,
          SUM(CASE WHEN status = 'Izin' THEN 1 ELSE 0 END) AS total_izin
        FROM absensi 
        WHERE MONTH(tanggal) = MONTH(CURDATE()) 
          AND YEAR(tanggal) = YEAR(CURDATE())
          AND deleted_at IS NULL
      `) as [any[], any];

      // Query 3: Pendapatan SPP bulan ini
      const [pendapatanRows] = await pool.execute(`
        SELECT 
          COALESCE(SUM(jumlah_bayar), 0) AS pendapatan_bulan_ini,
          COUNT(*) AS jumlah_transaksi
        FROM pembayaran_spps 
        WHERE MONTH(tanggal_bayar) = MONTH(CURDATE()) 
          AND YEAR(tanggal_bayar) = YEAR(CURDATE())
          AND deleted_at IS NULL
      `) as [any[], any];

      // Query 4: Total tunggakan keseluruhan
      const [tunggakanRows] = await pool.execute(`
        SELECT 
          COALESCE(SUM(sisa_tagihan), 0) AS total_tunggakan,
          COUNT(DISTINCT siswa_id) AS jumlah_siswa_menunggak
        FROM tagihan_spps 
        WHERE sisa_tagihan > 0 
          AND deleted_at IS NULL
      `) as [any[], any];

      // Query 5: Siswa rawan bulan ini (bonus)
      const [rawanRows] = await pool.execute(`
        SELECT COUNT(DISTINCT sub.siswa_id) AS siswa_rawan
        FROM (
          SELECT 
            a.siswa_id,
            ROUND(SUM(CASE WHEN a.status = 'Hadir' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS persen
          FROM absensi a
          WHERE MONTH(a.tanggal) = MONTH(CURDATE()) 
            AND YEAR(a.tanggal) = YEAR(CURDATE())
            AND a.deleted_at IS NULL
          GROUP BY a.siswa_id
          HAVING persen < 75
        ) sub
      `) as [any[], any];

      const dashboard = {
        total_siswa_aktif: siswaRows[0]?.total_siswa_aktif || 0,

        kehadiran_bulan_ini: {
          rata_rata: `${kehadiranRows[0]?.rata_kehadiran || 0}%`,
          total_hadir: kehadiranRows[0]?.total_hadir || 0,
          total_alpa: kehadiranRows[0]?.total_alpa || 0,
          total_sakit: kehadiranRows[0]?.total_sakit || 0,
          total_izin: kehadiranRows[0]?.total_izin || 0,
        },

        keuangan_bulan_ini: {
          pendapatan: `Rp ${parseFloat(pendapatanRows[0]?.pendapatan_bulan_ini || 0).toLocaleString('id-ID')}`,
          jumlah_transaksi: pendapatanRows[0]?.jumlah_transaksi || 0,
        },

        tunggakan: {
          total: `Rp ${parseFloat(tunggakanRows[0]?.total_tunggakan || 0).toLocaleString('id-ID')}`,
          jumlah_siswa_menunggak: tunggakanRows[0]?.jumlah_siswa_menunggak || 0,
        },

        siswa_rawan_kehadiran: rawanRows[0]?.siswa_rawan || 0,

        waktu_laporan: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      };

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            laporan: "Dashboard Eksekutif SMK Smart SIS",
            dashboard: dashboard,
          }, null, 2),
        }],
      };
    } catch (error: any) {
      return errorResponse(`Gagal mengambil data dashboard: ${error.message}`);
    }
  }
);


// ═══════════════════════════════════════════════════════════
//  STARTUP — Jalankan MCP Server
// ═══════════════════════════════════════════════════════════
async function main() {
  // 1. Hubungkan MCP transport DULU agar handshake tidak timeout
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 2. Baru test koneksi database
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error("⚠️  Database belum terhubung. Tools akan mengembalikan error sampai DB tersedia.");
  }

  console.error("═══════════════════════════════════════════════");
  console.error("🚀 MCP Server SMK Smart SIS AKTIF");
  console.error(`📦 Database: ${dbOk ? '✅ Terhubung' : '❌ Belum terhubung'}`);
  console.error("═══════════════════════════════════════════════");
  console.error("📋 Tools tersedia:");
  console.error("   1.  rekap_kehadiran_siswa");
  console.error("   2.  rekap_kehadiran_kelas");
  console.error("   3.  siswa_rawan_kehadiran");
  console.error("   4.  rekap_tagihan_spp");
  console.error("   5.  laporan_tunggakan_spp");
  console.error("   6.  laporan_pendapatan_spp");
  console.error("   7.  ringkasan_keuangan_kelas");
  console.error("   8.  laporan_siswa_per_kelas");
  console.error("   9.  profil_siswa");
  console.error("   10. rekap_tagihan_lain");
  console.error("   11. dashboard_eksekutif");
  console.error("═══════════════════════════════════════════════");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});