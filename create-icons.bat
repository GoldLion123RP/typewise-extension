@echo off
echo Creating placeholder icons...

mkdir assets\icons 2>nul

echo ^<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"^>^<rect width="16" height="16" fill="%23667eea"/^>^<text x="8" y="12" font-family="Arial" font-size="10" fill="white" text-anchor="middle"^>TW^</text^>^</svg^> > assets\icons\icon-16.svg

echo ^<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"^>^<rect width="32" height="32" fill="%23667eea"/^>^<text x="16" y="22" font-family="Arial" font-size="18" fill="white" text-anchor="middle"^>TW^</text^>^</svg^> > assets\icons\icon-32.svg

echo ^<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"^>^<rect width="48" height="48" fill="%23667eea"/^>^<text x="24" y="32" font-family="Arial" font-size="24" fill="white" text-anchor="middle"^>TW^</text^>^</svg^> > assets\icons\icon-48.svg

echo ^<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"^>^<rect width="128" height="128" fill="%23667eea"/^>^<text x="64" y="85" font-family="Arial" font-size="64" fill="white" text-anchor="middle"^>TW^</text^>^</svg^> > assets\icons\icon-128.svg

echo Icons created as SVG files!
echo.
echo Note: Chrome requires PNG icons. Converting...
echo Please install a tool to convert SVG to PNG, or use online converters.
echo.
pause