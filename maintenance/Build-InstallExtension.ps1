param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PlaywrightMCP'),
    [int]$ForkRevision = 2
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $repo 'packages\extension'
$target = Join-Path $InstallRoot 'extension-repaired'
if (!(Test-Path -LiteralPath (Join-Path $repo 'node_modules\vite'))) { throw 'Install the build dependencies documented in FORK.md first.' }
Push-Location $repo
try {
    & node --test packages/extension/fork-tests/repairs.test.cjs
    if ($LASTEXITCODE) { throw 'Regression tests failed; nothing installed.' }
    $commit = (& git rev-parse HEAD).Trim()
    $dirty = [bool](& git status --porcelain --untracked-files=no)
} finally { Pop-Location }
Push-Location $extension
try {
    & node --input-type=module -e 'import {createBuilder} from "vite"; const b=await createBuilder({configFile:"vite.config.mts"}); await b.buildApp();'
    if ($LASTEXITCODE) { throw 'Extension build failed; nothing installed.' }
} finally { Pop-Location }
$dist = Join-Path $extension 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
$upstreamVersion = $manifest.version
$manifest.version = "$upstreamVersion.$ForkRevision"
$manifest.name = 'Playwright Extension (eyeseet fork)'
if (Test-Path -LiteralPath (Join-Path $target 'manifest.json')) {
    $existing = Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json
    if ($existing.key -ne $manifest.key) { throw 'Extension identity differs; nothing installed.' }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dist 'manifest.json') -Encoding UTF8
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath $dist | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force }
$files = @(Get-ChildItem -LiteralPath $dist -Recurse -File)
foreach ($file in $files) {
    $relative = $file.FullName.Substring($dist.Length + 1)
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $target $relative)).Hash) { throw "Copy verification failed: $relative" }
}
@{ repository='https://github.com/eyeseet/playwright-extension'; commit=$commit; sourceTreeDirty=$dirty; sourceDirectory=$repo; upstreamVersion=$upstreamVersion; version=$manifest.version; installed=(Get-Date -Format o); filesVerified=$files.Count } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'fork-build.json') -Encoding UTF8
Write-Output "Installed and verified $($manifest.version). Reload the unpacked extension to activate it."

