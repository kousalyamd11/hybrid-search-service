const { MongoClient } = require('mongodb');
const config = require('../config/env');

// MongoDB connection
let client;
let db;

// Initialize MongoDB connection
async function initializeMongoConnection() {
  if (!client) {
    client = new MongoClient(config.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    await client.connect();
    db = client.db(config.MONGODB_DATABASE);
    console.log('Connected to MongoDB');
  }
  return db;
}

// Log sample search queries to MongoDB
async function logSampleSearchQueries() {
  try {
    console.log('Logging sample search queries to MongoDB...');
    
    const database = await initializeMongoConnection();
    const collection = database.collection('search_logs');
    
    // Sample search queries
    const sampleQueries = [
      {
        clientName: 'LAM',
        appName: 'BrandSystems',
        environment: 'prod',
        appUrl: 'brandsystems.com',
        searchText: 'marketing campaign',
        filters: {},
        resultsCount: 3,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5) // 5 days ago
      },
      {
        clientName: 'LAM',
        appName: 'BrandSystems',
        environment: 'prod',
        appUrl: 'brandsystems.com',
        searchText: 'financial report',
        filters: { category: 'Finance' },
        resultsCount: 1,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4) // 4 days ago
      },
      {
        clientName: 'LAM',
        appName: 'BrandSystems',
        environment: 'prod',
        appUrl: 'brandsystems.com',
        searchText: 'eco-friendly products',
        filters: { tags: ['sustainability'] },
        resultsCount: 1,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3) // 3 days ago
      },
      {
        clientName: 'LAM',
        appName: 'BrandSystems',
        environment: 'prod',
        appUrl: 'brandsystems.com',
        searchText: 'summer campaign',
        filters: { entityType: 'Campaign' },
        resultsCount: 1,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2) // 2 days ago
      },
      {
        clientName: 'LAM',
        appName: 'BrandSystems',
        environment: 'prod',
        appUrl: 'brandsystems.com',
        searchText: 'marketing campaign',
        filters: {},
        resultsCount: 3,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1) // 1 day ago
      },
      {
        clientName: 'LAM',
        appName: 'BrandSystems',
        environment: 'dev',
        appUrl: 'dev.brandsystems.com',
        searchText: 'test query',
        filters: {},
        resultsCount: 0,
        timestamp: new Date() // Today
      },
      {
        clientName: 'ACME',
        appName: 'ProductCatalog',
        environment: 'prod',
        appUrl: 'catalog.acme.com',
        searchText: 'product launch',
        filters: { category: 'Product Launch' },
        resultsCount: 1,
        timestamp: new Date() // Today
      }
    ];
    
    // Insert sample queries
    const result = await collection.insertMany(sampleQueries);
    console.log(`${result.insertedCount} sample search queries logged successfully`);
    
    return result.insertedCount;
  } catch (error) {
    console.error('Error logging sample search queries:', error);
    return 0;
  }
}

// Test analytics functions
async function testAnalytics() {
  try {
    console.log('\n=== TESTING ANALYTICS FUNCTIONS ===\n');
    
    const database = await initializeMongoConnection();
    const collection = database.collection('search_logs');
    
    // Test 1: Get top search terms
    console.log('=== TEST 1: Top Search Terms ===');
    const topSearchTerms = await getTopSearchTerms(collection, {});
    console.log('Top search terms:');
    topSearchTerms.forEach((item, index) => {
      console.log(`${index + 1}. "${item.term}" (${item.count} searches)`);
    });
    
    // Test 2: Get search volume over time
    console.log('\n=== TEST 2: Search Volume Over Time ===');
    const searchVolume = await getSearchVolume(collection, {});
    console.log('Search volume by date:');
    searchVolume.forEach(item => {
      console.log(`${item.date}: ${item.count} searches`);
    });
    
    // Test 3: Get client usage
    console.log('\n=== TEST 3: Client Usage ===');
    const clientUsage = await getClientUsage(collection, {});
    console.log('Usage by client/app/environment:');
    clientUsage.forEach((item, index) => {
      console.log(`${index + 1}. ${item.clientName}/${item.appName}/${item.environment}: ${item.count} searches`);
    });
    
    // Test 4: Get filter combinations
    console.log('\n=== TEST 4: Filter Combinations ===');
    const filterCombinations = await getFilterCombinations(collection, {});
    console.log('Common filter combinations:');
    filterCombinations.forEach((item, index) => {
      console.log(`${index + 1}. ${item.filterName}: ${item.count} uses`);
    });
    
    console.log('\n=== ANALYTICS TESTS COMPLETED ===');
  } catch (error) {
    console.error('Error testing analytics:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Get top search terms
async function getTopSearchTerms(collection, filter) {
  // Only include queries with non-empty search text
  const searchFilter = { ...filter, searchText: { $ne: '' } };
  
  const result = await collection.aggregate([
    { $match: searchFilter },
    { $group: { _id: '$searchText', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ]).toArray();
  
  return result.map(item => ({
    term: item._id,
    count: item.count
  }));
}

// Get search volume over time (daily)
async function getSearchVolume(collection, filter) {
  const result = await collection.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]).toArray();
  
  return result.map(item => ({
    date: `${item._id.year}-${item._id.month.toString().padStart(2, '0')}-${item._id.day.toString().padStart(2, '0')}`,
    count: item.count
  }));
}

// Get usage by client/app/environment
async function getClientUsage(collection, filter) {
  const result = await collection.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          clientName: '$clientName',
          appName: '$appName',
          environment: '$environment'
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]).toArray();
  
  return result.map(item => ({
    clientName: item._id.clientName,
    appName: item._id.appName,
    environment: item._id.environment,
    count: item.count
  }));
}

// Get common filter combinations
async function getFilterCombinations(collection, filter) {
  const result = await collection.aggregate([
    { $match: filter },
    { $project: { filterKeys: { $objectToArray: '$filters' } } },
    { $unwind: '$filterKeys' },
    { $group: { _id: '$filterKeys.k', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ]).toArray();
  
  return result.map(item => ({
    filterName: item._id,
    count: item.count
  }));
}

// Run the test
async function runTest() {
  try {
    // Log sample search queries
    const insertedCount = await logSampleSearchQueries();
    
    if (insertedCount > 0) {
      // Test analytics functions
      await testAnalytics();
    }
    
    console.log('Analytics test completed successfully');
  } catch (error) {
    console.error('Analytics test failed:', error);
  }
}

// Run the test
runTest()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });