module.exports = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'your-access-key',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'your-secret-key',
  AWS_REGION: 'us-east-1',
  BEDROCK_REGION: 'us-east-1',  // Make sure this matches
  MONGODB_URI: 'mongodb://localhost:27017',
  MONGODB_DATABASE: 'hybrid_search',
  JWT_SECRET: 'your-jwt-secret'
};