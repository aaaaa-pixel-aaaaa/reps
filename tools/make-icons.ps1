# Generates the app icons (dev-time only; outputs are committed).
#   powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-Icon {
    param([int]$Size, [string]$Path, [double]$Scale = 1.0)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#15110F'))

    $cx = $Size / 2.0

    # Outer progress ring, orange, ~300 degree sweep with round caps.
    $r1 = $Size * 0.315 * $Scale
    $w1 = [single]($Size * 0.105 * $Scale)
    $pen1 = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#FF8A3D'), $w1)
    $pen1.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen1.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $rect1 = New-Object System.Drawing.RectangleF([single]($cx - $r1), [single]($cx - $r1), [single](2 * $r1), [single](2 * $r1))
    $g.DrawArc($pen1, $rect1, [single]-90, [single]300)

    # Inner ring, amber, shorter sweep.
    $r2 = $Size * 0.165 * $Scale
    $w2 = [single]($Size * 0.075 * $Scale)
    $pen2 = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#FFB454'), $w2)
    $pen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $rect2 = New-Object System.Drawing.RectangleF([single]($cx - $r2), [single]($cx - $r2), [single](2 * $r2), [single](2 * $r2))
    $g.DrawArc($pen2, $rect2, [single]-90, [single]210)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "wrote $Path"
}

New-Icon -Size 512 -Path (Join-Path $outDir 'icon-512.png')
New-Icon -Size 192 -Path (Join-Path $outDir 'icon-192.png')
New-Icon -Size 512 -Path (Join-Path $outDir 'icon-maskable-512.png') -Scale 0.8
New-Icon -Size 180 -Path (Join-Path $outDir 'apple-touch-icon.png')
New-Icon -Size 32  -Path (Join-Path $outDir 'favicon-32.png')
