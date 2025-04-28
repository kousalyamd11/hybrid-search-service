const express = require('express');
const router = express.Router();
const { storeEntity, updateEntity, deleteEntity, storeBulkEntities, getEntity } = require('../utils/opensearch-client');
const { generateEmbeddings } = require('../services/aws/bedrock');
const { analyzeImageWithClaude, downloadImage } = require('../services/aws/claude-vision');

router.post('/entity', async (req, res) => {
    try {
        const appUrl = req.headers['x-application-url'] || req.headers['x-app-url'];
        const entityType = req.headers['x-entity-type'];

        if (!appUrl || !entityType) {
            return res.status(400).json({
                success: false,
                error: 'Application URL and entity type headers are required'
            });
        }

        let entityData = {
            id: req.body.id,
            file_name: req.body.file_name,
            file_type: req.body.file_type,
            description: req.body.description,
            content_text: req.body.content_text,
            preview_url: req.body.preview_url,
            metadata: req.body.metadata || {}
        };

        // Process preview URL if exists
        // In your POST route:
        if (entityData.preview_url) {
            try {
                console.log('Processing image URL:', entityData.preview_url);
                const imageBase64 = await downloadImage(entityData.preview_url);
                const generatedText = await analyzeImageWithClaude(imageBase64);
                
                if (generatedText) {
                    console.log('Text generated from image:', generatedText);
                    entityData.content_text = generatedText;
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

        const entityData = req.body.entity || req.body;
        const existingEntity = await getEntity(id, appUrl, entityType);

        // Check if preview_url has changed
        // In the PUT route, update the image processing section:
        if (entityData.preview_url && entityData.preview_url !== existingEntity.preview_url) {
            try {
                const imageBase64 = await downloadImage(entityData.preview_url);
                const generatedText = await analyzeImageWithClaude(imageBase64);
                
                if (generatedText) {
                    entityData.content_text = generatedText;
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

        const result = await deleteEntity(id, appUrl, entityType);
        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;