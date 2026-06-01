# State Machine

Voltix memakai dua kelompok state: system mode dan session state.

## System Mode

- `BOOT`: firmware baru mulai, init state/config/peripheral.
- `ONLINE`: WiFi terhubung dan Firebase dapat digunakan untuk live/config/command/sync.
- `OFFLINE`: WiFi tidak tersedia, tetapi monitoring dan local save tetap berjalan.
- `TRANSITION`: firmware sedang mencoba koneksi atau berpindah status jaringan.
- `SETUP`: captive portal aktif untuk konfigurasi WiFi dan basic config.

## Session State

- `IDLE`: tidak ada sesi aktif.
- `WAITING_LOAD`: START diterima, relay ON, firmware menunggu load valid dari PZEM.
- `MONITORING`: load valid, energi/durasi/biaya sedang dihitung.
- `OVERLOAD`: daya mencapai atau melewati threshold; relay harus OFF dan session difinalisasi.
- `FINISHING`: firmware sedang membuat final snapshot dan menyimpan history.
- `FINISHED`: session selesai dan final data sudah tersedia.

## Transition Summary

```text
BOOT -> ONLINE
BOOT -> OFFLINE
BOOT -> SETUP

IDLE -> WAITING_LOAD
WAITING_LOAD -> MONITORING
WAITING_LOAD -> FINISHING
MONITORING -> OVERLOAD
MONITORING -> FINISHING
OVERLOAD -> FINISHING
FINISHING -> FINISHED
FINISHED -> IDLE / next session
```

## Important Rules

- WiFi loss does not stop `MONITORING`.
- Captive portal must not take over while `WAITING_LOAD`, `MONITORING`, relay ON, or recovery is active.
- OLED prioritizes active monitoring display over setup portal display.
- Recovery can restore session state from `/active_session.json` after restart.
