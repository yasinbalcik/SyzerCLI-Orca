# SyzerCLI-Orca

Orca'nın Usage panelindeki/durum çubuğundaki **Kimi** yuvasını **SyzerCLI** olarak yeniden kullanır.
Veri: `syzer usage --summary --json` → `percent_used` (tüm key'lerin kalan hakkı üzerinden %), `keys_ready/keys_total`.

```
npm install
node patch-orca.js build     # yamalı app.asar üretir (Orca açıkken güvenli)
# Orca'yı TAMAMEN kapat, sonra:
node patch-orca.js apply
node patch-orca.js restore   # geri al
```
Orca güncellenince yama silinir; `build` + `apply` tekrar çalıştırın. Çapa bulunamazsa script bilerek hata verir.
`syzer` komutu PATH'te olmalı (ya da `SYZER_BIN` ortam değişkeni).
