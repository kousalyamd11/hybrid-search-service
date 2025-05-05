const path = require('path');
const dotenv = require('dotenv');
const result = dotenv.config({ path: path.resolve(__dirname, '.env') });

if (result.error) {
  console.error('Error loading .env file:', result.error);
}

console.log('Environment variables loaded:');
console.log('- JWT_SECRET:', process.env.JWT_SECRET ? 'Set ✓' : 'Not set ✗');
console.log('- AWS_REGION:', process.env.AWS_REGION ? 'Set ✓' : 'Not set ✗');
console.log('- OPENSEARCH_HOST:', process.env.OPENSEARCH_HOST ? 'Set ✓' : 'Not set ✗');

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { Client } = require('@opensearch-project/opensearch');
const axios = require('axios');
const sharp = require('sharp');

const app = express();
app.use(cors());
app.use(express.json());

const opensearchClient = new Client({ 
  node: process.env.OPENSEARCH_HOST || 'https://localhost:9200',
  auth: {
    username: process.env.OPENSEARCH_USERNAME || 'admin',
    password: process.env.OPENSEARCH_PASSWORD || 'admin'
  },
  ssl: {
    rejectUnauthorized: false
  }
});

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

console.log(`Initializing Bedrock client in region: ${process.env.AWS_REGION}`);

const mongoUrl = 'mongodb://localhost:27017/search_logs';
const dbName = process.env.DB_NAME || 'search_logs';
const collectionName = process.env.COLLECTION_NAME || 'requests';
const mongoClient = new MongoClient(mongoUrl);

let dbConnection;

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

