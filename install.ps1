# SyzerCLI Orca eklentisi kurulumu (Windows PowerShell)
#   irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI-Orca/main/install.ps1 | iex
# Gerekenler: Orca (kapalı olmalı) ve SyzerCLI. SyzerCLI yoksa önce o kurulur.
$ErrorActionPreference = 'Stop'
function Fail($m) { Write-Host "HATA: $m" -ForegroundColor Red; exit 1 }

$orcaExe = Join-Path $env:LOCALAPPDATA 'Programs\orca\Orca.exe'
if (-not (Test-Path $orcaExe)) { Fail "Orca bulunamadı: $orcaExe (önce Orca'yı kur)" }
if (Get-Process -Name Orca -ErrorAction SilentlyContinue) { Fail "Orca açık. Tamamen kapatıp tekrar çalıştır." }

if (-not (Get-Command syzer -ErrorAction SilentlyContinue)) {
  Write-Host "SyzerCLI bulunamadı, kuruluyor..." -ForegroundColor Cyan
  Invoke-Expression (Invoke-RestMethod 'https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1')
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command syzer -ErrorAction SilentlyContinue)) { Fail "SyzerCLI kurulamadı. Yeni bir PowerShell açıp tekrar dene." }
}

Write-Host "Orca eklentisi kuruluyor..." -ForegroundColor Cyan
syzer orca install --shortcut
if ($LASTEXITCODE -ne 0) { Fail "Eklenti kurulamadı. 'syzer doctor' ile kontrol et." }
Write-Host ""
Write-Host "Tamam. Orca'yı masaüstündeki 'Orca (Syzer)' kısayolundan aç. Durum: syzer orca status" -ForegroundColor Green
