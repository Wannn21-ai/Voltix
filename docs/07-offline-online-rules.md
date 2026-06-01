# Offline And Online Rules

Voltix harus tetap aman dan stabil saat WiFi hilang.

## During WiFi Loss

- WiFi loss tidak menghentikan monitoring.
- Relay tetap mengikuti state session, bukan state WiFi.
- OLED tetap menampilkan data monitoring.
- Session tetap menghitung duration, energy, cost, averagePower, dan peakPower.
- Completed history tetap disimpan ke LittleFS.
- Firebase sync ditunda sampai WiFi kembali.

## Reconnect

Saat WiFi kembali:

1. Firmware set system mode ke `ONLINE`.
2. NTP sync dijalankan jika perlu.
3. Firebase config dibaca ulang.
4. Live data dipublish segera.
5. Pending history disync ke Firebase.

Reconnect tidak boleh reset duration, energy, cost, atau sessionId.

## Captive Portal Rules

Captive portal boleh start hanya saat device idle atau setup:

- boot tanpa saved WiFi;
- boot saat saved WiFi dan fallback gagal, selama tidak ada active session/checkpoint recovery;
- setelah BOOT/GPIO0 long press 5 detik setelah boot complete;
- setelah command `clearwifi`.

Captive portal harus suppressed saat:

- `WAITING_LOAD`;
- `MONITORING`;
- relay ON untuk active load;
- recovery sedang memproses checkpoint.

Jika WiFi hilang saat monitoring, firmware hanya retry reconnect di background dan tetap `OFFLINE`.

## Pending Sync

- Pending sync adalah status cloud sync, bukan alasan menghapus local history.
- Local history tetap disimpan.
- Saat online kembali, pending session dikirim ke `/devices/{deviceId}/completedSessions/{sessionId}`.