const getIndexName = (clientname, appname, stack, entityType) => {
  return `${clientname}_${appname}_${stack}-${entityType}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
};

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

const createLogEntry = async (logData) => {
  if (!dbConnection) throw new Error('Database connection not established');
  const collection = dbConnection.collection(collectionName);
  await collection.insertOne({
    ...logData,
    requestIp: logData.requestIp || 'unknown',
    userAgent: logData.userAgent || 'unknown'
  });
};

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

const validateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Authorization header missing or malformed');
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.headers.clientname = decoded.clientname;
    req.headers.appname = decoded.appname;
    req.headers.stack = decoded.stack;
    req.headers.appurl = decoded.appurl;
    next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const generateToken = (payload, expiresIn) => {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set in the environment');
    console.log('Available environment variables:', Object.keys(process.env));
  }
  
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('WARNING: Using default JWT secret. This is not secure for production!');
    return jwt.sign(payload, 'default_development_secret_key', { expiresIn });
  }
  
  return jwt.sign(payload, secret, { expiresIn });
};

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

app.post('/entity', validateJWT, async (req, res) => {
  const { clientname, appname, stack, appurl } = req.headers;
  const { entityType, metadata, filePath, fileType } = req.body;
  
  if (!entityType || !metadata || !metadata.id) {
    return res.status(400).json({ error: 'Missing required fields', details: 'entityType, metadata.id are required' });
  }
  
  const indexName = getIndexName(clientname, appname, stack, entityType);
  const timestamp = new Date();
  let embedding;
  let extractedText; // Store extracted text for images
  try {
    await ensureIndexWithMapping(indexName);
    try {
      if (fileType === 'image' || fileType === 'pdf' || fileType === 'video') {
        if (!filePath) {
          return res.status(400).json({ error: 'Missing filePath', details: 'filePath is required for image, pdf, and video file types' });
        }
        
        extractedText = await extractTextWithClaude(filePath, fileType);
        embedding = await createEmbedding(extractedText);
        
        // If no description is provided, use Claude's extracted text as the description
        if (!metadata.description || metadata.description.trim() === '') {
          console.log('No description provided, using Claude\'s extracted text as description');
          metadata.description = extractedText;
        }
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
      text: extractedText || null, // Store extracted text for images, PDFs, videos
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

app.put('/entity/:id', validateJWT, async (req, res) => {
  const { clientname, appname, stack, appurl } = req.headers;
  const { entityType, metadata, filePath, fileType } = req.body;
  const entityId = req.params.id;
  const timestamp = new Date();

  if (!entityType || !metadata) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const indexName = getIndexName(clientname, appname, stack, entityType);

  try {
    const existingEntity = await opensearchClient.get({
      index: indexName,
      id: entityId
    }).catch(() => null);

    if (!existingEntity) {
      return res.status(404).json({
        error: 'Entity not found',
        details: {
          id: entityId,
          suggestion: 'Please verify the entity ID and ensure it exists'
        }
      });
    }

    let embedding;
    let extractedText; // Store extracted text for images
    try {
      if (fileType === 'image' || fileType === 'pdf' || fileType === 'video') {
        if (!filePath) {
          return res.status(400).json({ error: 'Missing filePath for media type' });
        }
        extractedText = await extractTextWithClaude(filePath, fileType);
        embedding = await createEmbedding(extractedText);
      } else {
        const inputText = [metadata.name || '', metadata.description || ''].filter(text => text.trim()).join(' ');
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
        entityId,
        error: embeddingError.message
      });
      return res.status(500).json({ error: 'Failed to create embedding', details: embeddingError.message });
    }

    const document = {
      ...metadata,
      embedding,
      fileType,
      filePath,
      text: extractedText || null, // Store extracted text for images, PDFs, videos
      updatedAt: timestamp
    };

    await opensearchClient.update({
      index: indexName,
      id: entityId,
      body: { doc: document },
      refresh: true
    });

    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      appurl,
      entityType,
      event: 'entity_updated',
      status: 'success',
      entityId
    });

    res.status(200).json({ message: 'Entity updated successfully', id: entityId });
  } catch (err) {
    console.error('Entity update failed:', err);
    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      appurl,
      entityType,
      event: 'entity_updated',
      status: 'failure',
      entityId,
      error: err.message
    });
    res.status(500).json({ error: 'Failed to update entity', details: err.message });
  }
});

app.delete('/entity/:id', validateJWT, async (req, res) => {
  const { clientname, appname, stack } = req.headers;
  const { entityType } = req.query;
  const entityId = req.params.id;
  const timestamp = new Date();

  if (!entityType) {
    return res.status(400).json({ error: 'entityType is required in query parameters' });
  }

  const indexName = getIndexName(clientname, appname, stack, entityType);

  try {
    const existingEntity = await opensearchClient.get({
      index: indexName,
      id: entityId
    }).catch(() => null);

    if (!existingEntity) {
      return res.status(404).json({
        error: 'Entity not found',
        details: {
          id: entityId,
          suggestion: 'Please verify the entity ID and ensure it exists'
        }
      });
    }

    await opensearchClient.delete({
      index: indexName,
      id: entityId,
      refresh: true
    });

    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      entityType,
      event: 'entity_deleted',
      status: 'success',
      entityId
    });

    res.status(200).json({
      message: 'Entity deleted successfully',
      id: entityId
    });
  } catch (err) {
    console.error('Entity deletion failed:', err);
    await createLogEntry({
      timestamp,
      clientname,
      appname,
      stack,
      entityType,
      event: 'entity_deleted',
      status: 'failure',
      entityId,
      error: err.message
    });
    res.status(500).json({
      error: 'Failed to delete entity',
      details: {
        reason: err.message,
        suggestion: 'Please try again or contact support if the problem persists'
      }
    });
  }
});

app.post('/search', validateJWT, async (req, res) => {
  const { clientname, appname, stack, appurl } = req.headers;
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

    const filterConditions = Object.entries(filters)
      .filter(([field, _]) => ['fileType', 'createdAt'].includes(field))
      .map(([field, value]) => {
        if (field === 'createdAt') {
          return {
            range: {
              createdAt: value
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
      filePath: hit._source.filePath,
      text: hit._source.text // Include extracted text in search results
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

    const searchResponse = {
      query,
      topK: validatedTopK,
      minScore: minScoreThreshold,
      totalResults: results.length,
      results
    };

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on('SIGINT', async () => {
  await mongoClient.close();
  console.log('MongoDB connection closed');
  process.exit();
});

const downloadImage = async (imageUrl) => {
  try {
    // Validate URL format before attempting download
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.match(/^https?:\/\/.+/)) {
      throw new Error('Invalid image URL format');
    }

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10 second timeout
      validateStatus: status => status === 200 // Only accept 200 OK responses
    });

    let imageBuffer = Buffer.from(response.data);
    const mimeType = response.headers['content-type'];

    // Target ~3.5MB to account for base64 encoding overhead (3.5MB * 1.33 ≈ 4.65MB < 5MB)
    const MAX_SIZE_BYTES = 3.5 * 1024 * 1024; // 3.5MB
    const MAX_BASE64_BYTES = 5 * 1024 * 1024; // 5MB for Claude

    // Function to check if base64 size is within limit
    const getBase64Size = (buffer) => {
      const base64String = buffer.toString('base64');
      return { base64String, size: base64String.length * 0.75 }; // Approximate size in bytes
    };

    // Check if image size exceeds our limit
    if (imageBuffer.length > MAX_SIZE_BYTES) {
      console.log(`Resizing image from ${Math.round(imageBuffer.length / 1024 / 1024 * 100) / 100}MB to fit Claude's limit`);

      let quality = 80;
      let maxDimension = 1200;
      let resizedImageBuffer = imageBuffer;

      // Keep trying with lower quality and smaller dimensions until base64 size is under limit
      while (quality >= 20 && maxDimension >= 600) {
        try {
          resizedImageBuffer = await sharp(imageBuffer)
            .resize({
              width: maxDimension,
              height: maxDimension,
              fit: 'inside',
              withoutEnlargement: true
            })
            .jpeg({ quality, force: true }) // Always convert to JPEG
            .toBuffer();

          const { base64String, size } = getBase64Size(resizedImageBuffer);

          // Check if base64-encoded size is under 5MB
          if (size < MAX_BASE64_BYTES) {
            console.log(`Successfully resized image to ${Math.round(resizedImageBuffer.length / 1024 / 1024 * 100) / 100}MB (base64: ${Math.round(size / 1024 / 1024 * 100) / 100}MB) with quality ${quality} and max dimension ${maxDimension}px`);
            return `data:image/jpeg;base64,${base64String}`;
          }

          // Reduce quality and dimensions
          quality -= 10;
          maxDimension -= 200;

          console.log(`Base64 size ${Math.round(size / 1024 / 1024 * 100) / 100}MB still too large, trying quality=${quality}, maxDimension=${maxDimension}`);
        } catch (resizeError) {
          console.error('Error during image resize:', resizeError);
          throw new Error(`Failed to resize image: ${resizeError.message}`);
        }
      }

      // Final attempt with aggressive settings
      console.log('Still too large, attempting final extreme resize');
      try {
        resizedImageBuffer = await sharp(imageBuffer)
          .resize({ width: 400, height: 400, fit: 'inside' })
          .jpeg({ quality: 20, force: true })
          .toBuffer();

        const { base64String, size } = getBase64Size(resizedImageBuffer);
        if (size >= MAX_BASE64_BYTES) {
          throw new Error(`Unable to resize image below 5MB limit. Final base64 size: ${Math.round(size / 1024 / 1024 * 100) / 100}MB`);
        }
        console.log(`Final resize successful: ${Math.round(resizedImageBuffer.length / 1024 / 1024 * 100) / 100}MB (base64: ${Math.round(size / 1024 / 1024 * 100) / 100}MB)`);
        return `data:image/jpeg;base64,${base64String}`;
      } catch (finalResizeError) {
        throw new Error(`Failed final resize attempt: ${finalResizeError.message}`);
      }
    }

    // For images already under the limit, check base64 size
    const { base64String, size } = getBase64Size(imageBuffer);
    if (size > MAX_BASE64_BYTES) {
      console.log(`Image under limit but base64 encoding (${Math.round(size / 1024 / 1024 * 100) / 100}MB) exceeds Claude's limit. Resizing...`);
      try {
        const resizedImageBuffer = await sharp(imageBuffer)
          .resize({ width: 1000, height: 1000, fit: 'inside' })
          .jpeg({ quality: 70, force: true })
          .toBuffer();

        const { base64String: resizedBase64, size: resizedSize } = getBase64Size(resizedImageBuffer);
        if (resizedSize >= MAX_BASE64_BYTES) {
          throw new Error(`Resized base64 size still too large: ${Math.round(resizedSize / 1024 / 1024 * 100) / 100}MB`);
        }
        return `data:image/jpeg;base64,${resizedBase64}`;
      } catch (resizeError) {
        throw new Error(`Failed to resize image for base64 limit: ${resizeError.message}`);
      }
    }

    return `data:${mimeType};base64,${base64String}`;
  } catch (error) {
    console.error('Image download failed:', error);
    if (error.response) {
      throw new Error(`Failed to download image: Server returned ${error.response.status} ${error.response.statusText}`);
    } else if (error.request) {
      throw new Error(`Failed to download image: No response received from server`);
    } else {
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }
};

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