# Wiring

Dokumen ini adalah ringkasan wiring untuk Voltix. Sesuaikan pin final dengan firmware dan board yang dipakai.

## Main Modules

- ESP32 sebagai controller.
- PZEM004T sebagai sensor voltage/current/power.
- CT clamp PZEM untuk membaca arus.
- Relay untuk memutus/menyambung phase ke load.
- SSD1306 OLED untuk display monitoring.
- Buzzer/LED indikator jika digunakan oleh firmware.

## AC Wiring Notes

- PZEM voltage input menerima AC sesuai rating modul.
- CT clamp hanya menjepit satu kabel phase, bukan phase dan neutral bersamaan.
- Relay mengontrol phase menuju load.
- Neutral tidak diputus oleh relay kecuali desain hardware memang memakai relay yang sesuai dan aman.
- Sisi low-voltage ESP32 harus terpisah dari sisi AC.

## Safety Warning

AC voltage is dangerous. Kesalahan wiring dapat menyebabkan sengatan listrik, kebakaran, kerusakan alat, atau cedera serius.

- Matikan sumber listrik sebelum wiring.
- Gunakan enclosure dan isolasi yang layak.
- Gunakan relay, kabel, terminal, dan proteksi sesuai rating beban.
- Jika ragu, minta bantuan teknisi listrik yang kompeten.
