// server.js

const express = require("express");
const bodyParser = require("body-parser");
const { OpenSearchClient } = require("@opensearch-project/opensearch");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { config } = require("dotenv");

config(); // Load AWS credentials and config from .env

const app = express();
const port = 3000;

app.use(bodyParser.json());

// OpenSearch client
const openSearchClient = new OpenSearchClient({
  node: "http://localhost:9200", // Change if needed
});

// Titan v2:0 embedding model (1024-d)
const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });
const titanV2ModelId = "amazon.titan-embed-text-v2:0";

// Create embedding using Titan v2:0
async function createEmbedding(text) {
  const input = {
    inputText: text,
  };

  const command = new InvokeModelCommand({
    modelId: titanV2ModelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(input),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(Buffer.from(response.body).toString());
  return responseBody.embedding;
}

// Ensure index exists or recreate with correct mapping
async function ensureIndexExists(indexName) {
  try {
    // TEMP: delete index if exists (for development/testing)
    await openSearchClient.indices.delete({ index: indexName }).catch(() => {});

    // Create new index with 1024-dimension knn_vector
    await openSearchClient.indices.create({
      index: indexName,
      body: {
        settings: {
          index: {
            knn: true,
          },
        },
        mappings: {
          properties: {
            title: { type: "text" },
            content: { type: "text" },
            category: { type: "keyword" },
            embedding: {
              type: "knn_vector",
              dimension: 1024,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "nmslib",
              },
            },
          },
        },
      },
    });

    console.log("Created index:", indexName);
  } catch (error) {
    if (error.meta && error.meta.body && error.meta.body.error.type === "resource_already_exists_exception") {
      console.log("Index already exists:", indexName);
    } else {
      console.error("Error creating index:", error);
    }
  }
}

// Index document
async function indexDocument(indexName, docId, document) {
  await openSearchClient.index({
    index: indexName,
    id: docId,
    body: document,
    refresh: true,
  });
}

// Search function
async function search(indexName, queryText) {
  const queryEmbedding = await createEmbedding(queryText);

  const response = await openSearchClient.search({
    index: indexName,
    body: {
      size: 5,
      query: {
        knn: {
          embedding: {
            vector: queryEmbedding,
            k: 5,
          },
        },
      },
    },
  });

  return response.body.hits.hits.map(hit => ({
    id: hit._id,
    score: hit._score,
    ...hit._source,
  }));
}

// Initialize test data and index
async function initialize() {
  const indexName = "lus_lam_brandsystems_prod-default";

  await ensureIndexExists(indexName);

  // Dummy documents
  const docs = [
    { id: "1", title: "Cloud Storage", content: "Scalable object storage service", category: "CLOUD" },
    { id: "2", title: "Mobile Budget", content: "Affordable smartphones under 300", category: "TECH" },
    { id: "3", title: "Rainforest Trip", content: "Eco-tour in Amazon jungle", category: "TRAVEL" },
  ];

  for (const doc of docs) {
    const embedding = await createEmbedding(`${doc.title} ${doc.content}`);
    await indexDocument(indexName, doc.id, { ...doc, embedding });
    console.log(`Indexed document ID: ${doc.id}`);
  }
}

// Search API
app.post("/search", async (req, res) => {
  const { query } = req.body;
  const indexName = "lus_lam_brandsystems_prod-default";

  if (!query) return res.status(400).json({ error: "Query text is required." });

  try {
    const results = await search(indexName, query);
    res.json({ results });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed." });
  }
});

// Start server
app.listen(port, async () => {
  console.log(`Local development server running at http://localhost:${port}`);
  await initialize();
});
