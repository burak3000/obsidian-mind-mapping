<#
.SYNOPSIS
Builds the plugin from the latest code and deploys it to the Tiyatro
Obsidian vault (default), restarting Obsidian against that vault.

macOS/Linux equivalent: scripts/deploy.sh — keep both in sync if the deploy
steps change.

.PARAMETER VaultDir
Optional. Overrides the default target vault folder. If omitted, defaults to
the Tiyatro vault under this machine's iCloud Drive folder
(<user profile>\iCloudDrive\iCloud~md~obsidian\Documents\Tiyatro) — the same
vault the macOS script targets by default, assuming iCloud for Windows is
installed at its standard location. Pass an explicit path if your vault
lives elsewhere.

.EXAMPLE
scripts/deploy.ps1
scripts/deploy.ps1 "D:\Vaults\Tiyatro"
#>
param(
	[string]$VaultDir = (Join-Path $env:USERPROFILE "iCloudDrive\iCloud~md~obsidian\Documents\Tiyatro")
)

$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $PSScriptRoot
$PluginId = "mindmap-view"
$PluginDir = Join-Path $VaultDir ".obsidian\plugins\$PluginId"

Write-Host "==> Building plugin from $RepoDir"
Push-Location $RepoDir
try {
	npm run build
	if ($LASTEXITCODE -ne 0) {
		throw "npm run build failed with exit code $LASTEXITCODE"
	}
} finally {
	Pop-Location
}

Write-Host "==> Closing Obsidian (if running)"
Get-Process -Name "Obsidian" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Write-Host "==> Copying plugin files to $PluginDir"
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Copy-Item -Path `
	(Join-Path $RepoDir "dist\main.js"), `
	(Join-Path $RepoDir "dist\manifest.json"), `
	(Join-Path $RepoDir "dist\styles.css") `
	-Destination $PluginDir -Force

Write-Host "==> Opening Obsidian with vault: $VaultDir"
# obsidian://open?path= adds/opens the vault at this absolute path directly,
# without needing it pre-registered under a specific vault name.
$encodedPath = [uri]::EscapeDataString($VaultDir)
Start-Process "obsidian://open?path=$encodedPath"

Write-Host "==> Done"
