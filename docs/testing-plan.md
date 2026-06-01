# Testing Plan - Voltix v0.3

Checklist ini merepresentasikan status stabil v0.3-power-loss-recovery.

| No | Test Case | Expected Result | v0.3 Status |
| --- | --- | --- | --- |
| 1 | Online START -> STOP -> history | Session selesai, LittleFS save, Firebase queue, web history tampil | Passed |
| 2 | Web settings -> Firebase -> ESP32 config applied | Tariff/overload config diterima firmware dan dipakai session berikutnya | Passed |
| 3 | Overload threshold low -> relay OFF -> history OVERLOAD | Relay OFF, endReason `OVERLOAD`, history mencatat overload | Passed |
| 4 | WiFi lost while monitoring | Monitoring tetap berjalan, relay unchanged, OLED tetap monitoring | Passed |
| 5 | WiFi returns -> reconnect and sync pending | ESP32 online, publish live, sync pending history | Passed |
| 6 | Captive portal setup -> save WiFi/config -> reconnect | WiFi/config tersimpan Preferences, reboot reconnect ke saved WiFi | Passed |
| 7 | BOOT long press -> clear WiFi -> portal appears | Saved WiFi clear, device restart, setup portal aktif saat idle | Passed |
| 8 | EN/RST during monitoring -> session resume | Checkpoint ditemukan, session resume tanpa reset duration/energy/cost | Passed |
| 9 | Power loss with load still connected -> resume | Relay/session restore aman, monitoring lanjut dari checkpoint | Passed |
| 10 | Power loss with load removed -> finalize recovery history | History dibuat dengan `LOAD_REMOVED_AFTER_POWER_LOSS`, `recovered: true` | Passed |
| 11 | OLED monitoring data visible | OLED menampilkan device, voltage/current, power, energy, cost, duration | Passed |

## Manual Regression Notes

- Test WiFi loss dengan mematikan router/hotspot, bukan dengan STOP session.
- Pastikan live log tetap `session=MONITORING relay=ON` saat offline monitoring.
- Pastikan captive portal tidak mengambil alih OLED saat session aktif.
- Pastikan `checkpoint`, `recoverystatus`, dan `wificreds` serial command tidak menampilkan password.
- Pastikan Firebase user history tetap berada di `/users/{uid}/history/{sessionId}`.
