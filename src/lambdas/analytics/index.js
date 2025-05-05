const { MongoClient } = require('mongodb');
const config = require('../../config/env');  // Update the path to match the correct directory structure

exports.handler = async (event) => {
  let client;
  try {
    client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    const db = client.db(config.MONGODB_DATABASE);
    const collection = db.collection('search_logs');

    // Get analytics data
    const pipeline = [
      {
        $group: {
          _id: {
            clientName: '$clientName',
            appName: '$appName',
            environment: '$environment'
          },
          totalSearches: { $sum: 1 },
          avgResultsCount: { $avg: '$resultsCount' }
        }
      }
    ];

    const results = await collection.aggregate(pipeline).toArray();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        status: 'success',
        data: results
      })
    };
  } catch (error) {
    console.error('Analytics error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        status: 'error',
        message: 'An error occurred while fetching analytics'
      })
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
};