// Run with: npm run vapid
// Prints a fresh VAPID key pair to paste into .env / Railway variables.
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('\nAdd these to your .env (or Railway service variables):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nThen restart the server. Notifications are optional — everything');
console.log('else in Small Wins works fine without these set.\n');
