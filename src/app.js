// Load environment variables from .env file
require('dotenv').config();

// Import core libraries and SDKs
const express = require('express'); // Web framework
const jwt = require('jsonwebtoken'); // JSON Web Token for authentication
const { MongoClient } = require('mongodb'); // MongoDB client for logs
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime'); // AWS Bedrock for embeddings and Claude
const { Client } = require('@opensearch-project/opensearch'); // OpenSearch client
const axios = require('axios'); // Axios for HTTP file downloads

// Initialize Express app
const app = express();
app.use(express.json()); // Enable JSON body parsing

// Initialize OpenSearch client
const opensearchClient = new Client({ node: process.env.OPENSEARCH_HOST });

// Initialize AWS Bedrock client
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

console.log(`Initializing Bedrock client in region: ${process.env.AWS_REGION}`);

// MongoDB connection configuration
const mongoUrl = 'mongodb://localhost:27017/search_logs';
const dbName = process.env.DB_NAME || 'search_logs';
const collectionName = process.env.COLLECTION_NAME || 'requests';
const mongoClient = new MongoClient(mongoUrl);

let dbConnection; // Placeholder for MongoDB connection

// Connect to MongoDB at startup
(async () => {
  try {
    await mongoClient.connect();
    dbConnection = mongoClient.db(dbName);
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
})();

// Helper: Build standardized index name from client/app context
const getIndexName = (clientname, appname, stack, entityType) => {
  return `${clientname}_${appname}_${stack}-${entityType}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
};

// Helper function for logging OpenSearch operations
const logOpenSearchOperation = async (operationType, indexName, status, details) => {
  await createLogEntry({
    timestamp: new Date(),
    event: 'opensearch_operation',
    operationType,
    indexName,
    status,
    details
  });
};

// Helper function for logging entity operations
const logEntityOperation = async (operationType, entityData, status, error = null) => {
  const logData = {
    timestamp: new Date(),
    event: 'entity_operation',
    operationType,
    entityId: entityData.id,
    entityType: entityData.entityType,
    clientname: entityData.clientname,
    appname: entityData.appname,
    stack: entityData.stack,
    status
  };
  
  if (error) {
    logData.error = error.message || error;
  }
  
  await createLogEntry(logData);
};

// Helper function for logging index operations
const logIndexOperation = async (operation, indexName, status, details = null) => {
  const logData = {
    timestamp: new Date(),
    event: 'index_operation',
    operation,
    indexName,
    status
  };

  if (details) {
    logData.details = details;
  }

  await createLogEntry(logData);
};

// Update the existing ensureIndexWithMapping function to include logging
const ensureIndexWithMapping = async (indexName) => {
  try {
    const exists = await opensearchClient.indices.exists({ index: indexName });
    if (!exists.body) {
      await opensearchClient.indices.create({
        index: indexName,
        body: {
          settings: { index: { knn: true } },
          mappings: {
            properties: {
              embedding: { type: 'knn_vector', dimension: 1024 },
              name: { type: 'text' },
              description: { type: 'text' },
              text: { type: 'text' },
              previewUrl: { type: 'keyword' },
              fileType: { type: 'keyword' },
              filePath: { type: 'keyword' },
              createdAt: { type: 'date' }
            }
          }
        }
      });
      await logIndexOperation('create', indexName, 'success');
    }
  } catch (error) {
    await logIndexOperation('create', indexName, 'failure', error.message);
    throw error;
  }
};

// Insert a log entry into MongoDB
const createLogEntry = async (logData) => {
  if (!dbConnection) throw new Error('Database connection not established');
  const collection = dbConnection.collection(collectionName);
  await collection.insertOne({
    ...logData,
    requestIp: logData.requestIp || 'unknown',
    userAgent: logData.userAgent || 'unknown'
  });
};

// Extract text using Anthropic Claude model via Bedrock
const extractTextWithClaude = async (filePath, fileType) => {
  try {
    if (fileType === 'image') {
      const imageData = await downloadImage(filePath);
      return await analyzeImageWithClaude(imageData);
    }

    const prompt = `You are an assistant that summarizes or describes file content. The file is a ${fileType} located at ${filePath}. Since I cannot provide the file's binary content, generate a brief textual description or summary of what this file might contain based on its type and path. Return only the summarized text.`;
    const command = new InvokeModelCommand({
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }),
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      accept: 'application/json',
      contentType: 'application/json'
    });
    console.log("Calling Claude model for text extraction:", filePath);
    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const extractedText = result.content[0].text;
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('Claude returned empty text');
    }
    console.log("Successfully extracted text:", extractedText.substring(0, 100) + "...");
    return extractedText;
  } catch (error) {
    console.error("Claude text extraction failed:", error);
    throw new Error(`Failed to extract text with Claude: ${error.message}`);
  }
};

