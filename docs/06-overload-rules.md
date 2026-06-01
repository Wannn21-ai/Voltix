# Overload Rules

Overload terjadi ketika:

```text
power >= overloadThreshold
```

`overloadThreshold` dapat diubah dari web settings atau captive portal.

## Behavior

1. Firmware mendeteksi power melewati threshold.
2. Session state masuk `OVERLOAD`.
3. Relay OFF untuk memutus beban.
4. Session difinalisasi dengan `endReason = OVERLOAD`.
5. Completed session disimpan ke LittleFS.
6. Jika online, completed session dikirim ke Firebase.

## History Fields

History overload harus mencatat:

- `overload: true`
- `endReason: OVERLOAD`
- `overloadThreshold`
- `peakPower`
- `averagePower`
- `energy`
- `cost`
- `durationSec`

## Safety Notes

- Overload protection tidak menggantikan MCB/fuse atau proteksi listrik fisik.
- Relay hanya bagian dari kontrol beban; desain wiring tetap harus aman.
- Threshold harus disesuaikan dengan rating relay, kabel, beban, dan instalasi.
