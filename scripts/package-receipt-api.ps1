[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoPrefix = $repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$outputRoot = Join-Path $repoRoot 'artifacts\receipt-api'
$contentsRoot = Join-Path $outputRoot 'contents'
$serverRoot = Join-Path $contentsRoot 'server'
$archivePath = Join-Path $outputRoot 'receipt-api.zip'

function Assert-RepositoryPath([string] $Path) {
    $absolutePath = [System.IO.Path]::GetFullPath($Path)
    if (-not $absolutePath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Packaging path must stay inside the repository: $absolutePath"
    }
    # Refuse junctions and symbolic links that could redirect reads or writes.
    $currentPath = $absolutePath
    while ($currentPath -ne $repoRoot) {
        if (Test-Path -LiteralPath $currentPath) {
            $item = Get-Item -LiteralPath $currentPath -Force
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Packaging paths cannot contain symbolic links or junctions: $currentPath"
            }
        }
        $currentPath = [System.IO.Path]::GetDirectoryName($currentPath)
    }
}

$sourceFiles = @('index.ts', 'receiptApi.ts')
$packagePath = Join-Path $contentsRoot 'package.json'
$allowedPaths = @($serverRoot, $packagePath) + @($sourceFiles | ForEach-Object { Join-Path $serverRoot $_ })
foreach ($path in @($outputRoot, $contentsRoot, $archivePath) + $allowedPaths) {
    Assert-RepositoryPath $path
}
foreach ($filename in $sourceFiles) {
    $sourcePath = Join-Path $repoRoot "server\$filename"
    Assert-RepositoryPath $sourcePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required receipt API source file is missing: $sourcePath"
    }
}

if (Test-Path -LiteralPath $contentsRoot) {
    # Do not silently include or delete unrelated files from an earlier output.
    foreach ($item in Get-ChildItem -LiteralPath $contentsRoot -Force -Recurse) {
        if ($item.FullName -notin $allowedPaths) {
            throw "Unexpected file in the package contents; move it before packaging: $($item.FullName)"
        }
        Assert-RepositoryPath $item.FullName
    }
}

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null
foreach ($filename in $sourceFiles) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "server\$filename") -Destination (Join-Path $serverRoot $filename) -Force
}

$package = [ordered]@{
    name = 'receipt-api'
    private = $true
    type = 'module'
    engines = @{ node = '>=24' }
    scripts = @{ start = 'node server/index.ts' }
}
$packageJson = ($package | ConvertTo-Json -Depth 3) + [Environment]::NewLine
[System.IO.File]::WriteAllText($packagePath, $packageJson, [System.Text.UTF8Encoding]::new($false))

# Only these explicitly selected contents enter the archive: two API sources
# and the generated package manifest. No dependencies, photos, or environment files.
Compress-Archive -LiteralPath @($packagePath, $serverRoot) -DestinationPath $archivePath -Force
Write-Output "Receipt API contents: $contentsRoot"
Write-Output "Receipt API archive: $archivePath"
