const { MongoClient } = require('mongodb');
const config = require('../../config/env');

async function logSearchQuery(logData) {
  let client;
  try {
    client = new MongoClient(config.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    const db = client.db(config.MONGODB_DATABASE);
    const collection = db.collection('search_logs');
    await collection.insertOne(logData);
  } catch (error) {
    console.error('Error logging search query:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

module.exports = {
  logSearchQuery
};