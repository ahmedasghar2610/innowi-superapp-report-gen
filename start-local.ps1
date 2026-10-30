# Start the Super App locally: Postgres, the API on 3000, the web app on 3001.
#
#   .\start-local.ps1              start whatever is not already running
#   .\start-local.ps1 -Windows     same, but the API and web each get a visible console
#   .\start-local.ps1 -Status      report what is up, start nothing
#   .\start-local.ps1 -Stop        stop the web app, the API and Postgres
#   .\start-local.ps1 -Logs        follow the API and web logs
#   .\start-local.ps1 -NoBrowser   start, but do not open the browser
#
# Safe to run twice: anything already listening is left alone. Local development only
# (Postgres listens on 127.0.0.1 and the API runs with NODE_ENV=development).

[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Stop,
    [switch]$Logs,
    [switch]$Windows,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$Repo    = $PSScriptRoot
$ApiDir  = Join-Path $Repo 'api'
$WebDir  = Join-Path $Repo 'web'
$LogDir  = Join-Path $Repo '.local-logs'
$PgRoot  = Join-Path $env:LOCALAPPDATA 'pgsql16'
$PgData  = Join-Path $PgRoot 'data'
$PgLog   = Join-Path $PgRoot 'server.log'
$PgCtl   = Join-Path $PgRoot 'bin\pg_ctl.exe'
$Python  = Join-Path $ApiDir 'venv\Scripts\python.exe'
$NodeDir = 'C:\Program Files\nodejs'
$ApiOut  = Join-Path $LogDir 'api.log'
$ApiErr  = Join-Path $LogDir 'api.err.log'
$WebOut  = Join-Path $LogDir 'web.log'
$WebErr  = Join-Path $LogDir 'web.err.log'

function Test-Port([int]$Port) {
    $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-Port([int]$Port, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while (-not (Test-Port $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
    return (Test-Port $Port)
}

function Write-Step([string]$Text) { Write-Host "  $Text" }

function Show-Status {
    Write-Host ''
    Write-Host '  Service     Port   State' -ForegroundColor Cyan
    Write-Host '  ---------   -----  -----'
    foreach ($s in @(
        @{ n = 'Postgres'; p = 5432 },
        @{ n = 'API'; p = 3000 },
        @{ n = 'Web'; p = 3001 })) {
        if (Test-Port $s.p) { $state = 'up'; $colour = 'Green' } else { $state = 'down'; $colour = 'DarkGray' }
        Write-Host ("  {0,-10} {1,-6} {2}" -f $s.n, $s.p, $state) -ForegroundColor $colour
    }
    Write-Host ''
}

# ---------------------------------------------------------------- logs ----
if ($Logs) {
    if (-not (Test-Path $ApiOut) -and -not (Test-Path $WebOut)) {
        Write-Host "No logs yet in $LogDir (the -Windows mode prints to its own consoles instead)." -ForegroundColor Yellow
        return
    }
    Write-Host "Following $LogDir (Ctrl+C to stop)" -ForegroundColor Cyan
    Get-Content $ApiOut, $ApiErr, $WebOut, $WebErr -Tail 20 -Wait -ErrorAction SilentlyContinue
    return
}

# ---------------------------------------------------------------- stop ----
if ($Stop) {
    Write-Host 'Stopping the Super App...' -ForegroundColor Yellow
    foreach ($p in 3001, 3000) {
        $conns = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
        if ($conns.Count -eq 0) {
            Write-Step "nothing was listening on port $p"
            continue
        }
        foreach ($c in $conns) {
            try {
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop
                Write-Step "stopped port $p (PID $($c.OwningProcess))"
            } catch {
                Write-Step "could not stop PID $($c.OwningProcess) on port ${p}: $($_.Exception.Message)"
            }
        }
    }
    # The web dev server spawns child node processes; clear any that survive.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*next*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Test-Path $PgCtl) {
        Start-Process -FilePath $PgCtl -ArgumentList @('-D', $PgData, '-m', 'fast', 'stop') -NoNewWindow -Wait -ErrorAction SilentlyContinue
        if (Test-Port 5432) { Write-Step 'Postgres is still up' } else { Write-Step 'stopped Postgres' }
    }
    Show-Status
    return
}

# -------------------------------------------------------------- status ----
if ($Status) { Show-Status; return }

# --------------------------------------------------------------- start ----
Write-Host ''
Write-Host 'Starting the Super App (Postgres 5432, API 3000, web 3001)' -ForegroundColor Cyan

$missing = @()
if (-not (Test-Path $PgCtl))  { $missing += "Postgres binaries at $PgRoot" }
if (-not (Test-Path $Python)) { $missing += "the API venv at $ApiDir\venv  (python -m venv venv; .\venv\Scripts\python.exe -m pip install -r requirements-dev.txt)" }
if (-not (Test-Path (Join-Path $ApiDir '.env'))) { $missing += "$ApiDir\.env  (copy .env.example and fill in the secrets)" }
if (-not (Test-Path (Join-Path $WebDir 'node_modules'))) { $missing += "$WebDir\node_modules  (npm install)" }
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host 'Cannot start. Missing:' -ForegroundColor Red
    foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Red }
    Write-Host ''
    exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$env:Path = "$NodeDir;$env:Path"
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

# 1. Postgres. pg_ctl keeps its stdout open while the server runs, so its output is
#    never piped back into this shell — that would hang the script. -l sends the
#    server's own log to a file and Start-Process gives it no pipe to hold.
if (Test-Port 5432) {
    Write-Step 'Postgres already up on 5432'
} else {
    Write-Step 'starting Postgres...'
    Start-Process -FilePath $PgCtl `
        -ArgumentList @('-D', $PgData, '-l', $PgLog, '-o', '-p 5432 -c listen_addresses=127.0.0.1', 'start') `
        -NoNewWindow
    if (Wait-Port 5432 40) {
        Write-Step 'Postgres is up'
    } else {
        Write-Host "  Postgres did not come up. See $PgLog" -ForegroundColor Red
        exit 1
    }
}

# 2. API
if (Test-Port 3000) {
    Write-Step 'API already up on 3000'
} else {
    if ($Windows) {
        Write-Step 'starting the API in its own window...'
        Start-Process -FilePath 'powershell.exe' -WorkingDirectory $ApiDir -ArgumentList @(
            '-NoExit', '-Command',
            "`$host.UI.RawUI.WindowTitle = 'Super App API :3000'; & '$Python' -m uvicorn app.main:app --host 127.0.0.1 --port 3000"
        ) | Out-Null
    } else {
        Write-Step 'starting the API...'
        Start-Process -FilePath $Python -WorkingDirectory $ApiDir `
            -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '3000') `
            -RedirectStandardOutput $ApiOut -RedirectStandardError $ApiErr -WindowStyle Hidden | Out-Null
    }
    if (Wait-Port 3000 90) { Write-Step 'API is up' } else { Write-Step "API did not answer in time; see $ApiErr" }
}

# 3. Web
if (Test-Port 3001) {
    Write-Step 'web app already up on 3001'
} else {
    if ($Windows) {
        Write-Step 'starting the web app in its own window (first compile takes ~20 s)...'
        Start-Process -FilePath 'powershell.exe' -WorkingDirectory $WebDir -ArgumentList @(
            '-NoExit', '-Command',
            "`$host.UI.RawUI.WindowTitle = 'Super App web :3001'; `$env:Path = '$NodeDir;' + `$env:Path; `$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'; npm run dev"
        ) | Out-Null
    } else {
        Write-Step 'starting the web app (first compile takes ~20 s)...'
        Start-Process -FilePath 'cmd.exe' -WorkingDirectory $WebDir `
            -ArgumentList @('/c', "`"$NodeDir\npm.cmd`" run dev") `
            -RedirectStandardOutput $WebOut -RedirectStandardError $WebErr -WindowStyle Hidden | Out-Null
    }
    if (Wait-Port 3001 180) { Write-Step 'web app is up' } else { Write-Step "web app did not answer in time; see $WebErr" }
}

Show-Status
Write-Host '  Web app      http://localhost:3001/login' -ForegroundColor Green
Write-Host '  Reports      http://localhost:3001/report-gen' -ForegroundColor Green
Write-Host '  API docs     http://localhost:3000/api/docs' -ForegroundColor Green
Write-Host ''
Write-Host "  Sign in with SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD from api\.env" -ForegroundColor DarkGray
if (-not $Windows) { Write-Host "  Logs         .\start-local.ps1 -Logs   ($LogDir)" -ForegroundColor DarkGray }
Write-Host '  Stop         .\start-local.ps1 -Stop' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) { Start-Process 'http://localhost:3001/report-gen' | Out-Null }
