# SMK Smart SIS — Sistem Informasi Sekolah dengan AI

Asisten AI berbasis **Model Context Protocol (MCP)** untuk manajemen data SMK, termasuk kehadiran siswa, tagihan SPP, keuangan, dan profil siswa. Data diambil langsung dari database MySQL melalui MCP tools dan disajikan via chat AI (Ollama).

## Arsitektur

```
Browser (React)  ←→  Express Backend  ←→  Ollama LLM
                          ↕
                     MCP Client (stdio)
                          ↕
                     MCP Server (11 tools)
                          ↕
                       MySQL DB
```

| Layer | Teknologi |
|---|---|
| Frontend | React 19, Tailwind CSS v4, Vite, Recharts, jsPDF, SheetJS |
| Backend | Express.js, MCP SDK Client, Ollama |
| MCP Server | MCP SDK Server (stdio transport), MySQL2 |
| Database | MySQL — `smksmartsis` |
| AI Model | Ollama (`gpt-oss:120b-cloud` / `llama3.2`) |

## Fitur

- **Chat AI** — Tanya jawab natural language ke database sekolah
- **11 MCP Tools** — rekap kehadiran, tunggakan SPP, profil siswa, dashboard eksekutif, dll.
- **Markdown Rendering** — Tabel, heading, list, code block, blockquote, link
- **WhatsApp Links** — Tombol WA otomatis untuk kontak orang tua
- **Export PDF & Excel** — Setiap tabel memiliki tombol download PDF/Excel
- **Chart Visualisasi** — Bar, Line, Pie chart otomatis untuk data numerik
- **Notifikasi Tunggakan** — Bell icon dengan polling otomatis
- **Chat History** — Disimpan di localStorage, persist saat refresh
- **Multi-session** — Buat banyak percakapan paralel

## Prasyarat

- **Node.js** ≥ 18
- **MySQL** dengan database `smksmartsis`
- **Ollama** running di `http://localhost:11434`

## Instalasi

```bash
git clone <repo-url>
cd smartsis-mcp
npm install
```

## Konfigurasi

Buat file `.env` (opsional):

```env
PORT=3000
OLLAMA_MODEL=gpt-oss:120b-cloud
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=Sintang2025
DB_NAME=smksmartsis
```

## Menjalankan

```bash
# Build frontend
npm run build:frontend

# Jalankan backend (otomatis spawn MCP server)
npm run start:backend
```

Buka `http://localhost:3000` di browser.

### Development

```bash
# Frontend dev server (hot reload, proxy ke :3000)
npm run dev:frontend

# Backend
npm run start:backend
```

## Struktur Proyek

```
├── src/
│   ├── backend.ts        # Express server + MCP client + Ollama
│   ├── mcp-server.ts     # MCP Server dengan 11 database tools
│   ├── db.ts             # MySQL connection pool
│   └── types.ts          # Shared TypeScript interfaces
├── frontend/
│   ├── index.tsx          # React app utama (~1600 baris)
│   ├── main.tsx           # React entry point
│   ├── App.tsx            # App wrapper
│   ├── index.html         # HTML template
│   └── index.css          # Tailwind import
├── frontend-dist/         # Vite build output (gitignored)
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## MCP Tools

| # | Tool | Deskripsi |
|---|---|---|
| 1 | `rekap_kehadiran_siswa` | Rekap kehadiran per siswa |
| 2 | `rekap_kehadiran_kelas` | Rekap kehadiran per kelas |
| 3 | `siswa_rawan_kehadiran` | Siswa dengan kehadiran < threshold |
| 4 | `rekap_tagihan_spp` | Rekap tagihan SPP |
| 5 | `laporan_tunggakan_spp` | Daftar siswa yang menunggak |
| 6 | `laporan_pendapatan_spp` | Pendapatan SPP per periode |
| 7 | `ringkasan_keuangan_kelas` | Ringkasan keuangan per kelas |
| 8 | `laporan_siswa_per_kelas` | Daftar siswa per kelas |
| 9 | `profil_siswa` | Profil lengkap + WhatsApp |
| 10 | `rekap_tagihan_lain` | Tagihan non-SPP |
| 11 | `dashboard_eksekutif` | Ringkasan seluruh sekolah |

## Lisensi

MIT
