const { MongoClient } = require('mongodb');
const config = require('../../config/env');

async function setupDatabaseIndexes() {
  let client;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(config.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    await client.connect();
    console.log('Connected to MongoDB for index setup');
    
    const db = client.db(config.MONGODB_DATABASE);
    const searchLogsCollection = db.collection('search_logs');
    
    // Create indexes for search_logs collection
    console.log('Creating indexes for search_logs collection...');
    
    // Index for timestamp queries (for date range filtering and sorting)
    await searchLogsCollection.createIndex({ timestamp: 1 });
    console.log('Created index on timestamp');
    
    // Compound index for client/app/environment queries
    await searchLogsCollection.createIndex({ 
      clientName: 1, 
      appName: 1, 
      environment: 1 
    });
    console.log('Created compound index on clientName, appName, environment');
    
    // Index for searchText queries (for analyzing popular search terms)
    await searchLogsCollection.createIndex({ searchText: 1 });
    console.log('Created index on searchText');
    
    // Index for resultsCount (for analyzing zero-result searches)
    await searchLogsCollection.createIndex({ resultsCount: 1 });
    console.log('Created index on resultsCount');
    
    // TTL index to automatically expire old logs (optional - set to 90 days)
    // Uncomment if you want automatic data expiration
    // await searchLogsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7776000 });
    // console.log('Created TTL index on timestamp (90 days)');
    
    console.log('All indexes created successfully');
  } catch (error) {
    console.error('Error setting up database indexes:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the setup if this file is executed directly
if (require.main === module) {
  setupDatabaseIndexes()
    .then(() => {
      console.log('Database setup completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Database setup failed:', err);
      process.exit(1);
    });
}

module.exports = { setupDatabaseIndexes };