// Generate embedding from text using AWS Bedrock Titan model
const createEmbedding = async (text, dimension = 1024) => {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Input text is empty or invalid. Cannot generate embedding.');
  }
  try {
    const command = new InvokeModelCommand({
      body: JSON.stringify({ inputText: text }),
      modelId: 'amazon.titan-embed-text-v2:0',
      accept: 'application/json',
      contentType: 'application/json'
    });
    console.log("Calling Titan Embed Model with text:", text.substring(0, 100) + "...");
    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    if (!result.embedding || result.embedding.length !== dimension) {
      throw new Error('Invalid embedding returned by Titan model');
    }
    return result.embedding;
  } catch (err) {
    console.error("Titan embedding error:", err.message);
    throw new Error(`Failed to create embedding: ${err.message}`);
  }
};

// Middleware to validate JWT token from Authorization header
const validateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = decoded;
    req.headers.clientname = decoded.clientname;
    req.headers.appname = decoded.appname;
    req.headers.stack = decoded.stack;
    req.headers.appurl = decoded.appurl;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Generate JWT token with expiration
const generateToken = (payload, expiresIn) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

// POST /auth
app.post('/auth', async (req, res) => {
  const { clientname, appname, stack, appurl } = req.body;
  if (!clientname || !appname || !stack || !appurl)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    const accessToken = generateToken({ clientname, appname, stack, appurl }, '2h');
    const refreshToken = generateToken({ clientname, appname, stack, appurl, type: 'refresh' }, '10d');
    await createLogEntry({ timestamp: new Date(), clientname, appname, stack, appurl, status: 'success', event: 'authentication' });
    res.status(200).json({ accessToken, refreshToken });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// -------------------
// POST /entity
// -------------------
app.post('/entity', validateJWT, async (req, res) => {
  const { clientname, appname, stack, appurl } = req.headers;
  const { entityType, metadata, filePath, fileType } = req.body;
  const indexName = getIndexName(clientname, appname, stack, entityType);
  const timestamp = new Date();
  let embedding;
  try {
    await ensureIndexWithMapping(indexName);
    try {
      if (fileType === 'image' || fileType === 'pdf' || fileType === 'video') {
        const extractedText = await extractTextWithClaude(filePath, fileType);
        embedding = await createEmbedding(extractedText);
      } else {
        const inputText = [
          metadata.name || '',
          metadata.description || ''
        ].filter(text => text.trim()).join(' ');
        
        if (!inputText) {
          return res.status(400).json({ error: 'Missing text content for embedding' });
        }
        embedding = await createEmbedding(inputText);
      }
    } catch (embeddingError) {
      await createLogEntry({
        timestamp,
        clientname,
        appname,
        stack,
        appurl,
        entityType,
        event: 'embedding_failure',
        status: 'failure',
        entityId: metadata.id,
        error: embeddingError.message
      });
      return res.status(500).json({ error: 'Failed to create embedding', details: embeddingError.message });
    }
    const document = {
      ...metadata,
      embedding,
      fileType,
      filePath,
      createdAt: timestamp
    };
    await opensearchClient.index({
      index: indexName,
      body: document,
      id: metadata.id,
      refresh: true
    });
    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      appurl,
      entityType,
      event: 'entity_added',
      status: 'success',
      entityId: metadata.id
    });
    res.status(200).json({ message: 'Entity added successfully', id: metadata.id });
  } catch (err) {
    console.error('Entity insert failed:', err.message);
    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      appurl,
      entityType,
      event: 'entity_added',
      status: 'failure',
      entityId: metadata.id,
      error: err.message
    });
    res.status(500).json({ error: 'Failed to add entity', details: err.message });
  }
});

