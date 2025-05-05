const { Client } = require('@opensearch-project/opensearch');
const config = require('../src/config/env');

async function setupTestIndex() {
  const client = new Client({
    node: config.OPENSEARCH_ENDPOINT,
    ssl: {
      rejectUnauthorized: false
    }
  });

  // Update index name to lowercase
  const indexName = 'lus_lam_brandsystems_prod-campaign';
  
  try {
    // Delete index if it exists
    const indexExists = await client.indices.exists({ index: indexName });
    if (indexExists.body) {
      await client.indices.delete({ index: indexName });
    }

    // Create index with mappings
    await client.indices.create({
      index: indexName,
      body: {
        mappings: {
          properties: {
            title: { type: 'text' },
            name: { type: 'text' },
            description: { type: 'text' },
            previewUrl: { type: 'keyword' },
            embedding_field: {
              type: 'knn_vector',
              dimension: 1536
            }
          }
        }
      }
    });

    // Add sample data
    await client.index({
      index: indexName,
      id: '1',
      body: {
        title: 'Test Campaign 1',
        name: 'Test Campaign 1',
        description: 'This is a test campaign for hybrid search',
        previewUrl: 'https://example.com/campaign1',
        embedding_field: new Array(1536).fill(0.1)
      }
    });

    console.log('Test index created successfully');
  } catch (error) {
    console.error('Error setting up test index:', error);
  }
}

setupTestIndex();