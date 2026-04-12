# Resize source icon to required sizes
Add-Type -AssemblyName System.Drawing

$sourcePath = "assets\source_icon.png"
$sizes = @(16, 32, 48, 128)

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source icon not found at $sourcePath"
    exit 1
}

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)

foreach ($size in $sizes) {
    $filename = "assets\icons\icon-$size.png"
    
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
    
    $bmp.Save($filename, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics.Dispose()
    $bmp.Dispose()
    
    Write-Host "Created $filename"
}

$sourceImage.Dispose()
Write-Host "All icons resized successfully!" -ForegroundColor Green
