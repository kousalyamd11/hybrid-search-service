const authConfig = require('../config/auth');

const validateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const { clientName, appName, stack, appUrl } = req.headers;

  try {
    // Validate required fields
    if (!authConfig.tokenValidation.requiredFields.every(field => req.headers[field])) {
      throw new Error('Missing required authentication fields');
    }

    // Validate client configuration
    const clientConfig = authConfig.tokenValidation.clientConfigs[clientName];
    if (!clientConfig) {
      throw new Error('Invalid client');
    }

    // Validate app and stack
    if (!clientConfig.allowedApps.includes(appName)) {
      throw new Error('Invalid application');
    }
    if (!authConfig.tokenValidation.allowedStacks.includes(stack)) {
      throw new Error('Invalid stack');
    }

    // Validate domain
    const isValidDomain = clientConfig.allowedDomains.some(domain => 
      new RegExp(domain.replace('*', '.*')).test(appUrl)
    );
    if (!isValidDomain) {
      throw new Error('Invalid domain');
    }

    // Validate API key
    if (!clientConfig.apiKeys[stack].includes(token)) {
      throw new Error('Invalid API key');
    }

    next();
  } catch (error) {
    res.status(401).json({
      error: {
        code: 'AUTH_ERROR',
        message: error.message,
        context: {
          clientName,
          appName,
          stack
        }
      }
    });
  }
};

module.exports = { validateToken };