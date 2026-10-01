# App móvil del supervisor

Aplicación Expo (React Native + TypeScript) para registrar visitas en campo, con funcionamiento **sin conexión** y sincronización automática.

Instrucciones completas de instalación y ejecución: [README principal](../README.md).

Resumen:

```bash
npm install
copy .env.example .env      # y poner la IP del computador en EXPO_PUBLIC_API_URL
npx expo start -c           # escanear el QR con Expo Go
```

Código principal: `src/app/index.tsx` (pantalla) y `src/database/db.ts` (SQLite local).
