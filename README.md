# SyzerCLI-Orca

> **Taşındı / Moved:** Orca entegrasyonu artık [SyzerCLI](https://github.com/yasinbalcik/SyzerCLI) içinde, `syzer orca` komutuyla gelir. Bu repo yalnızca eski `patch-orca.js` için arşiv olarak duruyor.

## Bu ne işe yarar?

[Orca](https://github.com/stablyai/orca) (ajan odaklı terminal/çalışma alanı uygulaması) içinde **SyzerCLI'ı birinci sınıf bir ajan** olarak gösterir:

- **Ajan menüsü:** "Yeni terminal" menüsünde Syzer (S logosu).
- **Canlı durum:** Kenar çubuğunda çalışıyor / bekliyor / bitti durumu ve çalışan alt ajan listesi.
- **Oturum geçmişi:** Syzer oturumları geçmiş panelinde; kartta alt ajan listesi, Resume = `syzer --resume <id>`.
- **Kullanım göstergesi:** Durum çubuğunda Syzer sağlayıcısı (yüzde, key sayısı, kalan hak) ve Ayarlar → Stats & Usage'da Syzer filtresi.
- **Key yöneticisi:** Ayarlar → AI Provider Accounts içinde Syzer key'lerini listele, aktif seç, sil, çoklu ekle.
- **Yeniden açılışta geri yükleme:** Orca'yı kapatıp açınca Syzer sekmesi önceki konuşmayla geri gelir.
- **Orca işçileri:** Syzer, görevleri ayrı Orca terminallerinde bağımsız Syzer'lar olarak çalıştırabilir (`spawn_syzer`).

## Kurulum (Windows)

```powershell
irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1 | iex
```

Betik SyzerCLI'ı kurar; Orca varsa entegrasyonu da kurar. Elle:

1. Orca'yı **tamamen kapat**.
2. `syzer orca install --shortcut`
3. Masaüstündeki **Orca (Syzer)** kısayolundan aç. Kısayol her açılışta yamayı kontrol eder.

## Nasıl çalışır?

Yama Orca'nın `app.asar` dosyasına uygulanır; orijinal `app.asar.syzer-orig` olarak yedeklenir. Orca güncellenip yama silinirse zamanlanmış görev (10 dakikada bir + oturum açılışında) Orca **kapalıyken** yamayı yeniden uygular. Yama gruplara ayrılmıştır: Orca'nın yeni sürümünde uyumsuz bir grup atlanır, diğerleri uygulanır; yarım yama bırakılmaz.

| Komut | Açıklama |
|---|---|
| `syzer orca status` | yama durumu (sürüm, uygulanmış mı, Orca çalışıyor mu) |
| `syzer orca patch` | yamayı şimdi uygula (Orca kapalıyken) |
| `syzer orca restore` | orijinal Orca'ya dön |
| `syzer orca uninstall` | zamanlanmış görevi ve kısayolu kaldır |

Günlük: `~/.syzercli/orca/patch.log`.

> Bu bir topluluk yamasıdır, Orca ekibiyle bağlantısı yoktur. Yalnızca Windows ve Orca 1.4.x üzerinde denenmiştir.
