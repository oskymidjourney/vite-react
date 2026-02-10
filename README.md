# WhatsApp Masivo (solo HTML funcional)

Este proyecto está preparado para usar **únicamente con HTML** en Windows.
No necesitas Node, npm ni Vite para usar la herramienta.

## Archivos clave

- `index.html` → aplicación principal.
- `iniciar-en-windows.bat` → ejecuta la app en Windows (recomendado).
- `whatsapp-masivo.html` → copia equivalente del HTML standalone.

## Cómo ejecutarlo en Windows (recomendado)

1. Descarga y extrae el proyecto en una carpeta, por ejemplo:
   `C:\apps\whatsapp-masivo`
2. Haz doble clic en:
   **`iniciar-en-windows.bat`**
3. Se abrirá automáticamente:
   `http://localhost:4180/index.html`

> Si no tienes Python instalado, el `.bat` intentará abrir `index.html` directo.

## Uso básico

1. Agrega contactos manualmente o por bloque de texto.
2. Escribe/ajusta el mensaje plantilla.
3. Pulsa **Generar enlaces**.
4. Usa:
   - **Abrir en secuencia**
   - **Copiar enlaces**
   - **Descargar enlaces CSV**
5. Guarda avance con **Descargar respaldo JSON** y recupéralo con **Cargar respaldo**.

## Solución rápida de problemas en Windows

- Si no abre WhatsApp Web: habilita pop-ups en tu navegador.
- Si no carga bien por doble clic: usa siempre `iniciar-en-windows.bat`.
- Si el `.bat` no levanta servidor: instala Python y vuelve a ejecutar.
