const express = require('express');
const router = express.Router();
const { 
    storeEntity, 
    updateEntity, 
    deleteEntity, 
    storeBulkEntities, 
    getEntity,
    searchEntities
} = require('../utils/opensearch-client');
const { generateEmbeddings } = require('../services/aws/bedrock');
const { analyzeImageWithClaude, downloadImage } = require('../services/aws/claude-vision');

// Move convertToLowerCase function outside the route handler
const convertToLowerCase = (obj) => {
    if (typeof obj === 'string') return obj.toLowerCase();
    if (Array.isArray(obj)) return obj.map(item => convertToLowerCase(item));
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            newObj[key] = convertToLowerCase(value);
        }
        return newObj;
    }
    return obj;
};

router.post('/entity', async (req, res) => {
    try {
        const appUrl = req.headers['x-application-url'] || req.headers['x-app-url'];
        const entityType = req.headers['x-entity-type'];

        if (!appUrl || !entityType) {
            return res.status(400).json({
                success: false,
                error: 'Missing required headers',
                details: {
                    required: ['x-application-url or x-app-url', 'x-entity-type'],
                    suggestion: 'Please provide both application URL and entity type in the request headers'
                }
            });
        }

        let entityData = {
            id: req.body.id,
            file_name: req.body.file_name?.toLowerCase(),
            file_type: req.body.file_type?.toLowerCase(),
            description: req.body.description?.toLowerCase(),
            content_text: req.body.content_text?.toLowerCase(),
            preview_url: req.body.preview_url,
            metadata: convertToLowerCase(req.body.metadata || {})
        };

        // Process preview URL if exists
        if (entityData.preview_url) {
            try {
                console.log('Processing image URL:', entityData.preview_url);
                const imageBase64 = await downloadImage(entityData.preview_url);
                const generatedText = await analyzeImageWithClaude(imageBase64);
                
                if (generatedText) {
                    console.log('Text generated from image:', generatedText);
                    entityData.content_text = generatedText.toLowerCase(); // Convert to lowercase
                    const embeddings = await generateEmbeddings(generatedText);
                    if (embeddings) {
                        entityData.embedding = embeddings;
                        console.log('Embeddings generated successfully');
                    }
                } else {
                    console.error('No text generated from image');
                }
            } catch (error) {
                console.error('Error in image processing pipeline:', error.message);
            }
        }

        if (!entityData.embedding && entityData.content_text) {
            console.log('Generating embeddings from content_text...');
            entityData.embedding = await generateEmbeddings(entityData.content_text);
        }

        const result = await storeEntity(entityData, appUrl, entityType);
        return res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/entity/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const appUrl = req.headers['x-application-url'] || req.headers['x-app-url'];
        const entityType = req.headers['x-entity-type'];

        if (!appUrl || !entityType) {
            return res.status(400).json({
                success: false,
                error: 'Application URL and entity type headers are required'
            });
        }

        let entityData = req.body.entity || req.body;
        
        // Convert fields to lowercase for case-sensitive matching
        if (entityData.file_name) entityData.file_name = entityData.file_name.toLowerCase();
        if (entityData.file_type) entityData.file_type = entityData.file_type.toLowerCase();
        if (entityData.description) entityData.description = entityData.description.toLowerCase();
        if (entityData.content_text) entityData.content_text = entityData.content_text.toLowerCase();
        if (entityData.metadata) entityData.metadata = convertToLowerCase(entityData.metadata);

        const existingEntity = await getEntity(id, appUrl, entityType);

        if (!existingEntity.success) {
            return res.status(404).json({
                success: false,
                error: 'Entity not found',
                details: {
                    id,
                    suggestion: 'Please verify the entity ID and ensure it exists'
                }
            });
        }

        // Check if preview_url has changed
        if (entityData.preview_url && entityData.preview_url !== existingEntity.data.preview_url) {
            try {
                const imageBase64 = await downloadImage(entityData.preview_url);
                const generatedText = await analyzeImageWithClaude(imageBase64);
                
                if (generatedText) {
                    entityData.content_text = generatedText.toLowerCase(); // Convert to lowercase
                    const embeddings = await generateEmbeddings(generatedText);
                    if (embeddings) {
                        entityData.embedding = embeddings;
                    }
                }
            } catch (error) {
                console.error('Error processing image:', error.message);
            }
        }

        const result = await updateEntity(id, entityData, appUrl, entityType);
        return res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update DELETE endpoint
router.delete('/entity/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const appUrl = req.headers['x-application-url'] || req.headers['x-app-url'];
        const entityType = req.headers['x-entity-type'];

        if (!appUrl || !entityType) {
            return res.status(400).json({
                success: false,
                error: 'Application URL (x-application-url or x-app-url) and x-entity-type headers are required'
            });
        }

        const entityExists = await getEntity(id, appUrl, entityType);
        if (!entityExists.success) {
            return res.status(404).json({
                success: false,
                error: 'Entity not found',
                details: {
                    id,
                    appUrl,
                    entityType,
                    suggestion: 'Please verify the entity ID and ensure it exists'
                }
            });
        }

        const result = await deleteEntity(id, appUrl, entityType);
        return res.json({
            success: true,
            message: 'Entity deleted successfully',
            data: result
        });
    } catch (error) {
        console.error('Error deleting entity:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete entity',
            details: {
                reason: error.message,
                suggestion: 'Please try again or contact support if the problem persists'
            }
        });
    }
});

// Update the search route to use searchEntities directly
// Add this helper function at the top with other imports
const removeEmbeddings = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(item => removeEmbeddings(item));
    }
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key !== 'embedding') {
                newObj[key] = removeEmbeddings(value);
            }
        }
        return newObj;
    }
    return obj;
};

// Update the search route
router.post('/search', async (req, res) => {
    try {
        const appUrl = req.headers['x-application-url'] || req.headers['x-app-url'];
        const entityType = req.headers['x-entity-type'];

        if (!appUrl || !entityType) {
            return res.status(400).json({
                success: false,
                error: 'Missing required headers',
                details: {
                    required: ['x-application-url or x-app-url', 'x-entity-type'],
                    suggestion: 'Please provide both application URL and entity type in the request headers'
                }
            });
        }

        // Format filters to handle nested metadata fields
        const filters = req.body.filters || {};
        const formattedFilters = {};
        
        Object.entries(filters).forEach(([key, value]) => {
            // Ensure all filter values are treated as case-sensitive
            if (typeof value === 'string') {
                formattedFilters[key] = value.toLowerCase();
            } else if (Array.isArray(value)) {
                formattedFilters[key] = value.map(v => 
                    typeof v === 'string' ? v.toLowerCase() : v
                );
            } else {
                formattedFilters[key] = value;
            }
        });

        const searchParams = {
            text: req.body.text || req.body.query,
            filters: formattedFilters,
            page: parseInt(req.body.page) || 1,
            limit: parseInt(req.body.limit) || 10
        };

        let result = await searchEntities(searchParams, appUrl, entityType);
        result = removeEmbeddings(result);

        res.json(result);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform search',
            details: {
                message: error.message,
                suggestion: 'Please try again or contact support if the problem persists'
            }
        });
    }
});

module.exports = router;