# WS Store Official Discord Bot

Bot full custom untuk server Discord **WS Store Official**.

Fitur utama:

- Verify member baru: `Unverified` -> `Verif`
- Auto role untuk customer dan tier transaksi: `1Jt+`, `5Jt+`, `10Jt+`, `20Jt+`, `50Jt+`
- Ticket order, rekber, dan support
- Tombol claim, payment QRIS, complete order, close ticket
- Invoice otomatis ke DM pembeli setelah order selesai
- Vouch / transaction otomatis ke channel `✅・success-transaction`
- Transcript ticket HTML otomatis
- Supabase database
- Supabase heartbeat harian agar database tetap aktif selama bot hidup
- Jam operasional 10.00-22.00 WIB dengan override manual sampai batas jadwal berikutnya
- Tombol layanan order mengikuti indikator masing-masing di SERVER STATS
- Setup server non-destruktif untuk kategori/channel custom owner

## 1. Setup Supabase

1. Buka project Supabase.
2. Masuk ke **SQL Editor**.
3. Jalankan isi file:

```txt
supabase/schema.sql
```

Jalankan kembali schema terbaru setelah update bot. Script bersifat idempotent, mengaktifkan Row Level Security, dan menambah index tanpa menghapus transaksi lama.

4. Ambil:
   - `Project URL`
   - `Secret key` untuk server-side
   - kalau dashboard kamu masih legacy, gunakan `service_role key`

Gunakan `Secret key` / `service_role key` hanya di server bot. Jangan upload ke GitHub publik.

## 2. Setup Discord Bot

Di Discord Developer Portal:

1. Buat Application.
2. Buat Bot.
3. Aktifkan privileged intents:
   - Server Members Intent
   - Message Content Intent
4. Copy token bot.
5. Invite bot ke server dengan permission:
   - Administrator paling mudah untuk setup awal
   - Setelah server rapi, permission bisa dipersempit

## 3. Env

Copy file:

```bash
cp .env.example .env
```

Isi `.env`:

```env
DISCORD_TOKEN=token_bot
DISCORD_CLIENT_ID=application_client_id
DISCORD_GUILD_ID=id_server

SUPABASE_URL=https://project-id.supabase.co
SUPABASE_SECRET_KEY=secret_key_supabase
# atau untuk legacy:
# SUPABASE_SERVICE_ROLE_KEY=service_role_key

OWNER_DISCORD_ID=id_owner

STORE_NAME=WS Store Official
STORE_TIMEZONE=Asia/Jakarta
STORE_TIMEZONE_LABEL=WIB
STORE_OPEN_HOUR=10
STORE_CLOSE_HOUR=22

QRIS_IMAGE_PATH=assets/qris-ws-store.png
```

## 4. Install dan Jalankan

Gunakan Node.js 22 atau lebih baru.

```bash
npm ci
npm run deploy:commands
npm start
```

Setelah bot online, buka Discord dan jalankan:

```txt
/setup-server
```

Command itu akan membuat role, kategori, channel, panel verify, panel ticket, dan panel payment QRIS.

## 5. Alur Order

1. Buyer memilih layanan order yang berstatus hijau saat gerbang Ticket Order terbuka.
2. Bot membuat channel `ticket-xxx`.
3. Admin klik `Claim Ticket`.
4. Buyer klik `Payment QRIS` atau lihat channel payment.
5. Setelah order selesai, admin klik `Order Selesai`.
6. Admin isi modal:
   - Produk
   - Nominal rupiah
   - Payment
   - Catatan
7. Bot otomatis:
   - simpan transaksi ke Supabase
   - update total belanja buyer
   - kasih role `Customer`
   - kasih tier sesuai total transaksi
   - kirim invoice ke DM buyer
   - kirim transaksi ke `✅・success-transaction`
   - simpan transcript HTML
   - tutup ticket

## 6. Jam Operasional

Default:

```txt
10.00-22.00 WIB
```

