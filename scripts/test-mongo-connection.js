const { MongoClient } = require('mongodb');
const config = require('../config/env');

async function testMongoConnection() {
  let client;
  
  try {
    console.log('Attempting to connect to MongoDB at:', config.MONGODB_URI);
    
    client = new MongoClient(config.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    await client.connect();
    console.log('Successfully connected to MongoDB!');
    
    const db = client.db(config.MONGODB_DATABASE);
    const collections = await db.listCollections().toArray();
    
    console.log(`Connected to database: ${config.MONGODB_DATABASE}`);
    console.log('Available collections:');
    
    if (collections.length === 0) {
      console.log('  No collections found. This is normal for a new database.');
    } else {
      collections.forEach(collection => {
        console.log(`  - ${collection.name}`);
      });
    }
    
    console.log('\nMongoDB connection test completed successfully!');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the test
testMongoConnection()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });