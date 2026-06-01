# Session Rules

## Start Rules

- Session dimulai dari command START yang dikirim web dashboard.
- Setelah START, relay ON dan state masuk `WAITING_LOAD`.
- Session baru masuk `MONITORING` setelah PZEM mendeteksi load valid.
- Jika tidak ada load valid, session tidak boleh dihitung sebagai pemakaian nyata.

## Calculation Rules

- Energy dihitung per session dari power reading selama session berjalan.
- Session energy tidak langsung memakai nilai cumulative energy dari PZEM sebagai hasil akhir.
- Cost dihitung dengan rumus:

```text
cost = sessionEnergyKwh x tariff
```

- Duration berasal dari `sessionData.durationMs`.
- Average power dan peak power dihitung dari data session aktif.

## Final Snapshot Rules

- Saat STOP, load removed, overload, atau recovery finalize, firmware membuat final snapshot.
- Final snapshot disimpan sebelum session state di-reset.
- Relay/session cleanup tidak boleh menghapus data sebelum history tersimpan.

## Local-First Rules

- LittleFS adalah local source of truth untuk completed session.
- Firebase sync dilakukan setelah local save berhasil.
- Jika WiFi offline atau Firebase gagal, session tetap tersimpan lokal sebagai pending sync.

## Recovery Rules

- Selama `WAITING_LOAD` atau `MONITORING`, firmware menyimpan checkpoint ke `/active_session.json`.
- Jika ESP32 restart saat session aktif, firmware membaca checkpoint saat boot.
- Jika load masih terdeteksi, session di-resume dengan duration, energy, cost, dan peakPower sebelumnya.
- Jika load tidak terdeteksi, firmware finalizes session sebagai `LOAD_REMOVED_AFTER_POWER_LOSS`.
- Recovered history menandai `recovered: true` dan `recoverySource: active_session_checkpoint`.
