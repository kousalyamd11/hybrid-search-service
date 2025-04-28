const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const config = require('../../config/config');

const bedrockClient = new BedrockRuntimeClient({ 
    region: config.aws.region,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function generateEmbeddings(text) {
    try {
        console.log('Generating embeddings for text length:', text.length);
        const command = new InvokeModelCommand({
            modelId: process.env.EMBEDDING_MODEL,
            body: JSON.stringify({
                inputText: text
            }),
            contentType: "application/json",
            accept: "application/json",
        });
        
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log('Embeddings generated successfully');
        return responseBody.embedding;
    } catch (error) {
        console.error('Error generating embeddings:', error);
        throw error;
    }
}

module.exports = {
    bedrockClient,
    generateEmbeddings
};