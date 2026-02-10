# Build Resources

Place your application icons here:

- `icon.ico` - Windows icon (256x256)
- `icon.icns` - macOS icon (512x512)
- `icon.png` - Linux icon (512x512)

## Génération rapide d'icônes

Utilisez un outil comme https://icon.kitchen ou:

```bash
# Installer electron-icon-maker
npm install -g electron-icon-maker

# Générer depuis une image PNG
electron-icon-maker --input=source.png --output=./build
```

Pour l'instant, electron-builder utilisera des icônes par défaut.
