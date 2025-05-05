const { generateEmbedding } = require('../src/lambdas/search/index');

async function testEmbeddings() {
  try {
    const text = "This is a test sentence for embeddings.";
    console.log("Generating embedding for text:", text);
    const embedding = await generateEmbedding(text);
    console.log("Generated embedding:", embedding);
    console.log("Embedding length:", embedding.length);
  } catch (error) {
    console.error("Error testing embeddings:", error);
  }
}

testEmbeddings();