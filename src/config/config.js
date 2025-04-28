
require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    opensearch: {
        node: process.env.OPENSEARCH_NODE || 'http://localhost:9200', // Changed to http
        auth: {
            username: process.env.OPENSEARCH_USERNAME || 'admin',
            password: process.env.OPENSEARCH_PASSWORD || 'admin'
        },
        // Simplified SSL configuration
        ssl: {
            rejectUnauthorized: false
        },
        requestTimeout: 60000,
        maxRetries: 5,
        sniffOnStart: false,
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        expiresIn: '24h'
    },
    aws: {
        region: process.env.AWS_REGION || 'ap-south-1',
        bedrockModel: process.env.BEDROCK_MODEL || 'amazon.titan-embed-text-v1'
    }
};

module.exports = config;