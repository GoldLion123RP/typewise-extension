[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '', Justification = 'False positive in this script context; helper uses approved naming.')]
param(
    [string]$SourceFile = "assets/source_icon.png"
)

Add-Type -AssemblyName System.Drawing

$scriptRoot = Split-Path -Parent $PSCommandPath

if ([System.IO.Path]::IsPathRooted($SourceFile)) {
    $resolvedSourceFile = $SourceFile
}
else {
    $resolvedSourceFile = Join-Path $scriptRoot $SourceFile
}

$iconsDir = Join-Path $scriptRoot "assets/icons"
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

if (-not (Test-Path $resolvedSourceFile)) {
    throw "Source icon not found: $resolvedSourceFile"
}

function New-IconAsset {
    param(
        [System.Drawing.Image]$Source,
        [int]$Size,
        [string]$OutputPath
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # Center-crop to square, then resize
    $sourceSize = [Math]::Min($Source.Width, $Source.Height)
    $srcX = [int](($Source.Width - $sourceSize) / 2)
    $srcY = [int](($Source.Height - $sourceSize) / 2)
    $srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $sourceSize, $sourceSize)
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)

    $graphics.DrawImage($Source, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $bmp.Dispose()
}

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $resolvedSourceFile).Path)

try {
    New-IconAsset -Source $sourceImage -Size 16 -OutputPath (Join-Path $iconsDir "icon-16.png")
    New-IconAsset -Source $sourceImage -Size 32 -OutputPath (Join-Path $iconsDir "icon-32.png")
    New-IconAsset -Source $sourceImage -Size 48 -OutputPath (Join-Path $iconsDir "icon-48.png")
    New-IconAsset -Source $sourceImage -Size 128 -OutputPath (Join-Path $iconsDir "icon-128.png")

    Write-Host "Created icon-16.png, icon-32.png, icon-48.png, icon-128.png from $resolvedSourceFile" -ForegroundColor Green
}
finally {
    $sourceImage.Dispose()
}