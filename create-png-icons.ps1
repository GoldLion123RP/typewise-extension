# Create assets/icons directory
New-Item -ItemType Directory -Force -Path "assets\icons"

# Function to create a simple colored PNG
Add-Type -AssemblyName System.Drawing

function Create-Icon {
    param($size, $filename)
    
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Purple gradient background
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        [System.Drawing.Point]::new(0, 0),
        [System.Drawing.Point]::new($size, $size),
        [System.Drawing.Color]::FromArgb(102, 126, 234),
        [System.Drawing.Color]::FromArgb(118, 75, 162)
    )
    $graphics.FillRectangle($brush, 0, 0, $size, $size)
    
    # Draw "TW" text
    $font = New-Object System.Drawing.Font("Arial", ($size / 3), [System.Drawing.FontStyle]::Bold)
    $textBrush = [System.Drawing.Brushes]::White
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    
    $graphics.DrawString("TW", $font, $textBrush, ($size / 2), ($size / 2), $format)
    
    # Save
    $bmp.Save("assets\icons\$filename", [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics.Dispose()
    $bmp.Dispose()
    
    Write-Host "Created $filename"
}

# Create all icon sizes
Create-Icon 16 "icon-16.png"
Create-Icon 32 "icon-32.png"
Create-Icon 48 "icon-48.png"
Create-Icon 128 "icon-128.png"

Write-Host "`nAll icons created successfully!" -ForegroundColor Green