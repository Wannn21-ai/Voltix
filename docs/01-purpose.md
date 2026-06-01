# Purpose

Voltix dirancang untuk membantu user memahami konsumsi listrik per perangkat atau beban. Sistem ini menjawab pertanyaan praktis:

- Perangkat apa yang sedang memakai energi?
- Berapa lama perangkat berjalan?
- Berapa energi yang dipakai selama sesi?
- Berapa estimasi biaya pemakaian?
- Apakah beban berisiko overload atau membuat listrik trip?

Voltix menggabungkan ESP32, sensor PZEM004T, relay, OLED, Firebase, dan web dashboard agar monitoring bisa dilakukan secara langsung, tetap berjalan saat offline, dan tetap menyimpan riwayat sesi secara lokal sebelum sync ke cloud.

Target utama Voltix adalah monitoring per-load, bukan sekadar membaca total energi dari meter. Setiap sesi START/STOP menghasilkan data durasi, energi, biaya, daya rata-rata, daya puncak, dan status akhir sesi.
