const searchConfig = {
  opensearch: {
    indexNamePattern: 'lus_${clientName}_${appName}_${stack}-${entityType}',
    defaultSize: 10,
    maxSize: 50,
    // Mapping templates for different entity types
    mappingTemplates: {
      default: {
        settings: {
          index: { knn: true }
        },
        mappings: {
          properties: {
            embedding: {
              type: 'knn_vector',
              dimension: 1024,
              method: {
                name: 'hnsw',
                space_type: 'cosinesimil',
                engine: 'nmslib'
              }
            }
          }
        }
      }
    }
  },
  logging: {
    collections: {
      searches: 'search_logs',
      errors: 'error_logs',
      usage: 'usage_metrics'
    }
  }
};

module.exports = searchConfig;