// -------------------
// POST /search
// -------------------
app.post('/search', validateJWT, async (req, res) => {
  const { clientname, appname, stack, appurl } = req.headers;
  // Remove includeAiInsights parameter
  const { query, filters = {}, entityType = 'default', topK = 100, minScore, fileType = 'text' } = req.body;
  const indexName = getIndexName(clientname, appname, stack, entityType);
  const timestamp = new Date();

  if (!query || (typeof query === 'string' && !query.trim())) {
    return res.status(400).json({ error: 'Search query cannot be empty' });
  }

  let embedding;
  try {
    let queryText = query;
    if (fileType === 'image' || fileType === 'pdf' || fileType === 'video') {
      const extractedText = await extractTextWithClaude(query, fileType);
      queryText = extractedText;
    }
    embedding = await createEmbedding(queryText);
    const validatedTopK = Math.min(Math.max(parseInt(topK) || 100, 1), 1000);

    // Build filter conditions for metadata properties only
    const filterConditions = Object.entries(filters)
      .filter(([field, _]) => ['fileType', 'createdAt'].includes(field))
      .map(([field, value]) => {
        if (field === 'createdAt') {
          // Handle date range filters
          return {
            range: {
              createdAt: value // Expecting value to be an object like { gte: date1, lte: date2 }
            }
          };
        }
        return { term: { [field]: value } };
      });

    const response = await opensearchClient.search({
      index: indexName,
      body: {
        size: validatedTopK,
        query: {
          bool: {
            must: [
              {
                knn: {
                  embedding: {
                    vector: embedding,
                    k: validatedTopK
                  }
                }
              }
            ],
            filter: filterConditions
          }
        }
      }
    });

    const hits = response.body.hits.hits || [];
    const minScoreThreshold = !isNaN(parseFloat(minScore)) ? parseFloat(minScore) : 0.356;

    const filteredHits = hits.filter(hit => parseFloat(hit._score) >= minScoreThreshold);
    const results = filteredHits.map(hit => ({
      id: hit._id,
      score: hit._score,
      name: hit._source.name,
      description: hit._source.description,
      previewUrl: hit._source.previewUrl,
      fileType: hit._source.fileType,
      filePath: hit._source.filePath
    }));

    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      appurl,
      query,
      filters,
      resultsCount: results.length,
      event: 'search_success'
    });

    // Prepare response without embedding
    const searchResponse = {
      query,
      topK: validatedTopK,
      minScore: minScoreThreshold,
      totalResults: results.length,
      results
    };

    // Remove entire AI insights block
    res.status(200).json(searchResponse);
  } catch (err) {
    console.error('Search failed:', err);
    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      appurl,
      query,
      filters,
      error: err.message,
      event: 'search_failure'
    });
    res.status(500).json({ error: 'Search failed', details: `Embedding generation failed: ${err.message}` });
  }
});

// -------------------
// GET /logs
// -------------------
app.get('/logs', validateJWT, async (req, res) => {
  try {
    const { limit = 50, skip = 0, event, status, startDate, endDate } = req.query;
    const query = {};
    if (event) query.event = event;
    if (status) query.status = status;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }
    const collection = dbConnection.collection(collectionName);
    const logs = await collection.find(query).sort({ timestamp: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
    const total = await collection.countDocuments(query);
    res.status(200).json({ total, logs, page: Math.floor(skip / limit) + 1, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch logs', details: err.message });
  }
});

// -------------------
// Start Server
// -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown on SIGINT
process.on('SIGINT', async () => {
  await mongoClient.close();
  console.log('MongoDB connection closed');
  process.exit();
});

// Helper function to download and convert image to base64
const downloadImage = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = response.headers['content-type'];
    return `data:${mimeType};base64,${base64Image}`;
  } catch (error) {
    console.error('Image download failed:', error);
    throw new Error(`Failed to download image: ${error.message}`);
  }
};

// Helper function to analyze image with Claude
const analyzeImageWithClaude = async (imageData) => {
  try {
    const command = new InvokeModelCommand({
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageData.split(';')[0].replace('data:', ''),
                  data: imageData.split(',')[1]
                }
              },
              {
                type: 'text',
                text: "Please provide a detailed description of this image, focusing on key visual elements, objects, people, text, and any notable features that would be relevant for search purposes."
              }
            ]
          }
        ]
      }),
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      accept: 'application/json',
      contentType: 'application/json'
    });

    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return result.content[0].text;
  } catch (error) {
    console.error('Claude image analysis failed:', error);
    throw new Error(`Failed to analyze image with Claude: ${error.message}`);
  }
};

// -------------------
