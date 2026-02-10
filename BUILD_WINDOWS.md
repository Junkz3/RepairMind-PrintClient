# 🪟 Build Windows Exécutable

## Prérequis sur Windows

1. **Node.js 18+** installé
   - Télécharger: https://nodejs.org/
   - Vérifier: `node --version`

2. **Git** (optionnel)
   - Pour cloner le repo

## 📥 Télécharger les fichiers

### Option A: Archive depuis le VPS

```powershell
# Télécharger l'archive
scp root@72.61.105.39:/var/www/RepairMind-Platform/tools/RepairMind-PrintClient.tar.gz .

# Extraire
tar -xzf RepairMind-PrintClient.tar.gz
cd RepairMind-PrintClient
```

### Option B: Git clone

```powershell
git clone YOUR_REPO_URL
cd RepairMind-PrintClient
```

## 🔨 Build

```powershell
# 1. Installer les dépendances
npm install

# 2. Builder l'exécutable Windows
npm run build:win

# 3. Trouver l'exe
# Il sera dans: dist\RepairMind Print Client Setup 1.0.0.exe
```

## ⚡ Test rapide (sans build)

Pour tester directement sans créer l'exe:

```powershell
npm start
```

## 🐛 Troubleshooting

### Erreur "node-gyp"

Installer build tools Windows:

```powershell
npm install --global windows-build-tools
# OU
npm install --global --production windows-build-tools
```

### Erreur "python not found"

Installer Python 3.x et ajouter au PATH

### L'exe ne se crée pas

Vérifier les logs dans `dist/builder-debug.yml`

## 📦 L'exe final

Après le build, tu auras:
- `dist/RepairMind Print Client Setup 1.0.0.exe` ← **Installeur**
- `dist/win-unpacked/` ← Version portable

**Double-clique sur l'installeur** pour installer l'app!

## ✅ Test de l'application

1. Lancer l'installeur
2. L'app démarre dans le system tray (barre des tâches)
3. Clic droit sur l'icône → "Show Window"
4. Configurer l'URL backend
5. L'app détecte tes imprimantes locales!

🟢 **Icône verte** = Connecté
🔴 **Icône rouge** = Déconnecté
