const { setupDatabaseIndexes } = require('../src/utils/db-setup');

console.log('Starting database setup...');
setupDatabaseIndexes()
  .then(() => {
    console.log('Database setup completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Database setup failed:', err);
    process.exit(1); // Exit with error code
  });