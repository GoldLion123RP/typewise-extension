@echo off
echo Installing TypeWise dependencies...
echo.
call npm install
echo.
echo Installation complete!
echo.
echo Available commands:
echo   npm run dev          - Start development server
echo   npm run build        - Build for production
echo   npm run build:chrome - Build for Chrome
echo   npm run build:firefox - Build for Firefox
echo   npm run test         - Run tests
echo   npm run lint         - Check code style
echo.
pause
