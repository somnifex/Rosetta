$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$targets = @(
  (Join-Path $root "dist"),
  (Join-Path $root "src-tauri\target"),
  (Join-Path $root "src-tauri\output")
)

foreach ($target in $targets) {
  $resolvedTarget = [System.IO.Path]::GetFullPath($target)
  if (-not $resolvedTarget.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside workspace: $resolvedTarget"
  }

  if (Test-Path -LiteralPath $resolvedTarget) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    Write-Host "Removed $resolvedTarget"
  } else {
    Write-Host "Skipped missing path $resolvedTarget"
  }
}
