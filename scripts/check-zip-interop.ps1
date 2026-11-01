param([Parameter(Mandatory=$true)][string]$InputArchive, [Parameter(Mandatory=$true)][string]$OutputArchive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [System.IO.Compression.ZipFile]::OpenRead($InputArchive)
try {
  $target = [System.IO.Compression.ZipFile]::Open($OutputArchive, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($entry in $source.Entries) {
      $copy = $target.CreateEntry($entry.FullName, [System.IO.Compression.CompressionLevel]::Optimal)
      $readStream = $entry.Open()
      $writeStream = $copy.Open()
      try { $readStream.CopyTo($writeStream) }
      finally { $readStream.Dispose(); $writeStream.Dispose() }
    }
  } finally { $target.Dispose() }
  Write-Output ('Validated entries: ' + $source.Entries.Count)
} finally { $source.Dispose() }
