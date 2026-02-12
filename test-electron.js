/**
 * Test Electron headless pour la détection d'imprimantes
 */

const { app } = require('electron');
const printer = require('@thiagoelg/node-printer');

// Ne pas afficher de fenêtre
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  console.log('\n🖨️  Test de détection d\'imprimantes RepairMind Print Client\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Récupérer toutes les imprimantes
    const printers = printer.getPrinters();

    console.log(`✅ Nombre d'imprimantes détectées: ${printers.length}\n`);

    if (printers.length === 0) {
      console.log('⚠️  Aucune imprimante détectée');
    } else {
      printers.forEach((p, index) => {
        console.log(`\n📄 Imprimante ${index + 1}:`);
        console.log(`   Nom: ${p.name}`);
        console.log(`   Description: ${p.description || 'N/A'}`);
        console.log(`   Driver: ${p.driverName || 'N/A'}`);
        console.log(`   Port: ${p.portName || 'N/A'}`);
        console.log(`   Status: ${p.status || 'N/A'}`);
        console.log(`   Par défaut: ${p.isDefault ? 'Oui' : 'Non'}`);
      });
    }

    // Imprimante par défaut
    console.log('\n═══════════════════════════════════════════════════════════');
    const defaultPrinter = printer.getDefaultPrinterName();
    console.log(`\n🎯 Imprimante par défaut: ${defaultPrinter || 'Aucune'}\n`);

    console.log('✅ Test terminé avec succès!\n');

  } catch (error) {
    console.error('❌ Erreur lors de la détection:', error.message);
    console.error(error.stack);
    app.exit(1);
  }

  // Quitter l'application
  setTimeout(() => {
    app.exit(0);
  }, 500);
});

app.on('window-all-closed', () => {
  app.quit();
});
