$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://127.0.0.1:8787"
$HealthUrl = "$Url/api/health"
$ExpectedRunnerVersion = "2026-05-31-git-recovery-senior"
$OutLogPath = Join-Path $Root "backend\server.out.log"
$ErrLogPath = Join-Path $Root "backend\server.err.log"

function Get-RunnerHealth {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      return $response.Content | ConvertFrom-Json
    }
  } catch {
    return $null
  }
  return $null
}

function Stop-RunnerOnPort {
  $rows = netstat -ano | Select-String "127.0.0.1:8787"
  foreach ($row in $rows) {
    if ($row -match "LISTENING\s+(\d+)$") {
      $processId = [int]$Matches[1]
      try { Stop-Process -Id $processId -Force -ErrorAction Stop } catch {}
    }
  }
}

function Test-Runner {
  $health = Get-RunnerHealth
  return $health -and $health.version -eq $ExpectedRunnerVersion
}

$currentHealth = Get-RunnerHealth
if ($currentHealth -and $currentHealth.version -ne $ExpectedRunnerVersion) {
  Stop-RunnerOnPort
  Start-Sleep -Milliseconds 800
}

if (-not (Test-Runner)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Node.js was not found on PATH. Install Node.js or start the backend manually.", "Local App Launcher") | Out-Null
    exit 1
  }

  $logDir = Split-Path -Parent $OutLogPath
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }

  Start-Process `
    -FilePath $node.Source `
    -ArgumentList @("backend\server.js") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLogPath `
    -RedirectStandardError $ErrLogPath

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (Test-Runner) { break }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $Url