Di luar jam ini:

- gerbang ticket order dan support otomatis closed
- `/open order` dapat membuka gerbang order sementara sampai batas jadwal berikutnya
- tombol Gamepass & GIG, Payout Instant, VILOG, Via Username, dan Limited Item tetap mengikuti SERVER STATS masing-masing
- kalau ada tombol lama yang masih bisa diklik, bot tetap menolak pembuatan ticket
- ticket rekber tetap bisa dibuka, tetapi proses dibantu selagi admin / middleman sedang online

Panel ticket diperiksa otomatis setiap 1 menit dan hanya diedit ketika status berubah. Tidak perlu menjalankan `/refresh-panels` saat jadwal berganti.

Contoh perilaku override:

- `/open order` pukul 23.00 membuka order sampai pukul 10.00, lalu jadwal normal mengambil alih
- `/close order` pukul 01.00 menutup order sampai pukul 10.00, lalu order terbuka otomatis
- pada pukul 22.00 gerbang order kembali closed otomatis

## 7. Supabase Free Keep Alive

Bot menjalankan heartbeat setiap 24 jam ke tabel `bot_heartbeat`.

Penting: heartbeat hanya berjalan kalau bot hidup. Kalau bot dimatikan, VPS mati, atau hosting sleep, Supabase tidak akan menerima load harian.

## 8. Command Admin

```txt
/setup-server
/refresh-panels
/add-transaction buyer:@user amount:1000000 product:Robux payment:QRIS
/customer user:@user
/open-ticket user:@user type:order
/set-panel-text panel:price_via_login description:...
/reset-panel-text panel:price_via_login
```

`/add-transaction` berguna untuk transaksi manual di luar ticket.
`/open-ticket` berguna untuk staff membuka ticket member tertentu, termasuk di luar jam operasional.
`/set-panel-text` menyimpan teks panel market/pricelist ke Supabase, jadi perubahan harga tidak perlu edit kode.

`/refresh-panels` hanya mengedit pesan panel bot yang sudah tercatat. Command ini tidak menghapus kategori, channel, chat, ticket aktif, atau transaksi.

Untuk value update Rolimons, invite bot Rolimons official secara terpisah lalu beri role `🤖 Rolimons Bot`. Setup WS Store sudah menyiapkan permission role itu agar bisa mengirim embed di channel `value-update-realtime`.

## 9. QRIS

File QRIS sudah disimpan di:

```txt
assets/qris-ws-store.png
```

Kalau QRIS berubah, cukup ganti file tersebut dengan nama yang sama, lalu restart bot.

## 10. Deploy ke Google Cloud Run dengan CI/CD GitHub

Bot ini sudah disiapkan untuk Cloud Run:

- `Dockerfile`
- `.github/workflows/deploy-cloud-run.yml`
- `scripts/gcp-bootstrap.ps1`
- `scripts/github-publish.ps1`
- health endpoint `/healthz`

Cloud Run perlu diset dengan:

- `min-instances=1`
- `max-instances=1`
- `no-cpu-throttling`
- memory minimal `512Mi`

Ini penting karena bot Discord harus menjaga koneksi WebSocket tetap hidup.

Script `scripts/deploy-cloudrun.sh` menjalankan `npm ci`, unit test, dan pemeriksaan syntax sebelum build. Deployment dihentikan otomatis jika salah satu pemeriksaan gagal.

## Struktur Kode

```txt
src/
├── config/
│   ├── constants.js
│   └── env.js
├── controllers/
│   ├── admin-controller.js
│   ├── interaction-controller.js
│   └── ticket-controller.js
├── libs/
│   ├── database.js
│   ├── health-server.js
│   ├── store-time.js
│   └── supabase-result.js
├── middlewares/
│   └── interaction-error-handler.js
├── routes/
│   ├── deploy-commands.js
│   └── discord-event-routes.js
├── services/
│   ├── anti-spam-service.js
│   ├── discord-resource-service.js
│   ├── giveaway-service.js
│   ├── info-panel-service.js
│   ├── invite-tracker-service.js
│   ├── market-panel-service.js
│   ├── panel-registry-service.js
│   ├── server-management-service.js
│   ├── service-status-service.js
│   ├── ticket-creation-service.js
│   ├── ticket-panel-service.js
│   ├── transaction-service.js
│   ├── transcript-service.js
│   └── ui-refresh-service.js
├── app.js
└── index.js
```

