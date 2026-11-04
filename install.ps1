# Installs Agent 自动化中台 on Windows: a clone in ~\.agent-autoloop\app, with nothing to build and nothing else to
# install, and an agent-autoloop command on the user's PATH.
#   powershell -ExecutionPolicy Bypass -File install.ps1 [--no-path] [what init takes, e.g. --agent codex]
# --no-path leaves the user's PATH as it is, for a throwaway install.
$ErrorActionPreference = 'Stop'
$KeepPath = $args -contains '--no-path'
$rest = @($args | Where-Object { $_ -ne '--no-path' })
$Repo = if ($env:AGENT_AUTOLOOP_REPO) { $env:AGENT_AUTOLOOP_REPO } else { 'https://github.com/KKKKhazix/agent-autoloop.git' }
$Root = if ($env:AGENT_AUTOLOOP_HOME) { $env:AGENT_AUTOLOOP_HOME } else { Join-Path $HOME '.agent-autoloop' }
$App = Join-Path $Root 'app'
$Program = Join-Path $App 'bin\agent-autoloop.ts'
$Bin = Join-Path $Root 'bin'
$Command = Join-Path $Bin 'agent-autoloop.cmd'
# Relative to the .cmd itself, so a name with letters outside the console's code page still works.
$Line = '@node --disable-warning=ExperimentalWarning "%~dp0..\app\bin\agent-autoloop.ts" %*'

function Need-Node($why) {
  Write-Host $why
  Write-Host '用 winget 装：winget install OpenJS.NodeJS（装好后开一个新终端），或者从 https://nodejs.org 下载 24 或更新的版本。'
  Write-Host '装好后再运行一遍这个安装命令。'
  exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host '需要 git：winget install Git.Git'; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Need-Node '需要 Node.js 24 或更新，这台电脑上没找到。' }
& node -e 'process.exit(parseInt(process.versions.node) >= 24 ? 0 : 1)'
if ($LASTEXITCODE -ne 0) { Need-Node "需要 Node.js 24 或更新，现在是 $(node -v)。" }

New-Item -ItemType Directory -Force $Root | Out-Null
if (Test-Path (Join-Path $App '.git')) { git -C $App pull --ff-only --quiet } else { git clone --quiet --depth 1 -- $Repo $App }
if ($LASTEXITCODE -ne 0) { Write-Host '下载失败。'; exit 1 }

# An agent-autoloop.cmd that isn't this one is someone else's to keep.
New-Item -ItemType Directory -Force $Bin | Out-Null
$ours = -not (Test-Path $Command) -or ((Get-Content -Raw $Command).Trim() -eq $Line)
if ($ours) {
  [IO.File]::WriteAllText($Command, "$Line`r`n", [Text.Encoding]::ASCII)
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $KeepPath -and -not (($userPath -split ';') -contains $Bin)) {
    [Environment]::SetEnvironmentVariable('Path', (@($userPath, $Bin) | Where-Object { $_ }) -join ';', 'User')
  }
  if (-not (($env:Path -split ';') -contains $Bin)) { $env:Path = "$env:Path;$Bin" }
}

if (Test-Path (Join-Path $Root 'config.json')) {
  Write-Host '更新好了。'
  if ($rest -notcontains '--no-service') { & node --disable-warning=ExperimentalWarning $Program service install }
} else {
  & node --disable-warning=ExperimentalWarning $Program init @rest
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$found = Get-Command agent-autoloop -ErrorAction SilentlyContinue
if (-not $ours -or -not $found -or $found.Source -ne $Command) {
  Write-Host ''
  Write-Host "直接打 agent-autoloop 运行不了这个程序：$Command 已经是别的程序，或者 PATH 上排在前面的是另一个同名程序。"
  Write-Host "要写完整的命令：node --disable-warning=ExperimentalWarning `"$Program`""
} else {
  Write-Host '新开的终端里就能直接打 agent-autoloop 了。'
}
