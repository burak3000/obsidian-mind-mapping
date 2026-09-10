<#
.SYNOPSIS
Installs an already-downloaded mindmap-view release into an Obsidian vault,
restarting Obsidian against that vault.

Unlike deploy.ps1 (which builds the plugin from the current source tree),
this script installs a release you already have on disk — e.g. downloaded
from a GitHub Release (see .github/workflows/release.yml) — possibly onto a
machine that doesn't even have this repo checked out.

macOS/Linux equivalent: scripts/install-release.sh — keep both in sync if
the install steps change.

.PARAMETER VaultDir
Required. Path to the target Obsidian vault folder. Quote paths containing
spaces.

.PARAMETER Source
Optional. Defaults to the current directory. Accepts three forms,
auto-detected:
  - a .zip file, auto-extracted with Expand-Archive (temp dir cleaned up
    afterward)
  - a folder containing a mindmap-view\ subfolder
  - the extracted mindmap-view\ folder itself, i.e. Source directly
    contains main.js, manifest.json and styles.css
If both the nested and flat forms are present, the nested mindmap-view\
subfolder wins.

.EXAMPLE
scripts/install-release.ps1 -VaultDir "D:\Vaults\Tiyatro"

.EXAMPLE
scripts/install-release.ps1 -VaultDir "D:\Vaults\Tiyatro" -Source "C:\Users\me\Downloads\mindmap-view-v0.0.2.zip"

.EXAMPLE
scripts/install-release.ps1 -VaultDir "D:\Vaults\Tiyatro" -Source "C:\Users\me\Downloads\mindmap-view-v0.0.2"
#>
param(
	[Parameter(Mandatory = $true)]
	[ValidateNotNullOrEmpty()]
	[string]$VaultDir,

	[string]$Source = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$PluginId = "mindmap-view"

Write-Host "==> Checking vault: $VaultDir"
if (-not (Test-Path -LiteralPath $VaultDir -PathType Container)) {
	throw "VaultDir does not exist: $VaultDir"
}

$ObsidianDir = Join-Path $VaultDir ".obsidian"
if (-not (Test-Path -LiteralPath $ObsidianDir -PathType Container)) {
	Write-Warning "$ObsidianDir not found -- this may not be an Obsidian vault. Continuing anyway."
}

$PluginDir = Join-Path (Join-Path $ObsidianDir "plugins") $PluginId

$TempDir = $null
try {
	# --- Resolve Source: .zip / nested folder / flat folder -----------------
	if ($Source.ToLowerInvariant().EndsWith(".zip")) {
		if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
			throw "Zip file not found: $Source"
		}
		$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("mindmap-view-install-" + [System.Guid]::NewGuid().ToString("N"))
		New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
		Write-Host "==> Extracting $Source"
		Expand-Archive -LiteralPath $Source -DestinationPath $TempDir -Force
		$Source = $TempDir
	}

	if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
		throw "Source not found: $Source"
	}

	# Nested form (Source\mindmap-view\...) wins if both forms look present.
	$NestedDir = Join-Path $Source $PluginId
	$FlatMainJs = Join-Path $Source "main.js"
	if (Test-Path -LiteralPath $NestedDir -PathType Container) {
		$ReleaseDir = $NestedDir
	} elseif (Test-Path -LiteralPath $FlatMainJs -PathType Leaf) {
		$ReleaseDir = $Source
	} else {
		throw "Could not find a $PluginId release under $Source. Looked for: $NestedDir (nested form) and $FlatMainJs (flat form)"
	}

	# --- Validate release contents -------------------------------------------
	$RequiredFiles = @("main.js", "manifest.json", "styles.css")
	$Missing = @()
	foreach ($f in $RequiredFiles) {
		$candidate = Join-Path $ReleaseDir $f
		if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
			$Missing += $f
		}
	}

	if ($Missing.Count -gt 0) {
		throw "Incomplete release source at $ReleaseDir -- missing: $($Missing -join ', ')"
	}

	# --- Version info (Get-Content | ConvertFrom-Json -- built-in, no extra
	# dependency, same class of thing as Expand-Archive) -----------------------
	$NewManifestPath = Join-Path $ReleaseDir "manifest.json"
	$NewVersion = (Get-Content -LiteralPath $NewManifestPath -Raw | ConvertFrom-Json).version

	$OldManifestPath = Join-Path $PluginDir "manifest.json"
	if (Test-Path -LiteralPath $OldManifestPath -PathType Leaf) {
		$OldVersion = (Get-Content -LiteralPath $OldManifestPath -Raw | ConvertFrom-Json).version
		Write-Host "==> Replacing installed $PluginId $OldVersion -> $NewVersion"
	} else {
		Write-Host "==> Installing $PluginId $NewVersion"
	}

	# --- Closing Obsidian (if running) ----------------------------------------
	Write-Host "==> Closing Obsidian (if running)"
	Get-Process -Name "Obsidian" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
	Start-Sleep -Milliseconds 500

	# --- Copying plugin files ---------------------------------------------------
	Write-Host "==> Copying plugin files to $PluginDir"
	New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
	Copy-Item -Path `
		(Join-Path $ReleaseDir "main.js"), `
		(Join-Path $ReleaseDir "manifest.json"), `
		(Join-Path $ReleaseDir "styles.css") `
		-Destination $PluginDir -Force

	Write-Host "==> Opening Obsidian with vault: $VaultDir"
	# obsidian://open?path= adds/opens the vault at this absolute path directly,
	# without needing it pre-registered under a specific vault name.
	$encodedPath = [uri]::EscapeDataString($VaultDir)
	Start-Process "obsidian://open?path=$encodedPath"

	Write-Host "==> Done"
} finally {
	if ($TempDir -and (Test-Path -LiteralPath $TempDir)) {
		Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
	}
}
