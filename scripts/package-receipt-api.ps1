[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoPrefix = $repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$outputRoot = Join-Path $repoRoot 'artifacts\receipt-api'
$contentsRoot = Join-Path $outputRoot 'backend-contents'
$sourceRoot = Join-Path $repoRoot 'backend'
$stagedSourceRoot = Join-Path $contentsRoot 'src'
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

$sourceFiles = @('package.json', 'README.md', 'src\index.ts', 'src\receiptApi.ts')
$allowedPaths = @($stagedSourceRoot) + @($sourceFiles | ForEach-Object { Join-Path $contentsRoot $_ })
foreach ($path in @($outputRoot, $contentsRoot, $archivePath) + $allowedPaths) {
    Assert-RepositoryPath $path
}
foreach ($filename in $sourceFiles) {
    $sourcePath = Join-Path $sourceRoot $filename
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

New-Item -ItemType Directory -Path $stagedSourceRoot -Force | Out-Null
foreach ($filename in $sourceFiles) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $filename) -Destination (Join-Path $contentsRoot $filename) -Force
}

# Archive only the allowlisted files, with Unix separators for Azure Linux.
# No dependencies, photos, environment files, or frontend assets are included.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
try {
    $archive = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($filename in $sourceFiles) {
            $entryName = $filename.Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $contentsRoot $filename), $entryName) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    $archiveStream.Dispose()
}
Write-Output "Receipt API contents: $contentsRoot"
Write-Output "Receipt API archive: $archivePath"
