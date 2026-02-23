// ═══════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

export interface RekapKehadiran {
  nis: string;
  nama_siswa: string;
  kelas: string;
  bulan: string;
  tahun: number;
  total_hadir: number;
  total_sakit: number;
  total_izin: number;
  total_alpa: number;
  total_hari: number;
  persentase_kehadiran: number;
}

export interface DetailKehadiranHarian {
  nis: string;
  nama_siswa: string;
  kelas: string;
  tanggal: string;
  hari: string;
  status: 'Hadir' | 'Sakit' | 'Izin' | 'Alfa';
  metode: string;
  waktu_absen: string | null;
}

export interface DashboardEksekutif {
  total_siswa_aktif: number;
  rata_kehadiran_bulan_ini: number;
  pendapatan_bulan_ini: number;
  total_tunggakan: number;
}