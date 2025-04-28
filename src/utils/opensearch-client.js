const { Client } = require('@opensearch-project/opensearch');
const config = require('../config/config');

const client = new Client({
    ...config.opensearch,
    ssl: {
        rejectUnauthorized: false
    }
});

const createIndex = async (indexName, data) => {
    try {
        const exists = await client.indices.exists({ index: indexName });
        if (!exists.body) {
            // Default mappings if no data is provided
            // In createIndex function, update the embedding dimension
            const mappings = {
                properties: {
                    title: { type: 'text' },
                    description: { type: 'text' },
                    file_name: { type: 'keyword' },
                    file_type: { type: 'keyword' },
                    content_text: { type: 'text' },
                    preview_url: { type: 'keyword' },
                    embedding: {
                        type: 'knn_vector',
                        dimension: 1024,  // Changed from 1536 to 1024
                        method: {
                            name: 'hnsw',
                            space_type: 'l2',
                            engine: 'nmslib',
                            parameters: {
                                ef_construction: 128,
                                m: 16
                            }
                        }
                    },
                    metadata: {
                        type: 'object',
                        properties: {
                            author: { type: 'keyword' },
                            tags: { type: 'keyword' },
                            category: { type: 'keyword' }
                        }
                    },
                    createdAt: { type: 'date' },
                    updatedAt: { type: 'date' }
                }
            };

            // If data is provided, generate dynamic mappings
            if (data && typeof data === 'object') {
                mappings.properties = {
                    ...mappings.properties,
                    ...generateDynamicMappings(data).properties
                };
            }

            await client.indices.create({
                index: indexName,
                body: {
                    settings: {
                        index: {
                            knn: true,
                            'knn.algo_param.ef_search': 100,
                            'knn.space_type': 'l2'
                        }
                    },
                    mappings
                }
            });
        }
    } catch (error) {
        console.error('Error creating index:', error);
        throw error;
    }
};

const generateDynamicMappings = (data) => {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid data provided for mapping generation');
    }

    const properties = {};
    
    Object.entries(data).forEach(([key, value]) => {
        if (key === 'metadata' && typeof value === 'object') {
            properties[key] = {
                type: 'object',
                properties: generateMetadataProperties(value || {})
            };
        } else {
            properties[key] = inferFieldType(value);
        }
    });

    return { properties };
};

const generateMetadataProperties = (metadata) => {
    const properties = {};
    Object.entries(metadata).forEach(([key, value]) => {
        properties[key] = inferFieldType(value);
    });
    return properties;
};

const inferFieldType = (value) => {
    if (Array.isArray(value)) {
        return { type: 'keyword' };
    }
    switch (typeof value) {
        case 'string':
            return value.length > 100 ? { type: 'text' } : { type: 'keyword' };
        case 'number':
            return Number.isInteger(value) ? { type: 'long' } : { type: 'float' };
        case 'boolean':
            return { type: 'boolean' };
        case 'object':
            return value === null ? { type: 'keyword' } : { type: 'object' };
        default:
            return { type: 'keyword' };
    }
};

