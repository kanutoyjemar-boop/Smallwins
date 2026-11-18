const test = require('node:test');
const assert = require('node:assert/strict');
const BackupCrypto = require('../public/js/backup-crypto');

test('encrypted backups round-trip without exposing the original data', async () => {
  const original = { version: 10, tasks: [{ title: 'Private sample task' }] };
  const envelope = await BackupCrypto.encrypt(original, 'a-private-passphrase');

  assert.equal(BackupCrypto.isEncrypted(envelope), true);
  assert.equal(JSON.stringify(envelope).includes('Private sample task'), false);
  assert.deepEqual(await BackupCrypto.decrypt(envelope, 'a-private-passphrase'), original);
});

test('encrypted backups reject wrong passphrases and unsupported formats', async () => {
  const envelope = await BackupCrypto.encrypt({ tasks: [] }, 'a-private-passphrase');

  await assert.rejects(
    BackupCrypto.decrypt(envelope, 'a-different-passphrase'),
    /passphrase is incorrect or the backup file is damaged/
  );
  await assert.rejects(
    BackupCrypto.decrypt({ ...envelope, iterations: 1 }, 'a-private-passphrase'),
    /not a supported Small Wins encrypted backup/
  );
  await assert.rejects(
    BackupCrypto.encrypt({}, 'short'),
    /at least 12 characters/
  );
});
