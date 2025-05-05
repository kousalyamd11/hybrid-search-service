const { Client } = require('@opensearch-project/opensearch');
const config = require('../src/config/env');

async function testConnection() {
  const client = new Client({
    node: config.OPENSEARCH_ENDPOINT,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Test the connection
    const response = await client.cluster.health();
    console.log('OpenSearch cluster health:', response.body);

    // List all indices
    const indices = await client.cat.indices({ format: 'json' });
    console.log('\nExisting indices:', indices.body.map(idx => idx.index));
  } catch (error) {
    console.error('Error connecting to OpenSearch:', error);
  }
}

testConnection();