- `index.js` hanya menjalankan aplikasi.
- `app.js` menyusun dependency dan lifecycle bot.
- `controllers` memetakan command, button, dan modal ke use case.
- `middlewares` menangani error sebelum respons dikirim ke Discord.
- `routes` mendaftarkan event Discord dan slash command.
- `services` berisi aturan bisnis per fitur.
- `libs` berisi adapter database, waktu, dan health server.
- `test/` berisi unit test status, routing, panel, dan concurrency ticket.

Service dengan tanggung jawab khusus:

- `bot-lifecycle-service.js`: startup task, scheduler berkala, overlap guard, dan penghentian timer.
- `core-payload-service.js`: panel verifikasi, tombol kontrol ticket, dan payload QRIS.
- `member-access-service.js`: aturan owner, staff, dan member terverifikasi.
- `customer-service.js`: akumulasi total customer dan sinkronisasi tier role.
- `giveaway-presentation-service.js`: parsing durasi, bobot entry, pemilihan winner, dan payload giveaway.

### 10.1 Buat GitHub repo

Kalau GitHub CLI sudah login:

```powershell
.\scripts\github-publish.ps1 -RepoName ws-store-official-bot -Private
```

Kalau ingin public, hapus `-Private`.

### 10.2 Bootstrap GCP

Di Google Cloud, ambil:

- `Project ID`
- `Project Number`

Lalu jalankan:

Cloud Shell / Linux:

```bash
chmod +x scripts/gcp-bootstrap.sh
./scripts/gcp-bootstrap.sh
```

Windows PowerShell:

```powershell
.\scripts\gcp-bootstrap.ps1 `
  -ProjectId "your-gcp-project-id" `
  -ProjectNumber "123456789012" `
  -GitHubOwner "github-username-kamu" `
  -GitHubRepo "ws-store-official-bot"
```

Script ini akan:

- enable API yang dibutuhkan
- buat Artifact Registry Docker repo
- buat service account deploy
- buat Secret Manager secret kosong:
  - `discord-token`
  - `supabase-secret-key`
- setup Workload Identity Federation untuk GitHub Actions

### 10.3 Isi Secret Manager

Buat file sementara di komputer kamu, misalnya:

```txt
discord-token.txt
supabase-secret-key.txt
```

Lalu upload ke Secret Manager:

```powershell
gcloud secrets versions add discord-token --data-file=discord-token.txt
gcloud secrets versions add supabase-secret-key --data-file=supabase-secret-key.txt
```

Setelah selesai, hapus file txt tersebut dari komputer kamu.

### 10.4 Isi GitHub Variables

Masuk ke repo GitHub:

`Settings` -> `Secrets and variables` -> `Actions` -> `Variables`

Tambahkan:

```txt
GCP_PROJECT_ID
GCP_REGION
CLOUD_RUN_SERVICE
ARTIFACT_REPOSITORY
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
DISCORD_CLIENT_ID
DISCORD_GUILD_ID
OWNER_DISCORD_ID
SUPABASE_URL
```

Nilainya akan dicetak oleh `scripts/gcp-bootstrap.ps1`, kecuali data Discord dan Supabase yang kamu isi sendiri.

### 10.5 Deploy otomatis

Setiap push ke branch `main`, GitHub Actions akan:

1. build Docker image
2. push ke Artifact Registry
3. deploy ke Cloud Run
4. inject secret dari Secret Manager
5. set Cloud Run supaya bot tetap hidup
