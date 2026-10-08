# SyzerCLI-Orca (deprecated)

Orca entegrasyonu artık **SyzerCLI'ın içinde**: https://github.com/yasinbalcik/SyzerCLI

## Kurulum

```powershell
irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1 | iex
```

Orca zaten kuruluysa betik entegrasyonu da kurar. Elle: Orca'yı kapat → `syzer orca install --shortcut` → masaüstündeki **Orca (Syzer)** kısayolundan aç.

Yama kendiliğinden yeniden uygulanır (Orca güncellendiğinde de). Geri almak için `syzer orca restore`.

Bu repo yalnızca eski `patch-orca.js` için bırakıldı.
