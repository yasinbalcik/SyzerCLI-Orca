# SyzerCLI-Orca

**Türkçe** · [English](README.en.md)

[SyzerCLI](https://github.com/yasinbalcik/SyzerCLI) için **Orca eklentisi**. [Orca](https://github.com/stablyai/orca) (ajan odaklı terminal/çalışma alanı uygulaması) içinde SyzerCLI'ı birinci sınıf bir ajan olarak gösterir. SyzerCLI ayrı bir projedir ve ayrı kurulur; bu repo yalnızca Orca tarafını içerir.

## Ne yapar?

- **Ajan menüsü:** "Yeni terminal" menüsünde Syzer (S logosu).
- **Canlı durum:** Kenar çubuğunda çalışıyor / bekliyor / bitti durumu ve çalışan alt ajan listesi.
- **Oturum geçmişi:** Syzer oturumları geçmiş panelinde; kartta alt ajan listesi, Resume = `syzer --resume <id>`.
- **Kullanım göstergesi:** Durum çubuğunda Syzer sağlayıcısı (yüzde, key sayısı, kalan hak); Ayarlar → Stats & Usage'da Syzer filtresi.
- **Key yöneticisi:** Ayarlar → AI Provider Accounts içinde Syzer key'lerini listele, aktif seç, sil, çoklu ekle.
- **Yeniden açılışta geri yükleme:** Orca'yı kapatıp açınca Syzer sekmesi önceki konuşmayla geri gelir.
- **Kapanışta kabukları kapatır:** Orca terminalleri bilerek arka plandaki bir daemon'da yaşatır; bu yüzden kapatınca `pwsh`/`claude` süreçleri birikir. Eklenti, Orca normal yoldan kapanırken (pencere **X** veya tepsi → **Quit**) açık tüm terminal oturumlarını kapatır. Görev yöneticisinden zorla kapatırsan hiçbir yama çalışamaz. Kapatmak için `syzer orca config killShellsOnQuit off`.

## Kurulum (Windows)

Gerekenler: Orca ve [SyzerCLI](https://github.com/yasinbalcik/SyzerCLI) (yoksa betik kurar).

```powershell
irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI-Orca/main/install.ps1 | iex
```

Elle: Orca'yı tamamen kapat → `syzer orca install --shortcut` → masaüstündeki **Orca (Syzer)** kısayolundan aç. `syzer orca ...` komutu eklentiyi bu repodaki son sürümden indirir ve çalıştırır; ayrıca bir şey kurman gerekmez.

## Nasıl çalışır?

Yama Orca'nın `app.asar` dosyasına uygulanır; orijinal `app.asar.syzer-orig` olarak yedeklenir. Orca güncellenip yama silinirse zamanlanmış görev (10 dakikada bir + oturum açılışında) Orca **kapalıyken** yamayı yeniden uygular. Yama gruplara ayrılmıştır: Orca'nın yeni sürümünde uyumsuz bir grup atlanır, diğerleri uygulanır; yarım yama bırakılmaz. Yama kaynağı değişince işaret kendiliğinden değişir, bayat yama kalmaz.

| Komut | Açıklama |
|---|---|
| `syzer orca status` | yama durumu (sürüm, uygulanan/atlanan gruplar) |
| `syzer orca patch [--dry-run]` | yamayı şimdi uygula (Orca kapalıyken) |
| `syzer orca restore` | orijinal Orca'ya dön |
| `syzer orca uninstall` | zamanlanmış görevi ve kısayolu kaldır |
| `syzer orca skip grup,grup` | hata ayıklama: bazı grupları atla (argümansız: hepsi açık) |
| `syzer orca config killShellsOnQuit on\|off` | kapanışta terminalleri kapat |
| `syzer orca update` | eklentinin son sürümünü indir |

Doğrudan da çalışır: `node bin/syzer-orca.js <komut>`. Günlükler: `~/.syzercli/orca/patch.log`, `quit.log`.

> Bu bir topluluk yamasıdır, Orca ekibiyle bağlantısı yoktur. Windows'ta ve Orca 1.4.x üzerinde denenmiştir.

## Geliştirme

```
npm test        # node:test, bağımlılık yok
npm run pack    # dist/syzer-orca-<ver>.tar.gz
```

`v*` etiketi atınca GitHub Actions testleri çalıştırır ve release'i (tarball + `SHA256SUMS.txt`) yayınlar. Eski tek dosyalı araç `legacy/patch-orca.js` altında duruyor.

Lisans: MIT