// Add bulk operation support
const storeBulkEntities = async (entities, appUrl, entityType) => {
    try {
        if (!appUrl || !entityType) {
            throw new Error('x-application-url and x-entity-type headers are required');
        }

        const indexName = generateIndexName(appUrl, entityType);
        await createIndex(indexName, entities[0]);

        const operations = entities.flatMap(entity => {
            if (!entity.id) {
                throw new Error(`Missing id for entity`);
            }

            const document = {
                id: entity.id,
                file_name: entity.file_name || '',
                file_type: entity.file_type || '',
                description: entity.description || '',
                content_text: entity.content_text || '',
                preview_url: entity.preview_url || '',
                application_url: appUrl,
                entity_type: entityType,
                embedding: entity.embedding, // Added embedding field
                metadata: {
                    author: entity.metadata?.author || '',
                    tags: entity.metadata?.tags || [],
                    category: entity.metadata?.category || ''
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Validate embedding exists
            if (!document.embedding) {
                console.error(`Warning: No embedding found for entity ${entity.id}`);
            }

            return [
                { index: { _index: indexName, _id: entity.id } },
                document
            ];
        });

        if (operations.length === 0) {
            throw new Error('No valid entities to process');
        }

        const response = await client.bulk({ 
            body: operations,
            refresh: true // Ensure the documents are immediately available
        });

        // Check for errors in bulk operation
        if (response.body.errors) {
            const failedItems = response.body.items
                .filter(item => item.index.error)
                .map(item => ({
                    id: item.index._id,
                    error: item.index.error.reason
                }));
            throw new Error(`Bulk operation failed for some items: ${JSON.stringify(failedItems)}`);
        }

        return {
            success: true,
            indexName,
            items: response.body.items
        };
    } catch (error) {
        console.error('Error storing bulk entities:', error);
        throw error;
    }
};

const storeEntity = async (entity, appUrl, entityType) => {
    try {
        if (!appUrl || !entityType) {
            throw new Error('x-application-url and x-entity-type headers are required');
        }

        const indexName = generateIndexName(appUrl, entityType);
        await createIndex(indexName);

        // Generate embeddings if not present
        if (!entity.embedding && entity.content_text) {
            try {
                const { generateEmbeddings } = require('../services/aws/bedrock');
                const embeddings = await generateEmbeddings(entity.content_text);
                entity.embedding = embeddings;
                console.log('Generated embeddings:', embeddings.length);
            } catch (embeddingError) {
                console.error('Error generating embeddings:', embeddingError);
                throw new Error('Failed to generate embeddings for content');
            }
        }

        // Ensure embedding exists and is valid
        if (!entity.embedding) {
            throw new Error('Content text or embedding is required for storing entity');
        }

        // Format embedding properly
        let embeddingArray = entity.embedding;
        try {
            if (typeof embeddingArray === 'string') {
                embeddingArray = JSON.parse(embeddingArray);
            }
            if (embeddingArray.vector) {
                embeddingArray = embeddingArray.vector;
            }
            // Ensure all values are numbers
            embeddingArray = embeddingArray.map(num => typeof num === 'string' ? parseFloat(num) : num);
        } catch (error) {
            console.error('Error formatting embedding:', error);
            throw new Error('Invalid embedding format');
        }

        const document = {
            id: entity.id,
            file_name: entity.file_name || '',
            file_type: entity.file_type || '',
            description: entity.description || '',
            content_text: entity.content_text || '',
            preview_url: entity.preview_url || '',
            application_url: appUrl,
            entity_type: entityType,
            embedding: embeddingArray,
            metadata: {
                author: entity.metadata?.author || '',
                tags: entity.metadata?.tags || [],
                category: entity.metadata?.category || ''
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Final validation before storing
        if (!Array.isArray(document.embedding) || document.embedding.length !== 1024) {
            throw new Error(`Invalid embedding array. Expected 1024 dimensions, got ${Array.isArray(document.embedding) ? document.embedding.length : 'not an array'}`);
        }

        const response = await client.index({
            index: indexName,
            body: document,
            id: entity.id,
            refresh: true
        });

        console.log(`Entity stored successfully in index: ${indexName}`);
        return {
            success: true,
            id: response.body._id,
            indexName
        };
    } catch (error) {
        console.error('Error storing entity:', error);
        throw error;
    }
};

const generateIndexName = (appUrl, entityType) => {
    if (!appUrl || !entityType) {
        throw new Error('x-application-url and x-entity-type headers are required');
    }

    // Convert URL and entityType to lowercase and remove protocol, replace all special chars with underscore
    const cleanUrl = appUrl.toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/[^\w]/g, '_');  // Changed regex to handle all non-word characters
    const cleanEntityType = entityType.toLowerCase()
        .replace(/[^\w]/g, '_');
    return `${cleanUrl}-${cleanEntityType}`;
};

// Add these new functions after storeEntity

const updateEntity = async (id, entity, appUrl, entityType) => {
    try {
        const indexName = generateIndexName(appUrl, entityType);
        
        const document = {
            file_name: entity.file_name,
            file_type: entity.file_type,
            description: entity.description,
            content_text: entity.content_text,
            preview_url: entity.preview_url,
            metadata: {
                author: entity.metadata.author,
                tags: entity.metadata.tags,
                category: entity.metadata.category
            },
            updatedAt: new Date().toISOString()
        };

        if (entity.embedding) {
            document.embedding = entity.embedding;
        }

        const response = await client.update({
            index: indexName,
            id: id,
            body: {
                doc: document
            }
        });

        return {
            success: true,
            id: id,
            indexName,
            result: response.body.result
        };
    } catch (error) {
        console.error('Error updating entity:', error);
        throw error;
    }
};

const deleteEntity = async (id, appUrl, entityType) => {
    try {
        const indexName = generateIndexName(appUrl, entityType);
        
        const response = await client.delete({
            index: indexName,
            id: id
        });

        return {
            success: true,
            id: id,
            indexName,
            result: response.body.result
        };
    } catch (error) {
        console.error('Error deleting entity:', error);
        throw error;
    }
};

// Add this function to the existing file
const getEntity = async (id, appUrl, entityType) => {
    try {
        const indexName = generateIndexName(appUrl, entityType);
        
        // Check if index exists first
        const indexExists = await client.indices.exists({ index: indexName });
        if (!indexExists.body) {
            return {
                success: false,
                error: `Index ${indexName} does not exist`
            };
        }

        // Try to get the document
        try {
            const response = await client.get({
                index: indexName,
                id: id
            });
            return {
                success: true,
                data: response.body._source
            };
        } catch (error) {
            if (error.meta?.statusCode === 404) {
                return {
                    success: false,
                    error: `Document with ID ${id} not found in index ${indexName}`
                };
            }
            throw error; // Re-throw other errors
        }
    } catch (error) {
        console.error('Error getting entity:', error);
        return {
            success: false,
            error: error.message || 'Failed to retrieve entity'
        };
    }
};

// Update the exports
module.exports = {
    client,
    createIndex,
    generateIndexName,
    storeEntity,
    updateEntity,
    deleteEntity,
    storeBulkEntities,
    getEntity
};