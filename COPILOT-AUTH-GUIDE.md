# 🔐 Panduan Autentikasi Copilot SDK — SMK Smart SIS

## Masalah

Saat menjalankan `npm run start:backend`, muncul error:

```
⚠️  Copilot belum terautentikasi. Jalankan 'copilot login' atau set COPILOT_GITHUB_TOKEN.
❌ Gagal list models: Request models.list failed with message: Not authenticated. Please authenticate first.
```

## Penyebab

Copilot SDK membutuhkan autentikasi ke GitHub untuk mengakses API Copilot. Token `ghu_` (user-to-server token dari GitHub App/VS Code) **tidak didukung** oleh Copilot SDK standalone.

### Tipe Token yang Didukung

| Tipe Token | Prefix | Didukung? |
|---|---|---|
| Fine-grained PAT (v2) | `github_pat_` | ✅ Ya (perlu permission "Copilot Requests") |
| OAuth dari `copilot login` | (disimpan otomatis) | ✅ Ya |
| OAuth dari `gh` CLI | (disimpan otomatis) | ✅ Ya |
| Classic PAT | `ghp_` | ❌ Tidak |
| User-to-server token | `ghu_` | ❌ Tidak |

---

## Solusi 1: Copilot Login (Rekomendasi) ⭐

Cara paling mudah — autentikasi via browser menggunakan OAuth device flow.

### Langkah-langkah

#### 1. Buka Terminal di folder project

```powershell
cd D:\smartsis-mcp
```

#### 2. Jalankan perintah login

```powershell
node "node_modules\@github\copilot\index.js" login
```

#### 3. Ikuti instruksi di terminal

Terminal akan menampilkan:

```
To authenticate, visit https://github.com/login/device and enter code XXXX-XXXX.
Waiting for authorization...
```

#### 4. Buka browser, masuk ke URL tersebut

1. Buka **https://github.com/login/device**
2. Login ke akun GitHub Anda (jika belum)
3. Masukkan **kode** yang ditampilkan di terminal (contoh: `C8D3-C79D`)
4. Klik **"Authorize"**

#### 5. Tunggu konfirmasi

Terminal akan menampilkan:

```
Signed in successfully as <username-anda>.
```

#### 6. Pastikan `.env` TIDAK memiliki token invalid

Buka file `.env` dan pastikan `COPILOT_GITHUB_TOKEN` **di-comment** atau dihapus:

```env
# GitHub Copilot Token
# COPILOT_GITHUB_TOKEN=ghu_xxxxx   ← COMMENT OUT atau hapus baris ini
```

> **Kenapa?** Jika `COPILOT_GITHUB_TOKEN` diisi token yang tidak valid, SDK akan pakai token itu (bukan stored credential) dan gagal autentikasi.

#### 7. Jalankan backend

```powershell
npm run start:backend
```

Anda harus melihat:

```
✅ Copilot SDK client started (model: claude-sonnet-4.6)
🔐 Auth: user — <username-anda>
🌐 Backend berjalan di: http://localhost:3001
```

---

## Solusi 2: Fine-grained Personal Access Token (PAT)

Untuk server/automation tanpa browser (headless).

### Langkah-langkah

#### 1. Buat token di GitHub

1. Buka **https://github.com/settings/personal-access-tokens/new**
2. Isi:
   - **Token name**: `smartsis-copilot`
   - **Expiration**: pilih durasi (misal 90 hari)
   - **Repository access**: No repositories (tidak perlu akses repo)
3. Di bagian **Account permissions**:
   - Cari **"Copilot"** → set ke **Read and Write**
4. Klik **Generate token**
5. **Salin token** (format: `github_pat_...`)

#### 2. Masukkan ke `.env`

```env
# GitHub Copilot Token
COPILOT_GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxx
```

#### 3. Jalankan backend

```powershell
npm run start:backend
```

---

## Solusi 3: GitHub CLI (`gh`)

Jika Anda sudah memiliki GitHub CLI terinstall.

### Langkah-langkah

#### 1. Install GitHub CLI

Download dari https://cli.github.com/ atau:

```powershell
winget install GitHub.cli
```

#### 2. Login

```powershell
gh auth login
```

Pilih:
- GitHub.com
- HTTPS
- Login with a web browser

#### 3. Pastikan `.env` tidak memiliki `COPILOT_GITHUB_TOKEN`

SDK akan otomatis mendeteksi token dari `gh` CLI.

#### 4. Jalankan backend

```powershell
npm run start:backend
```

---

## Troubleshooting

### ❌ "Not authenticated" meskipun sudah login

**Cek 1:** Pastikan `COPILOT_GITHUB_TOKEN` di `.env` di-comment/dihapus jika isinya token `ghu_` atau `ghp_`.

```env
# COPILOT_GITHUB_TOKEN=ghu_xxxxx   ← harus di-comment
```

**Cek 2:** Jalankan login ulang:

```powershell
node "node_modules\@github\copilot\index.js" login
```

### ❌ "EADDRINUSE: address already in use :::3001"

Port 3001 masih dipakai proses sebelumnya. Kill proses tersebut:

```powershell
# Cari PID yang memakai port 3001
netstat -ano | Select-String ":3001" | Select-String "LISTENING"

# Kill prosesnya (ganti <PID> dengan angka yang muncul)
taskkill /F /PID <PID>

# Atau kill semua proses node sekaligus
taskkill /F /IM node.exe
```

Tunggu 2-3 detik, lalu jalankan ulang:

```powershell
npm run start:backend
```

### ❌ Token expired setelah beberapa bulan

- **Copilot login**: Token OAuth biasanya berlaku lama, tapi bisa expired. Jalankan `copilot login` ulang.
- **Fine-grained PAT**: Sesuai durasi yang Anda set saat buat token. Buat token baru jika expired.

### ❌ Akun GitHub tidak memiliki Copilot

Pastikan akun GitHub Anda memiliki **GitHub Copilot subscription** aktif (Individual, Business, atau Enterprise). Tanpa subscription, autentikasi berhasil tapi API call akan ditolak.

---

## Ringkasan Alur Kerja

```
1. cd D:\smartsis-mcp
2. node "node_modules\@github\copilot\index.js" login
3. Buka https://github.com/login/device → masukkan kode
4. Pastikan .env TIDAK ada COPILOT_GITHUB_TOKEN yang invalid
5. npm run start:backend
6. ✅ Selesai!
```

---

## Konfigurasi `.env` yang Benar

```env
# Database MySQL
DB_HOST=100.94.238.54
DB_PORT=3310
DB_USER=sail
DB_PASSWORD=password
DB_NAME=db_smksmartsis

# Ollama AI (opsional, jika pakai Ollama mode)
OLLAMA_MODEL=gpt-oss:120b-cloud
OLLAMA_BASE_URL=http://localhost:11434

# Server
PORT=3001
MCP_PORT=3002

# Session
SESSION_SECRET=smartsis-secret-2026-openclaw

# GitHub Copilot Token
# Jika pakai 'copilot login', TIDAK perlu isi token di bawah ini.
# Hanya isi jika pakai Fine-grained PAT (github_pat_...)
# COPILOT_GITHUB_TOKEN=github_pat_xxxxxxx
```
