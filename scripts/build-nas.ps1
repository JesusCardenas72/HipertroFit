# Builds the api + web images on this PC and packs them into one .tar for a NAS that is too
# small to build them itself (npm install + vite build need far more RAM than running them).
# On the NAS: docker load -i hipertrofit-images.tar && docker compose up -d
#
#   .\scripts\build-nas.ps1                                  # → dist-nas\hipertrofit-images.tar
#   .\scripts\build-nas.ps1 -Dest \\NAS\Container\hipertrofit  # also copies it to the NAS share
#   .\scripts\build-nas.ps1 -Platform linux/arm64            # ARM64 NAS (default: Intel/AMD)
param(
  [string]$Platform = 'linux/amd64',
  [string]$Dest = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running - start Docker Desktop and try again.' }

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed" }
}

Write-Host "Building hipertrofit-api:local ($Platform)..."
Invoke-Docker buildx build --platform $Platform -t hipertrofit-api:local --load ./api
Write-Host "Building hipertrofit-web:local ($Platform)..."
Invoke-Docker buildx build --platform $Platform -t hipertrofit-web:local -f web/Dockerfile --load .

$out = Join-Path $root 'dist-nas'
New-Item -ItemType Directory -Force $out | Out-Null
$tar = Join-Path $out 'hipertrofit-images.tar'
Write-Host "Saving $tar..."
Invoke-Docker save hipertrofit-api:local hipertrofit-web:local -o $tar

if ($Dest) {
  Write-Host "Copying to $Dest..."
  Copy-Item $tar -Destination $Dest -Force
}
$mb = [math]::Round((Get-Item $tar).Length / 1MB)
Write-Host "Done ($mb MB). On the NAS:"
Write-Host '  cd /share/Container/hipertrofit && docker load -i hipertrofit-images.tar && docker compose up -d'
