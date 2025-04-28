const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const axios = require('axios');
const config = require('../../config/config');

const bedrockClient = new BedrockRuntimeClient({ 
    region: config.aws.region,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function downloadImage(url) {
    try {
        console.log('Downloading image from:', url);
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        const base64Image = Buffer.from(response.data).toString('base64');
        console.log('Image downloaded and converted to base64');
        return base64Image;
    } catch (error) {
        console.error('Error downloading image:', error);
        throw error;
    }
}

async function analyzeImageWithClaude(imageBase64) {
    try {
        const command = new InvokeModelCommand({
            modelId: "anthropic.claude-3-haiku-20240307-v1:0",
            body: JSON.stringify({
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 1000,
                messages: [{
                    role: "user",
                    content: [{
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: "image/jpeg",
                            data: imageBase64
                        }
                    }, {
                        type: "text",
                        text: "Describe this image in detail, focusing on all visual elements, objects, setting, and notable features."
                    }]
                }]
            }),
            contentType: "application/json",
            accept: "application/json",
        });

        console.log('Sending request to Claude Haiku...');
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log('Claude response:', JSON.stringify(responseBody, null, 2));

        // Updated response structure handling
        if (responseBody.content && responseBody.content[0] && responseBody.content[0].text) {
            const generatedText = responseBody.content[0].text;
            console.log('Generated text:', generatedText);
            return generatedText;
        } else if (responseBody.type === 'message' && responseBody.content && responseBody.content[0] && responseBody.content[0].text) {
            const generatedText = responseBody.content[0].text;
            console.log('Generated text:', generatedText);
            return generatedText;
        } else {
            console.log('Response structure:', JSON.stringify(responseBody, null, 2));
            return responseBody.content[0].text;
        }
    } catch (error) {
        console.error('Error in Claude analysis:', error);
        throw error;
    }
}

module.exports = {
    analyzeImageWithClaude,
    downloadImage
};