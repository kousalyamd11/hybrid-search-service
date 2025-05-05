const { Client } = require('@opensearch-project/opensearch');
const AWS = require('aws-sdk');
const config = require('../config/env');

// Initialize OpenSearch client
const client = new Client({
  node: config.OPENSEARCH_ENDPOINT,
  ssl: {
    rejectUnauthorized: false // For local development only
  }
});

// Generate mock embedding for testing
function generateMockEmbedding() {
  return Array(1536).fill(0).map(() => Math.random() - 0.5);
}

// Perform hybrid search
async function performSearch(searchText, filters = {}) {
  try {
    console.log(`Performing search for: "${searchText}" with filters:`, filters);
    
    const indexName = 'lus_lam_brandsystems_prod-test';
    
    // Build search query
    let searchQuery = {
      size: 20,
      query: {
        bool: {
          must: [],
          filter: []
        }
      }
    };
    
    // Add semantic search if searchText is provided
    if (searchText && searchText.trim()) {
      // Generate mock embedding for testing
      const embedding = generateMockEmbedding();
      
      // Add k-NN query for semantic search
      searchQuery.query.bool.must.push({
        knn: {
          embedding_field: {
            vector: embedding,
            k: 100
          }
        }
      });
    }
    
    // Add filters
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        // Handle array values (OR condition)
        searchQuery.query.bool.filter.push({
          terms: { [key]: value }
        });
      } else if (typeof value === 'object' && (value.gte !== undefined || value.lte !== undefined)) {
        // Handle range queries
        searchQuery.query.bool.filter.push({
          range: { [key]: value }
        });
      } else {
        // Handle simple equality
        searchQuery.query.bool.filter.push({
          term: { [key]: value }
        });
      }
    }
    
    console.log('Executing search query...');
    
    // Execute search
    const searchResponse = await client.search({
      index: indexName,
      body: searchQuery
    });
    
    // Process results
    const results = searchResponse.body.hits.hits.map(hit => ({
      id: hit._id,
      score: hit._score,
      title: hit._source.title,
      description: hit._source.description,
      category: hit._source.category,
      tags: hit._source.tags,
      entityType: hit._source.entityType
    }));
    
    console.log(`\nSearch results (${results.length} found):`);
    results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.title} (Score: ${result.score.toFixed(4)})`);
      console.log(`   Description: ${result.description}`);
      console.log(`   Category: ${result.category}`);
      console.log(`   Entity Type: ${result.entityType}`);
      console.log(`   Tags: ${result.tags.join(', ')}`);
    });
    
    return results;
  } catch (error) {
    console.error('Error performing search:', error);
    return [];
  }
}

// Run test searches
async function runTestSearches() {
  console.log('=== RUNNING TEST SEARCHES ===\n');
  
  // Test 1: Semantic search with no filters
  console.log('\n=== TEST 1: Semantic search with no filters ===');
  await performSearch('marketing campaign');
  
  // Test 2: Filter-only search (no semantic)
  console.log('\n=== TEST 2: Filter-only search (no semantic) ===');
  await performSearch('', { category: 'Finance' });
  
  // Test 3: Hybrid search (semantic + filters)
  console.log('\n=== TEST 3: Hybrid search (semantic + filters) ===');
  await performSearch('product', { tags: ['eco-friendly'] });
  
  // Test 4: Multiple filters
  console.log('\n=== TEST 4: Multiple filters ===');
  await performSearch('', { 
    entityType: 'Campaign',
    tags: ['summer', 'outdoor'] 
  });
  
  console.log('\n=== TEST SEARCHES COMPLETED ===');
}

// Run the tests
runTestSearches()
  .then(() => {
    console.log('All test searches completed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Test searches failed:', err);
    process.exit(1);
  });