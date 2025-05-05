require('dotenv').config();

const config = {
    port: process.env.PORT || 3000,
    opensearch: {
        node: process.env.OPENSEARCH_NODE || 'http://localhost:9200',
        auth: {
            username: process.env.OPENSEARCH_USERNAME || 'admin',
            password: process.env.OPENSEARCH_PASSWORD || 'admin'
        },
        ssl: {
            rejectUnauthorized: false
        }
    },
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
        database: process.env.MONGODB_DATABASE || 'search_service'
    },
    aws: {
        region: process.env.AWS_REGION || 'ap-south-1',
        bedrockModel: process.env.BEDROCK_MODEL || 'amazon.titan-embed-text-v1'
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        expiresIn: '24h'
    }
};

module.exports = config;